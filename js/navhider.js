/**
 * Nav Hider — Content Script
 *
 * Injected on all NetSuite pages at document_start.
 * Reads hidden menu selections from chrome.storage.local
 * and injects a <style> block to hide selected nav items.
 *
 * Storage format (per key):
 *   Array of { key, id, label } objects
 *   - id = data-automation-id
 *   - label = aria-label
 *
 * @module navhider
 */

(() => {

    'use strict';

    const STYLE_ID = 'fex-navhider-style';

    /**
     * Builds the CSS selector for a hidden item. A rule carrying both gets both: live menu
     * anchors no longer have automation ids, so a rule saved by an older build would otherwise
     * stop matching its item.
     *
     * @param {Object} pItem - { key, id, label }
     * @returns {string} CSS selector list, or empty string when the item has neither
     */
    const buildSelector = (pItem) => {

        const aSelectors = [];

        if (pItem.id) {
            aSelectors.push(`[role="menuitem"]:has(> a[data-automation-id="${CSS.escape(pItem.id)}"])`);
        }

        if (pItem.label) {
            aSelectors.push(`[role="menuitem"]:has(> a[aria-label="${CSS.escape(pItem.label)}"])`);
        }

        return aSelectors.join(',\n');
    };

    /**
     * Generates and injects (or updates) the hiding stylesheet.
     *
     * @param {Array<Object>} pItems - array of { key, id, label } items to hide
     */
    const injectStyles = (pItems) => {

        let oStyle = document.getElementById(STYLE_ID);
        const aAllSelectors = [];

        pItems.forEach((pItem) => {

            const sSelector = buildSelector(pItem);

            if (sSelector) aAllSelectors.push(sSelector);
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

        const sAccountKey = buildNavHideKey(getAccountIdFromHostname(window.location.hostname));
        const aKeys = ['navHide_all'];

        if (sAccountKey) aKeys.push(sAccountKey);

        browserAPI.storage.local.get(aKeys).then((pResult) => {

            const oSeen = new Set();
            const aMerged = [];

            aKeys.forEach((pStorageKey) => {

                (pResult[pStorageKey] || []).forEach((pItem) => {

                    const oItem = normalizeHiddenItem(pItem);

                    if (!oItem || oSeen.has(oItem.key)) return;

                    oSeen.add(oItem.key);
                    aMerged.push(oItem);
                });
            });

            injectStyles(aMerged);

        }).catch((pErr) => console.warn('[FEX] nav rules read', pErr));
    };

    applyHiddenMenus();

    /* Re-apply when storage changes (user toggles in popup) */
    browserAPI.storage.onChanged.addListener((pChanges, pArea) => {

        if (pArea !== 'local') return;

        const bRelevant = Object.keys(pChanges).some(
            (pKey) => pKey.startsWith('navHide_')
        );

        if (bRelevant) {
            applyHiddenMenus();
        }
    });

})();
