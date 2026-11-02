/**
 * Static server for the popup harness. Serves the repo root on loopback under the same script
 * policy as the extension pages, so a CSP violation surfaces in the harness.
 *
 * Usage: bun tests/browser/serve.js [port]
 * Then open http://127.0.0.1:<port>/tests/browser/popup-harness.html?scenario=<name>
 */

import {resolve, sep} from 'node:path';

const HARNESS_PATH = '/tests/browser/popup-harness.html';
const sRoot = resolve(import.meta.dir, '../..');
const oHeaders = {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': 'script-src \'self\'; object-src \'self\''
};

/**
 * Starts the server.
 *
 * @param {number} [pPort] - 0 picks a free port
 * @returns {Object} Bun server, with hostname and port
 */
export const startServer = (pPort = 0) => {

    return Bun.serve({
        hostname: '127.0.0.1',
        port: pPort,
        fetch: async (pRequest) => {

            const oUrl = new URL(pRequest.url);
            const sPath = resolve(sRoot, '.' + decodeURIComponent(oUrl.pathname));

            if (sPath !== sRoot && !sPath.startsWith(sRoot + sep)) {
                return new Response('Forbidden', {status: 403, headers: oHeaders});
            }

            const oFile = Bun.file(sPath);

            if (!(await oFile.exists())) return new Response('Not found', {status: 404, headers: oHeaders});

            return new Response(oFile, {headers: oHeaders});
        }
    });
};

if (import.meta.main) {

    const oServer = startServer(Number(process.argv[2] || 8765));

    console.log(`Popup harness: http://127.0.0.1:${oServer.port}${HARNESS_PATH}`);
}
