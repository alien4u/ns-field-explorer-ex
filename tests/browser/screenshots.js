/**
 * Regenerates the store screenshots from the harness, with synthetic data only.
 *
 * Usage: bun tests/browser/screenshots.js
 * Output: store/screenshots/v1.2.0/screenshot_<n>_1280x800.png, the popup centered on a plain canvas.
 */

import {mkdirSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {createProfileDir, findChrome, launchChrome, removeProfileDir, sleep} from '../lib/cdp.js';
import {startServer} from './serve.js';

const SHOTS = [
    ['shot-legacy', 1],
    ['shot-body-dark', 2],
    ['shot-sublists', 3],
    ['shot-raw', 4],
    ['shot-nav', 5],
    ['shot-compare', 6]
];
const POPUP_WIDTH = 550;
const POPUP_HEIGHT = 592;
const sOutDir = join(resolve(import.meta.dir, '../..'), 'store/screenshots/v1.2.0');

mkdirSync(sOutDir, {recursive: true});

const oServer = startServer();
const sOrigin = `http://127.0.0.1:${oServer.port}`;
const sProfile = createProfileDir();
const oBrowser = await launchChrome({sBinary: findChrome(), sProfile: sProfile});
const oPage = await oBrowser.createPage('about:blank');

await oPage.send('Page.enable');
await oPage.send('Runtime.enable');
await oPage.send('Emulation.setDeviceMetricsOverride', {width: 1280, height: 800, deviceScaleFactor: 1, mobile: false});

for (const [sScenario, nNumber] of SHOTS) {

    await oPage.send('Page.navigate', {url: `${sOrigin}/tests/browser/shot-frame.html?scenario=${sScenario}&w=${POPUP_WIDTH}&h=${POPUP_HEIGHT}`});

    let oResult = null;

    for (let nTry = 0; nTry < 200 && !oResult; nTry++) {

        await sleep(50);

        const sState = await oPage.evaluate(`(() => {

            const oWindow = document.querySelector('iframe')?.contentWindow;

            return oWindow && oWindow.__HARNESS__ && oWindow.__HARNESS__.done
                ? JSON.stringify({failed: oWindow.__HARNESS__.failed, results: oWindow.__HARNESS__.results.filter((pItem) => !pItem.pass)})
                : '';
        })()`).catch(() => '');

        if (sState) oResult = JSON.parse(sState);
    }

    if (!oResult || oResult.failed > 0) {
        throw new Error(`${sScenario}: ${oResult ? JSON.stringify(oResult.results) : 'timed out'}`);
    }

    await sleep(300);

    const {data} = await oPage.send('Page.captureScreenshot', {format: 'png'});
    const sPath = join(sOutDir, `screenshot_${nNumber}_1280x800.png`);

    writeFileSync(sPath, Buffer.from(data, 'base64'));
    console.log(sPath);
}

await oBrowser.close();
oServer.stop(true);
removeProfileDir(sProfile);
