/**
 * Extension smoke test. Checks both built zips, then loads the Chrome package in Chrome for Testing
 * (branded Chrome no longer honors --load-extension) and checks the real thing over CDP: the worker
 * starts, the popup page opens clean and shows the manifest version, no sponsor text, and
 * storage.session has the lifecycle the Compare feature relies on. Ends with web-ext lint on the
 * Firefox package.
 *
 * Usage: bash build.sh && bun tests/e2e/smoke.js
 */

import {execFileSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createProfileDir, findChromeForTesting, launchChrome, removeProfileDir, sleep} from '../lib/cdp.js';

const sRepo = resolve(import.meta.dir, '../..');
const sVersion = JSON.parse(readFileSync(join(sRepo, 'manifest.json'), 'utf8')).version;
const sZip = join(sRepo, 'dist', `ns_field_explorer_ex_v${sVersion}_chrome_edge.zip`);
const sFirefoxZip = join(sRepo, 'dist', `ns_field_explorer_ex_v${sVersion}_firefox.zip`);
const sBinary = findChromeForTesting();
const SESSION_PROBE = {fex_smoke: 'survives close and reopen'};

let nPassed = 0;
let nFailed = 0;

const check = (pName, pPass, pDetail = '') => {

    if (pPass) {
        nPassed++;
    } else {
        nFailed++;
    }

    console.log(`${pPass ? 'PASS' : 'FAIL'} ${pName}${!pPass && pDetail ? ` -- ${pDetail}` : ''}`);
};

if (!existsSync(sZip) || !existsSync(sFirefoxZip)) {
    throw new Error(`Needs both release zips in dist/, from the local build.sh. Missing: ${sZip} or ${sFirefoxZip}`);
}

if (!sBinary) throw new Error('Chrome for Testing not found. Set CHROME_FOR_TESTING.');

for (const [sLabel, sPath] of [['Chrome zip', sZip], ['Firefox zip', sFirefoxZip]]) {

    const aEntries = execFileSync('unzip', ['-Z1', sPath], {encoding: 'utf8'}).split('\n');

    ['data/records-reference.json', 'js/core.js', 'THIRD_PARTY_NOTICES.md', 'manifest.json', 'popup.html'].forEach((pFile) => {

        check(`${sLabel} contains ${pFile}`, aEntries.includes(pFile));
    });

    check(`${sLabel} has no sponsor asset, tests or tools`, !aEntries.some((pEntry) => {

        return /spon-logo|^tests\/|^tools\/|^store\/|^_team_state\/|logo\.png$|icon\.svg$/.test(pEntry);
    }));

    const aText = aEntries.filter((pEntry) => /\.(html|css|js|json|md)$/.test(pEntry));
    const sText = execFileSync('unzip', ['-p', sPath, ...aText], {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});

    check(`${sLabel} has no sponsor text, link or style`, !/sponsor|spon-logo|utm_source/i.test(sText));

    const oPacked = JSON.parse(execFileSync('unzip', ['-p', sPath, 'manifest.json'], {encoding: 'utf8'}));

    check(`${sLabel} manifest version`, oPacked.version === sVersion, oPacked.version);
    check(`${sLabel} carries its own background form`, sLabel === 'Chrome zip'
        ? oPacked.background.service_worker === 'js/background.js'
        : oPacked.background.scripts?.join() === 'js/shared.js,js/background.js');
}

const sExtensionDir = mkdtempSync(join(tmpdir(), 'fex-ext-'));
const sProfile = createProfileDir();

execFileSync('unzip', ['-q', sZip, '-d', sExtensionDir]);

const aArgs = [`--disable-extensions-except=${sExtensionDir}`, `--load-extension=${sExtensionDir}`];

/**
 * Waits for the extension's service worker to show up as a target.
 *
 * @param {Object} pBrowser
 * @returns {Promise<Object|null>} target info
 */
const waitForWorker = async (pBrowser) => {

    for (let nTry = 0; nTry < 100; nTry++) {

        const oWorker = (await pBrowser.targets()).find((pTarget) => {

            return pTarget.type === 'service_worker' && pTarget.url.endsWith('/js/background.js');
        });

        if (oWorker) return oWorker;

        await sleep(100);
    }

    return null;
};

/**
 * Opens popup.html in a tab, recording console errors and exceptions.
 *
 * @param {Object} pBrowser
 * @param {string} pExtensionId
 * @returns {Promise<{oPage: Object, aProblems: Array<string>}>}
 */
const openPopupPage = async (pBrowser, pExtensionId) => {

    const oPage = await pBrowser.createPage('about:blank');
    const aProblems = [];

    pBrowser.on((pMessage) => {

        if (pMessage.sessionId !== oPage.sessionId) return;

        if (pMessage.method === 'Runtime.exceptionThrown') {
            aProblems.push(pMessage.params.exceptionDetails.exception?.description || pMessage.params.exceptionDetails.text);
        }

        if (pMessage.method === 'Runtime.consoleAPICalled' && pMessage.params.type === 'error') {
            aProblems.push(pMessage.params.args.map((pArg) => pArg.value || pArg.description).join(' '));
        }

        if (pMessage.method === 'Log.entryAdded' && pMessage.params.entry.level === 'error') {
            aProblems.push(pMessage.params.entry.text);
        }
    });

    await oPage.send('Runtime.enable');
    await oPage.send('Log.enable');
    await oPage.send('Page.enable');
    await oPage.send('Page.navigate', {url: `chrome-extension://${pExtensionId}/popup.html`});

    for (let nTry = 0; nTry < 100; nTry++) {

        const bReady = await oPage.evaluate(
            'document.readyState === "complete" && !!document.querySelector("#container .empty-msg, #container .error-msg")'
        ).catch(() => false);

        if (bReady) break;

        await sleep(50);
    }

    return {oPage: oPage, aProblems: aProblems};
};

