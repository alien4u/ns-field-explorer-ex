/**
 * Minimal headless Chrome launcher and CDP client for the browser harness, the extension smoke
 * test and the screenshot script. Zero dependencies: Bun's WebSocket and spawn.
 */

import {existsSync, mkdtempSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';

const SYSTEM_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PLAYWRIGHT_ROOT = join(homedir(), 'Library/Caches/ms-playwright');
const TESTING_BINARY = 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

/**
 * Resolves after pMs milliseconds.
 *
 * @param {number} pMs
 * @returns {Promise<void>}
 */
export const sleep = (pMs) => new Promise((pResolve) => setTimeout(pResolve, pMs));

/**
 * Finds Chrome for Testing in the Playwright cache, newest first.
 *
 * @returns {string} binary path, '' when none is installed
 */
export const findChromeForTesting = () => {

    if (process.env.CHROME_FOR_TESTING) return process.env.CHROME_FOR_TESTING;
    if (!existsSync(PLAYWRIGHT_ROOT)) return '';

    const aDirs = readdirSync(PLAYWRIGHT_ROOT).filter((pName) => pName.startsWith('chromium-')).sort().reverse();

    for (const sDir of aDirs) {

        const sBinary = join(PLAYWRIGHT_ROOT, sDir, TESTING_BINARY);

        if (existsSync(sBinary)) return sBinary;
    }

    return '';
};

/**
 * Finds a Chrome able to run plain pages headless.
 *
 * @returns {string} binary path
 */
export const findChrome = () => {

    if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
    if (existsSync(SYSTEM_CHROME)) return SYSTEM_CHROME;

    return findChromeForTesting();
};

/**
 * Creates a throwaway profile directory.
 *
 * @returns {string} path
 */
export const createProfileDir = () => mkdtempSync(join(tmpdir(), 'fex-chrome-'));

/**
 * Removes a profile directory, tolerating Chrome's slow file release.
 *
 * @param {string} pDir
 */
export const removeProfileDir = (pDir) => rmSync(pDir, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});

/**
 * Launches headless Chrome and connects to it over CDP.
 *
 * @param {Object} pOptions
 * @param {string} pOptions.sBinary - Chrome binary
 * @param {string} pOptions.sProfile - user data directory
 * @param {Array<string>} [pOptions.aArgs] - extra command line switches
 * @returns {Promise<Object>} browser handle: send, on, createPage, targets, close
 */
export const launchChrome = async (pOptions) => {

    const sPortFile = join(pOptions.sProfile, 'DevToolsActivePort');

    rmSync(sPortFile, {force: true});

    const oProcess = Bun.spawn([
        pOptions.sBinary,
        '--headless=new',
        '--remote-debugging-port=0',
        `--user-data-dir=${pOptions.sProfile}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-gpu',
        ...(pOptions.aArgs || []),
        'about:blank'
    ], {stdout: 'ignore', stderr: 'ignore'});

    let sEndpoint = '';

    for (let nTry = 0; nTry < 200 && !sEndpoint; nTry++) {

        if (existsSync(sPortFile)) {

            const [sPort, sPath] = readFileSync(sPortFile, 'utf8').split('\n');

            if (sPort && sPath) sEndpoint = `ws://127.0.0.1:${sPort}${sPath}`;
        }

        if (!sEndpoint) await sleep(100);
    }

    if (!sEndpoint) {

        oProcess.kill();
        throw new Error('Chrome did not open a debugging port');
    }

    const oSocket = new WebSocket(sEndpoint);

    await new Promise((pResolve, pReject) => {

        oSocket.addEventListener('open', pResolve, {once: true});
        oSocket.addEventListener('error', () => pReject(new Error('CDP socket failed')), {once: true});
    });

    const oPending = new Map();
    const aListeners = [];
    let nNextId = 1;

    oSocket.addEventListener('message', (pEvent) => {

        const oMessage = JSON.parse(pEvent.data);

        if (oMessage.id && oPending.has(oMessage.id)) {

            const oCall = oPending.get(oMessage.id);

            oPending.delete(oMessage.id);

            if (oMessage.error) {
                oCall.reject(new Error(`${oCall.sMethod}: ${oMessage.error.message}`));
            } else {
                oCall.resolve(oMessage.result);
            }

            return;
        }

        aListeners.forEach((pListener) => pListener(oMessage));
    });

    /**
     * Sends one CDP command.
     *
     * @param {string} pMethod
     * @param {Object} [pParams]
     * @param {string} [pSessionId]
     * @returns {Promise<Object>}
     */
    const send = (pMethod, pParams, pSessionId) => {

        const nId = nNextId++;

        return new Promise((pResolve, pReject) => {

            oPending.set(nId, {resolve: pResolve, reject: pReject, sMethod: pMethod});
            oSocket.send(JSON.stringify({id: nId, method: pMethod, params: pParams || {}, sessionId: pSessionId}));
        });
    };

    /**
     * Opens a tab and attaches to it.
     *
     * @param {string} pUrl
     * @returns {Promise<Object>} page handle: send, evaluate, sessionId, targetId, close
     */
    const createPage = async (pUrl) => {

        const {targetId} = await send('Target.createTarget', {url: pUrl});
        const {sessionId} = await send('Target.attachToTarget', {targetId: targetId, flatten: true});

        return {
            sessionId: sessionId,
            targetId: targetId,
            send: (pMethod, pParams) => send(pMethod, pParams, sessionId),
            evaluate: async (pExpression) => {

                const oResult = await send('Runtime.evaluate', {
                    expression: pExpression,
                    returnByValue: true,
                    awaitPromise: true
                }, sessionId);

                if (oResult.exceptionDetails) {
                    throw new Error(oResult.exceptionDetails.exception?.description || oResult.exceptionDetails.text);
                }

                return oResult.result.value;
            },
            close: () => send('Target.closeTarget', {targetId: targetId})
        };
    };

    return {
        send: send,
        on: (pListener) => aListeners.push(pListener),
        createPage: createPage,
        targets: async () => (await send('Target.getTargets')).targetInfos,
        close: async () => {

            await send('Browser.close').catch(() => {});
            await oProcess.exited;
            oSocket.close();
        }
    };
};
