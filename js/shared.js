/**
 * Shared Globals — Field Explorer EX
 *
 * Loaded first in every context: popup page, background (service worker via
 * importScripts, Firefox event page via the scripts array) and the navhider
 * content script. No build step, no modules — plain script globals.
 *
 * @module shared
 */

const browserAPI = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

const FEX_NETSUITE_ORIGIN = 'https://*.netsuite.com/*';

const FEX_NAVHIDER_FILES = ['js/shared.js', 'js/navhider.js'];

const FEX_NAVHIDER_REGISTRATION = {
    id: 'fex-navhider',
    matches: [FEX_NETSUITE_ORIGIN],
    js: FEX_NAVHIDER_FILES,
    runAt: 'document_start',
    persistAcrossSessions: true
};

/**
 * Checks whether a hostname belongs to NetSuite.
 *
 * @param {string} pHostname - hostname to test
 * @returns {boolean} true for netsuite.com and any of its subdomains
 */
const isNetSuiteHostname = (pHostname) => {

    const sHost = (pHostname || '').toLowerCase();

    return sHost === 'netsuite.com' || sHost.endsWith('.netsuite.com');
};

/**
 * Extracts the NetSuite account ID from a hostname.
 *
 * @param {string} pHostname - hostname such as 1234567.app.netsuite.com
 * @returns {string} account ID or empty string
 */
const getAccountIdFromHostname = (pHostname) => {

    const aMatch = (pHostname || '').match(/^([^.]+)\.app\.netsuite\.com$/);

    return aMatch ? aMatch[1] : '';
};

/**
 * Builds the storage key holding the hide rules for a scope.
 *
 * @param {string} pScope - 'all' or an account ID
 * @returns {string} storage key, or empty string when the scope is unusable
 */
const buildNavHideKey = (pScope) => {

    if (!pScope) return '';

    return pScope === 'all' ? 'navHide_all' : `navHide_${pScope}`;
};

/**
 * Normalizes a stored hide rule to the object form written since schema 2.
 *
 * @param {Object|string} pItem - stored entry, legacy entries are plain strings
 * @returns {Object|null} { key, id, label } or null when the entry is unusable
 */
const normalizeHiddenItem = (pItem) => {

    if (typeof pItem === 'string') {
        return pItem ? { key: pItem, id: pItem, label: '' } : null;
    }

    if (pItem && pItem.key) {
        return { key: pItem.key, id: pItem.id || '', label: pItem.label || '' };
    }

    return null;
};

/**
 * Wraps a function so it only runs once calls stop arriving for pDelay ms.
 *
 * @param {Function} pFn - function to debounce
 * @param {number} pDelay - quiet period in milliseconds
 * @returns {Function} debounced wrapper
 */
const fexDebounce = (pFn, pDelay) => {

    let nTimer = 0;

    return (...pArgs) => {

        clearTimeout(nTimer);
        nTimer = setTimeout(() => pFn(...pArgs), pDelay);
    };
};

/**
 * Compares a live registration against the one this version expects.
 *
 * @param {Object} pRegistered - entry from getRegisteredContentScripts
 * @returns {boolean} true when files, matches, timing and persistence all agree
 */
const matchesNavhiderRegistration = (pRegistered) => {

    if (!pRegistered) return false;

    if (pRegistered.runAt !== FEX_NAVHIDER_REGISTRATION.runAt) return false;

    /* Firefox omits persistAcrossSessions from the reply; only an explicit false is a mismatch */
    if (pRegistered.persistAcrossSessions === false) return false;

    return (pRegistered.js || []).join('|') === FEX_NAVHIDER_FILES.join('|')
        && (pRegistered.matches || []).join('|') === FEX_NAVHIDER_REGISTRATION.matches.join('|');
};

/**
 * Decides the outcome after a registration write was rejected. Contexts register
 * independently - the popup on a grant, the worker on permissions.onAdded - and the
 * read-then-write is not atomic, so two of them can both see the id absent and both
 * register. Chrome rejects the loser for a duplicate id even though the registration it
 * wanted is now in place. What matters is the live state, not which call won.
 *
 * @param {Error} pErr - the rejection from the write
 * @returns {Promise<string>} 'ok' when the live registration is correct, else 'failed'
 */
const settleNavhiderWrite = async (pErr) => {

    const [oLive] = await browserAPI.scripting.getRegisteredContentScripts({ ids: [FEX_NAVHIDER_REGISTRATION.id] });

    if (matchesNavhiderRegistration(oLive)) return 'ok';

    console.warn('[FEX] navhider registration', pErr);

    return 'failed';
};

/**
 * Brings the navhider content-script registration in line with this version.
 * Registers when absent, updates in place when stale (no unregister window),
 * then re-reads the registration to confirm the result.
 *
 * @returns {Promise<string>} 'ok', 'no-permission' or 'failed'
 */
const ensureNavhiderRegistered = async () => {

    try {

        const bGranted = await browserAPI.permissions.contains({ origins: [FEX_NETSUITE_ORIGIN] });

        if (!bGranted) return 'no-permission';

        const [oExisting] = await browserAPI.scripting.getRegisteredContentScripts({ ids: [FEX_NAVHIDER_REGISTRATION.id] });

        try {

            if (!oExisting) {
                await browserAPI.scripting.registerContentScripts([FEX_NAVHIDER_REGISTRATION]);
            } else if (!matchesNavhiderRegistration(oExisting)) {
                await browserAPI.scripting.updateContentScripts([FEX_NAVHIDER_REGISTRATION]);
            }

        } catch (pWriteErr) {

            /* Awaited, not returned bare: a returned promise is adopted after control
             * leaves this try, so a rejection from the settle read would slip past the
             * outer catch and escape as an unhandled rejection */
            return await settleNavhiderWrite(pWriteErr);
        }

        const [oVerified] = await browserAPI.scripting.getRegisteredContentScripts({ ids: [FEX_NAVHIDER_REGISTRATION.id] });

        if (matchesNavhiderRegistration(oVerified)) return 'ok';

        /* Isolated: the id may already be gone, and that must not stop the re-register */
        try {
            await browserAPI.scripting.unregisterContentScripts({ ids: [FEX_NAVHIDER_REGISTRATION.id] });
        } catch (pUnregisterErr) {
            console.warn('[FEX] navhider unregister', pUnregisterErr);
        }

        try {
            await browserAPI.scripting.registerContentScripts([FEX_NAVHIDER_REGISTRATION]);
        } catch (pRetryErr) {
            return await settleNavhiderWrite(pRetryErr);
        }

        const [oRetried] = await browserAPI.scripting.getRegisteredContentScripts({ ids: [FEX_NAVHIDER_REGISTRATION.id] });

        return matchesNavhiderRegistration(oRetried) ? 'ok' : 'failed';

    } catch (pErr) {

        console.warn('[FEX] navhider registration', pErr);
        return 'failed';
    }
};
