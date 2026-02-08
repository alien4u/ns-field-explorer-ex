/**
 * Background Service Worker — Field Explorer EX
 *
 * Handles contextual icon activation (enable/disable per tab).
 * Cross-browser: uses tabs.onUpdated (not declarativeContent).
 */

const NETSUITE_URL_PATTERN = /^https:\/\/[^/]*\.netsuite\.com\//;

const browserAPI = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

/**
 * Updates the extension icon state based on tab URL.
 *
 * @param {number} pTabId
 * @param {string} pUrl
 */
const updateIconState = (pTabId, pUrl) => {

    if (!pTabId || !pUrl) return;

    if (NETSUITE_URL_PATTERN.test(pUrl)) {
        browserAPI.action.enable(pTabId);
    } else {
        browserAPI.action.disable(pTabId);
    }
};

browserAPI.runtime.onInstalled.addListener(() => {
    browserAPI.action.disable();
});

browserAPI.tabs.onUpdated.addListener((pTabId, pChangeInfo, pTab) => {

    if (pChangeInfo.url || pChangeInfo.status === 'complete') {
        updateIconState(pTabId, pTab.url || '');
    }
});

browserAPI.tabs.onActivated.addListener((pActiveInfo) => {

    Promise.resolve(browserAPI.tabs.get(pActiveInfo.tabId)).then((pTab) => {
        if (pTab) updateIconState(pTab.id, pTab.url || '');
    }).catch(() => {});
});
