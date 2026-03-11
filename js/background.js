/**
 * Background Service Worker -- Field Explorer EX
 *
 * Re-registers the navhider content script on install/update/startup
 * when the optional host permission has been granted.
 */

const browserAPI = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

const NETSUITE_ORIGIN = 'https://*.netsuite.com/*';

const ensureNavhiderRegistered = async () => {

    try {

        const bGranted = await browserAPI.permissions.contains({ origins: [NETSUITE_ORIGIN] });

        if (!bGranted) return;

        const aScripts = await browserAPI.scripting.getRegisteredContentScripts({ ids: ['fex-navhider'] });

        if (aScripts.length > 0) return;

        await browserAPI.scripting.registerContentScripts([{
            id: 'fex-navhider',
            matches: [NETSUITE_ORIGIN],
            js: ['js/navhider.js'],
            runAt: 'document_start'
        }]);

    } catch (_e) { /* ignore */ }
};

browserAPI.runtime.onInstalled.addListener(ensureNavhiderRegistered);
browserAPI.runtime.onStartup.addListener(ensureNavhiderRegistered);
