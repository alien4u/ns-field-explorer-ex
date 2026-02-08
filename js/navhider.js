/**
 * Nav Hider — Content Script
 *
 * Injected on all NetSuite pages at document_start.
 * Reads hidden menu selections from chrome.storage.local
 * and injects a <style> block to hide selected nav items.
 *
 * Storage format (per key):
 *   Array of { key, id, label } objects
 *   - id = data-automation-id (primary selector)
 *   - label = aria-label (fallback selector)
 *
 * @module navhider
 */

(() => {

    'use strict';

    const STYLE_ID = 'fex-navhider-style';

    const browserAPI = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

    /**
     * Extracts the NetSuite account ID from the current hostname.
     *
     * @returns {string} account ID or empty string
     */
    const getAccountId = () => {

        const sHost = window.location.hostname;
        const aMatch = sHost.match(/^([^.]+)\.app\.netsuite\.com$/);

        return aMatch ? aMatch[1] : '';
    };

    /**
     * Builds CSS selectors for a hidden item using all available identifiers.
     * Mirrors the Stylus approach: data-automation-id primary, aria-label fallback.
     *
     * @param {Object} pItem - { key, id, label }
     * @returns {Array<string>} array of CSS selectors
     */
    const buildSelectors = (pItem) => {

        const aSelectors = [];

        if (pItem.id) {
            aSelectors.push(
                `[role="menuitem"]:has(> a[data-automation-id="${pItem.id}"])`
            );
        }

        if (pItem.label) {
            aSelectors.push(
                `[role="menuitem"]:has(> a[aria-label="${CSS.escape(pItem.label)}"])`
            );
        }

        return aSelectors;
    };

    /**
     * Generates and injects (or updates) the hiding stylesheet.
     *
     * @param {Array<Object>} pItems - array of { key, id, label } items to hide
     */
    const injectStyles = (pItems) => {

        let oStyle = document.getElementById(STYLE_ID);

        if (!pItems || pItems.length === 0) {

            if (oStyle) oStyle.remove();
            return;
        }

        const aAllSelectors = [];

        pItems.forEach((pItem) => {

            /* Normalize: handle legacy string format */
            const oItem = (typeof pItem === 'string')
                ? { key: pItem, id: pItem, label: '' }
                : pItem;

            buildSelectors(oItem).forEach((s) => aAllSelectors.push(s));
        });

        if (aAllSelectors.length === 0) {

            if (oStyle) oStyle.remove();
            return;
        }

        const sCss = `${aAllSelectors.join(',\n')} { display: none !important; }`;

        if (!oStyle) {
            oStyle = document.createElement('style');
            oStyle.id = STYLE_ID;
            (document.head || document.documentElement).appendChild(oStyle);
        }

        oStyle.textContent = sCss;
    };

    /**
     * Loads hidden items from storage and applies them.
     */
    const applyHiddenMenus = () => {

        const sAccountId = getAccountId();
        const aKeys = ['navHide_all'];

        if (sAccountId) {
            aKeys.push(`navHide_${sAccountId}`);
        }

        browserAPI.storage.local.get(aKeys, (oResult) => {

            const aAllItems = oResult['navHide_all'] || [];
            const aAccountItems = sAccountId ? (oResult[`navHide_${sAccountId}`] || []) : [];

            /* Merge and deduplicate by key */
            const oSeen = new Set();
            const aMerged = [];

            [...aAllItems, ...aAccountItems].forEach((pItem) => {

                const sKey = (typeof pItem === 'string') ? pItem : (pItem.key || '');

                if (sKey && !oSeen.has(sKey)) {
                    oSeen.add(sKey);
                    aMerged.push(pItem);
                }
            });

            injectStyles(aMerged);
        });
    };

    /* Apply immediately */
    applyHiddenMenus();

    /* Re-apply when storage changes (user toggles in popup) */
    browserAPI.storage.onChanged.addListener((pChanges, pArea) => {

        if (pArea !== 'local') return;

        const bRelevant = Object.keys(pChanges).some(
            (sKey) => sKey.startsWith('navHide_')
        );

        if (bRelevant) {
            applyHiddenMenus();
        }
    });

})();