let oBrowser = await launchChrome({sBinary: sBinary, sProfile: sProfile, aArgs: aArgs});

try {

    const oWorker = await waitForWorker(oBrowser);

    check('service worker starts', !!oWorker);

    const sExtensionId = oWorker ? new URL(oWorker.url).hostname : '';

    if (oWorker) {

        const {sessionId} = await oBrowser.send('Target.attachToTarget', {targetId: oWorker.targetId, flatten: true});
        let bSharedLoaded = false;

        /* The target shows up before the worker script has finished evaluating */
        for (let nTry = 0; nTry < 100 && !bSharedLoaded; nTry++) {

            const oResult = await oBrowser.send('Runtime.evaluate', {
                expression: 'typeof ensureNavhiderRegistered === "function" && typeof browserAPI !== "undefined"',
                returnByValue: true
            }, sessionId);

            bSharedLoaded = oResult.result.value === true;

            if (!bSharedLoaded) await sleep(50);
        }

        check('worker sees shared.js through importScripts', bSharedLoaded);
    }

    const {oPage, aProblems} = await openPopupPage(oBrowser, sExtensionId);

    check('popup.html opens with no console errors', aProblems.length === 0, aProblems.join(' | '));

    const sFooter = await oPage.evaluate('document.getElementById("footerVersion").textContent');

    check('footer shows the manifest version', sFooter === `Field Explorer EX v${sVersion}`, sFooter);

    const sBodyText = await oPage.evaluate('document.body.textContent');

    check('no sponsor text', !/sponsor/i.test(sBodyText));

    const bBrand = await oPage.evaluate(
        'document.getElementById("footerBrandLink").href === "https://www.alientechnologyllc.com/"'
    );

    check('brand link in place', bBrand);

    const sReference = await oPage.evaluate(
        'fetch(chrome.runtime.getURL("data/records-reference.json")).then((r) => r.json()).then((d) => d.invoice.f.entity[0])'
    );

    check('packaged reference loads through runtime.getURL', sReference === 'Customer', sReference);

    const bHasSession = await oPage.evaluate('!!chrome.storage.session');

    check('storage.session exists', bHasSession);

    await oPage.evaluate(`chrome.storage.session.set(${JSON.stringify(SESSION_PROBE)})`);
    await oPage.close();

    const oReopened = await openPopupPage(oBrowser, sExtensionId);
    const sAfterReopen = await oReopened.oPage.evaluate('chrome.storage.session.get("fex_smoke").then((r) => r.fex_smoke || "")');

    check('storage.session survives closing and reopening the page', sAfterReopen === SESSION_PROBE.fex_smoke, sAfterReopen);

    const bInLocal = await oReopened.oPage.evaluate('chrome.storage.local.get("fex_smoke").then((r) => "fex_smoke" in r)');

    check('and that value is not in storage.local', !bInLocal);

    await oBrowser.close();

    oBrowser = await launchChrome({sBinary: sBinary, sProfile: sProfile, aArgs: aArgs});

    const oWorkerAgain = await waitForWorker(oBrowser);

    check('worker starts again on the same profile', !!oWorkerAgain);

    const oRestarted = await openPopupPage(oBrowser, sExtensionId);
    const sAfterRestart = await oRestarted.oPage.evaluate('chrome.storage.session.get("fex_smoke").then((r) => r.fex_smoke || "")');

    check('storage.session is gone after restarting the browser', sAfterRestart === '', sAfterRestart);
    check('popup still opens clean after the restart', oRestarted.aProblems.length === 0, oRestarted.aProblems.join(' | '));

} finally {

    await oBrowser.close();
    removeProfileDir(sProfile);
    rmSync(sExtensionDir, {recursive: true, force: true});
}

const sFirefoxDir = mkdtempSync(join(tmpdir(), 'fex-ff-'));

execFileSync('unzip', ['-q', sFirefoxZip, '-d', sFirefoxDir]);

/* From the temp dir, so bunx leaves nothing in the repo */
const oLint = Bun.spawnSync(['bunx', 'web-ext', 'lint', '--source-dir', sFirefoxDir, '--output', 'json', '--no-input'], {
    cwd: sFirefoxDir,
    stdout: 'pipe',
    stderr: 'ignore'
});

try {

    const oLintResult = JSON.parse(oLint.stdout.toString());
    const aWarnings = (oLintResult.warnings || []).map((pItem) => pItem.code);

    check('web-ext lint: no errors', oLintResult.summary.errors === 0, JSON.stringify(oLintResult.errors));
    console.log(`     web-ext lint summary: ${JSON.stringify(oLintResult.summary)} ${aWarnings.join(', ')}`);

} catch (pErr) {
    check('web-ext lint ran', false, pErr.message);
}

rmSync(sFirefoxDir, {recursive: true, force: true});

console.log(`\nSmoke: ${nPassed} passed, ${nFailed} failed`);

process.exit(nFailed > 0 ? 1 : 0);
