/**
 * Background Service Worker -- Field Explorer EX
 *
 * Keeps the navhider content-script registration in sync with the optional host
 * permission, and migrates stored nav rules to the current schema on update.
 */

if (typeof importScripts === 'function') importScripts('/js/shared.js');

const NAVHIDE_SCHEMA_VERSION = 2;

/**
 * Rewrites every navHide_* rule array in the object form used since schema 2 and
 * drops the dead 'navHide_' key older builds wrote when no account was detected.
 */
const migrateNavRules = async () => {

    try {

        const oStored = await browserAPI.storage.local.get(null);

        if ((oStored.navHide_schemaVersion || 0) >= NAVHIDE_SCHEMA_VERSION) return;

        const oWrite = { navHide_schemaVersion: NAVHIDE_SCHEMA_VERSION };

        Object.entries(oStored).forEach(([pKey, pValue]) => {

            if (pKey === 'navHide_' || !pKey.startsWith('navHide_') || !Array.isArray(pValue)) return;

            oWrite[pKey] = pValue
                .map((pItem) => normalizeHiddenItem(pItem))
                .filter((pItem) => pItem !== null);
        });

        await browserAPI.storage.local.set(oWrite);
        await browserAPI.storage.local.remove('navHide_');

    } catch (pErr) {
        console.warn('[FEX] nav rule migration', pErr);
    }
};

browserAPI.runtime.onInstalled.addListener(() => {

    migrateNavRules();
    ensureNavhiderRegistered();
});

browserAPI.runtime.onStartup.addListener(() => {

    ensureNavhiderRegistered();
});

/* The Firefox doorhanger can close the popup mid-grant, so catch the grant here too */
browserAPI.permissions.onAdded.addListener(() => {

    ensureNavhiderRegistered();
});
