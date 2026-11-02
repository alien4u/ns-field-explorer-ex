/**
 * Runs every popup harness scenario in headless Chrome and prints PASS/FAIL.
 *
 * Usage: bun tests/browser/run.js [scenario ...]
 * Exit code is 0 only when every assertion passed and Chrome logged no CSP violation.
 */

import {createProfileDir, findChrome, launchChrome, removeProfileDir, sleep} from '../lib/cdp.js';
import {startServer} from './serve.js';

const SCENARIO_TIMEOUT_MS = 90000;
const oServer = startServer();
const sHarnessUrl = `http://127.0.0.1:${oServer.port}/tests/browser/popup-harness.html`;
const sProfile = createProfileDir();
const oBrowser = await launchChrome({sBinary: findChrome(), sProfile: sProfile});
const oPage = await oBrowser.createPage('about:blank');
const aChromeProblems = [];

await oPage.send('Page.enable');
await oPage.send('Runtime.enable');
await oPage.send('Log.enable');

oBrowser.on((pMessage) => {

    if (pMessage.sessionId !== oPage.sessionId) return;

    if (pMessage.method === 'Log.entryAdded' && /Content Security Policy/i.test(pMessage.params.entry.text)) {
        aChromeProblems.push(`CSP: ${pMessage.params.entry.text}`);
    }
});

/**
 * Navigates to one scenario and waits for its verdict.
 *
 * @param {string} pScenario
 * @returns {Promise<Object>} harness result
 */
const runScenario = async (pScenario) => {

    await oPage.send('Page.navigate', {url: `${sHarnessUrl}?scenario=${encodeURIComponent(pScenario)}`});

    const nStart = Date.now();

    while (Date.now() - nStart < SCENARIO_TIMEOUT_MS) {

        await sleep(50);

        const sState = await oPage.evaluate(
            'window.__HARNESS__ && window.__HARNESS__.done ? JSON.stringify(window.__HARNESS__) : ""'
        ).catch(() => '');

        if (sState) return JSON.parse(sState);
    }

    return {
        scenario: pScenario,
        passed: 0,
        failed: 1,
        results: [{name: 'scenario finished', pass: false, detail: 'timed out'}],
        info: {}
    };
};

const oList = await runScenario('__list__');
const aRequested = process.argv.slice(2);
const aScenarios = aRequested.length > 0 ? aRequested : oList.scenarios;
let nPassed = 0;
let nFailed = 0;
let nScenariosFailed = 0;

for (const sScenario of aScenarios) {

    const oResult = await runScenario(sScenario);

    nPassed += oResult.passed;
    nFailed += oResult.failed;

    if (oResult.failed > 0) nScenariosFailed++;

    console.log(`${oResult.failed > 0 ? 'FAIL' : 'PASS'} ${sScenario} (${oResult.passed}/${oResult.passed + oResult.failed})`);

    oResult.results.filter((pItem) => !pItem.pass).forEach((pItem) => {

        console.log(`     - ${pItem.name}: ${pItem.detail}`);
    });

    Object.entries(oResult.info || {}).forEach(([pKey, pValue]) => {

        console.log(`     ${pKey}: ${pValue}`);
    });
}

await oBrowser.close();
oServer.stop(true);
removeProfileDir(sProfile);

aChromeProblems.forEach((pProblem) => console.log(`FAIL ${pProblem}`));

console.log(`\nHarness: ${aScenarios.length - nScenariosFailed}/${aScenarios.length} scenarios passed, ` +
    `${nPassed} assertions passed, ${nFailed} failed, ${aChromeProblems.length} CSP violations logged by Chrome`);

process.exit(nFailed > 0 || aChromeProblems.length > 0 ? 1 : 0);
