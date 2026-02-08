/**
 * Nav Manager — Popup Module
 *
 * Manages the Nav Manager panel inside the Field Explorer EX popup.
 * Allows users to hide/show NetSuite navigation menu items per account
 * or globally across all instances.
 *
 * @module navmanager
 */

const initNavManager = async () => {

    'use strict';

    const browserAPI = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

    /* ──── DOM References ──── */

    const oNavBtn = document.getElementById('navManagerBtn');
    const oNavPanel = document.getElementById('navManagerPanel');
    const oNavBack = document.getElementById('navManagerBack');
    const oNavSearch = document.getElementById('navManagerSearch');
    const oNavTreeAll = document.getElementById('navTreeAll');
    const oNavTreeAccount = document.getElementById('navTreeAccount');
    const oNavAccountLabel = document.getElementById('navAccountLabel');
    const oNavStatus = document.getElementById('navManagerStatus');

    /* Main content areas to hide/show when Nav Manager is active */
    const oHeader = document.getElementById('header');
    const oSearchWrap = document.getElementById('searchWrap');
    const oTabBar = document.getElementById('tabBar');
    const oContainer = document.getElementById('container');
    const oLegacyContainer = document.getElementById('legacyContainer');
    const oFooter = document.querySelector('footer');

    if (!oNavBtn || !oNavPanel) return;

    /* ──── State ──── */

    let sAccountId = '';
    let aMenuTree = [];
    /** @type {Map<string, {id: string, label: string}>} key → item info */
    let oHiddenAll = new Map();
    /** @type {Map<string, {id: string, label: string}>} key → item info */
    let oHiddenAccount = new Map();

    /* ──── Account ID Extraction ──── */

    /**
     * Extracts account ID from the active tab's URL.
     *
     * @returns {Promise<string>} account ID or empty string
     */
    const getAccountIdFromTab = async () => {

        try {

            const [oTab] = await chrome.tabs.query({ active: true, currentWindow: true });

            if (!oTab?.url) return '';

            const oUrl = new URL(oTab.url);
            const aMatch = oUrl.hostname.match(/^([^.]+)\.app\.netsuite\.com$/);

            return aMatch ? aMatch[1] : '';

        } catch (e) {
            return '';
        }
    };

    /**
     * Extracts the full nav menu tree from the active tab via scripting.
     *
     * @returns {Promise<Array>} array of menu node objects
     */
    const extractMenuTree = async () => {

        try {

            const [oTab] = await chrome.tabs.query({ active: true, currentWindow: true });

            if (!oTab?.id) return [];

            const [oResult] = await chrome.scripting.executeScript({
                target: { tabId: oTab.id },
                func: () => {

                    /**
                     * Recursively extracts menu items from a DOM element.
                     *
                     * @param {Element} pParent - parent DOM element
                     * @returns {Array<Object>} array of { id, label, children }
                     */
                    const extractItems = (pParent) => {

                        const aItems = [];
                        const aMenuItems = pParent.querySelectorAll(':scope > [role="menuitem"]');

                        aMenuItems.forEach((pItem) => {

                            const oLink = pItem.querySelector(':scope > a');

                            if (!oLink) return;

                            const sAutoId = oLink.getAttribute('data-automation-id') || '';
                            const sLabel = oLink.getAttribute('aria-label')
                                || oLink.textContent?.trim()
                                || '';

                            if (!sAutoId && !sLabel) return;

                            /* Look for nested submenu (role="group" or nested list) */
                            const oSubmenu = pItem.querySelector(':scope > [role="group"], :scope > ul, :scope > div[role="group"]');
                            const aChildren = oSubmenu ? extractItems(oSubmenu) : [];

                            aItems.push({
                                id: sAutoId,
                                label: sLabel,
                                children: aChildren
                            });
                        });

                        return aItems;
                    };

                    /* Find nav containers */
                    const aContainers = document.querySelectorAll(
                        'div[data-header-section="navigation"], div[role="group"], #uif66'
                    );

                    const aAllItems = [];
                    const oSeenIds = new Set();

                    aContainers.forEach((pContainer) => {

                        const aItems = extractItems(pContainer);

                        aItems.forEach((pItem) => {

                            const sKey = pItem.id || pItem.label;

                            if (!oSeenIds.has(sKey)) {
                                oSeenIds.add(sKey);
                                aAllItems.push(pItem);
                            }
                        });
                    });

                    return aAllItems;
                }
            });

            return oResult?.result || [];

        } catch (e) {
            return [];
        }
    };

    /* ──── Storage ──── */

    /**
     * Loads hidden menu IDs from storage.
     */
    const loadHiddenIds = async () => {

        const aKeys = ['navHide_all'];

        if (sAccountId) {
            aKeys.push(`navHide_${sAccountId}`);
        }

        const oResult = await new Promise((resolve) => {
            browserAPI.storage.local.get(aKeys, resolve);
        });

        oHiddenAll = arrayToMap(oResult['navHide_all'] || []);
        oHiddenAccount = sAccountId
            ? arrayToMap(oResult[`navHide_${sAccountId}`] || [])
            : new Map();
    };

    /**
     * Converts stored array (of objects or legacy strings) to a Map.
     *
     * @param {Array} pArr - stored array
     * @returns {Map<string, {id: string, label: string}>}
     */
    const arrayToMap = (pArr) => {

        const oMap = new Map();

        pArr.forEach((pItem) => {

            if (typeof pItem === 'string') {
                /* Legacy format — treat as key with no metadata */
                oMap.set(pItem, { id: pItem, label: '' });
            } else if (pItem && pItem.key) {
                oMap.set(pItem.key, { id: pItem.id || '', label: pItem.label || '' });
            }
        });

        return oMap;
    };

    /**
     * Saves hidden menu items to storage.
     *
     * @param {string} pScope - 'all' or account ID
     * @param {Map<string, {id: string, label: string}>} pMap - hidden items map
     */
    const saveHiddenIds = (pScope, pMap) => {

        const sKey = pScope === 'all' ? 'navHide_all' : `navHide_${pScope}`;

        const aArr = [];
        pMap.forEach((pVal, pMapKey) => {
            aArr.push({ key: pMapKey, id: pVal.id, label: pVal.label });
        });

        browserAPI.storage.local.set({ [sKey]: aArr });
    };

    /* ──── Tree Rendering ──── */

    /**
     * Renders a menu tree into a target container element.
     *
     * @param {HTMLElement} pContainer - container to render into
     * @param {Array<Object>} pItems - menu tree items
     * @param {Map} pHiddenMap - map of hidden items for this scope
     * @param {string} pScope - 'all' or account ID
     * @param {string} pSearchTerm - optional search filter
     * @param {Map|null} pGlobalMap - global hidden map (pass for account tree, null for all tree)
     */
    const renderTree = (pContainer, pItems, pHiddenMap, pScope, pSearchTerm, pGlobalMap) => {

        pContainer.innerHTML = '';

        if (!pItems || pItems.length === 0) {

            const oEmpty = document.createElement('div');
            oEmpty.className = 'nav-empty';
            oEmpty.textContent = 'No menu items found. Make sure you are on a NetSuite page.';
            pContainer.appendChild(oEmpty);
            return;
        }

        const oUl = buildTreeUl(pItems, pHiddenMap, pScope, pSearchTerm, 0, pGlobalMap);
        pContainer.appendChild(oUl);
    };

    /**
     * Builds a <ul> tree recursively.
     *
     * @param {Array<Object>} pItems - menu items
     * @param {Map} pHiddenMap - hidden items map for this scope
     * @param {string} pScope - 'all' or account ID
     * @param {string} pSearchTerm - search filter
     * @param {number} pDepth - nesting depth
     * @param {Map|null} pGlobalMap - global hidden map (null = this IS the global tree)
     * @returns {HTMLUListElement}
     */
    const buildTreeUl = (pItems, pHiddenMap, pScope, pSearchTerm, pDepth, pGlobalMap) => {

        const oUl = document.createElement('ul');
        oUl.className = 'nav-tree';

        if (pDepth > 0) {
            oUl.classList.add('nav-tree-nested');
        }

        pItems.forEach((pItem) => {

            /* Filter by search term */
            if (pSearchTerm && !matchesSearch(pItem, pSearchTerm)) return;

            const oLi = document.createElement('li');
            oLi.className = 'nav-tree-item';

            /* Expand/collapse toggle for items with children */
            const bHasChildren = pItem.children && pItem.children.length > 0;

            const oRow = document.createElement('div');
            oRow.className = 'nav-tree-row';

            if (bHasChildren) {

                const oToggle = document.createElement('span');
                oToggle.className = 'nav-tree-toggle';
                oToggle.textContent = '▶';
                oToggle.addEventListener('click', () => {

                    oLi.classList.toggle('expanded');
                    oToggle.textContent = oLi.classList.contains('expanded') ? '▼' : '▶';
                });
                oRow.appendChild(oToggle);

            } else {

                const oSpacer = document.createElement('span');
                oSpacer.className = 'nav-tree-spacer';
                oRow.appendChild(oSpacer);
            }

            /* Checkbox — use automation ID, fall back to label */
            const sItemKey = pItem.id || pItem.label || '';

            /* Check if this item is globally hidden (only relevant for account tree) */
            const bGloballyHidden = pGlobalMap ? pGlobalMap.has(sItemKey) : false;

            const oCb = document.createElement('input');
            oCb.type = 'checkbox';
            oCb.className = 'nav-tree-cb';

            if (bGloballyHidden) {
                /* Item is hidden by All Instances — show as checked + disabled */
                oCb.checked = true;
                oCb.disabled = true;
                oCb.title = 'Hidden globally (All Instances)';
                oRow.classList.add('nav-tree-row-global');
            } else {
                oCb.checked = sItemKey ? pHiddenMap.has(sItemKey) : false;
                oCb.disabled = !sItemKey;
            }

            oCb.addEventListener('click', (pEvent) => {
                pEvent.stopPropagation();
            });

            oCb.addEventListener('change', (pEvent) => {

                pEvent.stopPropagation();

                if (!sItemKey) return;

                if (oCb.checked) {
                    pHiddenMap.set(sItemKey, { id: pItem.id, label: pItem.label });
                } else {
                    pHiddenMap.delete(sItemKey);
                }

                saveHiddenIds(pScope, pHiddenMap);

                /* If checking in All Instances, clean up account duplicates + re-render account tree */
                if (!pGlobalMap) {
                    cleanupAccountDuplicates(sItemKey, oCb.checked);
                    renderAccountTree();
                }

                updateStatusCount();
            });

            oRow.appendChild(oCb);

            /* Label */
            const oLabel = document.createElement('span');
            oLabel.className = 'nav-tree-label';
            oLabel.textContent = pItem.label || `(id: ${pItem.id})`;

            if (pItem.id) {
                oLabel.title = `automation-id: ${pItem.id}`;
            }

            if (bGloballyHidden) {
                oLabel.title = 'Hidden globally (All Instances)';
            }

            oRow.appendChild(oLabel);

            /* Global badge (for account tree items hidden globally) */
            if (bGloballyHidden) {

                const oGlobalBadge = document.createElement('span');
                oGlobalBadge.className = 'nav-tree-global-badge';
                oGlobalBadge.textContent = '🌐';
                oGlobalBadge.title = 'Hidden by All Instances';
                oRow.appendChild(oGlobalBadge);
            }

            /* ID badge */
            if (pItem.id) {

                const oBadge = document.createElement('span');
                oBadge.className = 'nav-tree-id';
                oBadge.textContent = pItem.id;
                oRow.appendChild(oBadge);
            }

            oLi.appendChild(oRow);

            /* Render children */
            if (bHasChildren) {

                const oChildUl = buildTreeUl(pItem.children, pHiddenMap, pScope, pSearchTerm, pDepth + 1, pGlobalMap);
                oLi.appendChild(oChildUl);
            }

            oUl.appendChild(oLi);
        });

        return oUl;
    };

    /**
     * Removes an item from account storage if it was just added to All Instances.
     * Prevents redundant storage.
     *
     * @param {string} pKey - item key
     * @param {boolean} pAdded - true if added to global, false if removed
     */
    const cleanupAccountDuplicates = (pKey, pAdded) => {

        if (!pAdded || !sAccountId) return;

        if (oHiddenAccount.has(pKey)) {
            oHiddenAccount.delete(pKey);
            saveHiddenIds(sAccountId, oHiddenAccount);
        }
    };

    /**
     * Re-renders the account tree (called when global state changes).
     */
    const renderAccountTree = () => {

        const sTerm = (oNavSearch?.value || '').toLowerCase();
        renderTree(oNavTreeAccount, aMenuTree, oHiddenAccount, sAccountId, sTerm, oHiddenAll);
    };

    /**
     * Checks if a menu item or any of its children match the search term.
     *
     * @param {Object} pItem - menu item
     * @param {string} pTerm - lowercase search term
     * @returns {boolean}
     */
    const matchesSearch = (pItem, pTerm) => {

        const sLabel = (pItem.label || '').toLowerCase();
        const sId = (pItem.id || '').toLowerCase();

        if (sLabel.includes(pTerm) || sId.includes(pTerm)) return true;

        if (pItem.children) {
            return pItem.children.some((pChild) => matchesSearch(pChild, pTerm));
        }

        return false;
    };

    /**
     * Updates the hidden count status line.
     */
    const updateStatusCount = () => {

        if (!oNavStatus) return;

        const iAll = oHiddenAll.size;
        const iAccount = oHiddenAccount.size;
        const aParts = [];

        if (iAll > 0) aParts.push(`${iAll} global`);
        if (iAccount > 0) aParts.push(`${iAccount} account`);

        oNavStatus.textContent = aParts.length > 0
            ? `Hiding ${aParts.join(' + ')} menu items`
            : 'No menu items hidden';
    };

    /* ──── Panel Toggle ──── */

    /**
     * Shows the Nav Manager panel, hiding the main content.
     */
    const showPanel = async () => {

        /* Hide main content */
        if (oHeader) oHeader.style.display = 'none';
        if (oSearchWrap) oSearchWrap.style.display = 'none';
        if (oTabBar) oTabBar.style.display = 'none';
        if (oContainer) oContainer.style.display = 'none';
        if (oLegacyContainer) oLegacyContainer.style.display = 'none';
        if (oFooter) oFooter.style.display = 'none';

        /* Show nav panel */
        oNavPanel.style.display = 'flex';

        /* Load data */
        sAccountId = await getAccountIdFromTab();
        await loadHiddenIds();

        /* Update account label */
        if (oNavAccountLabel) {
            oNavAccountLabel.textContent = sAccountId
                ? `Account: ${sAccountId}`
                : 'Account: (not detected)';
        }

        /* Extract menu tree */
        const fnLoadingMsg = (pContainer) => {
            pContainer.innerHTML = '';
            const oDiv = document.createElement('div');
            oDiv.className = 'nav-loading';
            oDiv.textContent = '⏳ Scanning navigation menu...';
            pContainer.appendChild(oDiv);
        };
        fnLoadingMsg(oNavTreeAll);
        fnLoadingMsg(oNavTreeAccount);

        aMenuTree = await extractMenuTree();

        /* Render trees — account tree gets global map for overlap detection */
        renderTree(oNavTreeAll, aMenuTree, oHiddenAll, 'all', '', null);
        renderTree(oNavTreeAccount, aMenuTree, oHiddenAccount, sAccountId, '', oHiddenAll);

        updateStatusCount();

        if (oNavSearch) oNavSearch.focus();
    };

    /**
     * Hides the Nav Manager panel and restores main content
     * respecting the current view mode (new vs legacy).
     */
    const hidePanel = () => {

        oNavPanel.style.display = 'none';

        /* Always restore header, search, footer */
        if (oHeader) oHeader.style.display = '';
        if (oSearchWrap) oSearchWrap.style.display = '';
        if (oFooter) oFooter.style.display = '';

        /* Restore view — render pending data OR just fix view mode */
        if (typeof window.fexRenderIfReady === 'function') {
            window.fexRenderIfReady();
        }

        /* Always restore correct view mode */
        const oViewModeSelect = document.getElementById('viewModeSelect');
        const sMode = oViewModeSelect?.value || 'new';

        if (sMode === 'legacy') {
            if (oTabBar) oTabBar.style.display = 'none';
            if (oContainer) oContainer.style.display = 'none';
            if (oLegacyContainer) oLegacyContainer.style.display = 'block';
        } else {
            if (oTabBar) oTabBar.style.display = 'flex';
            if (oContainer) oContainer.style.display = 'block';
            if (oLegacyContainer) oLegacyContainer.style.display = 'none';
        }
    };

    /* ──── Event Listeners ──── */

    oNavBtn.addEventListener('click', showPanel);
    oNavBack.addEventListener('click', hidePanel);

    /* Section collapse/expand toggles */
    document.querySelectorAll('.nav-section-header').forEach((pHeader) => {

        pHeader.addEventListener('click', (pEvent) => {

            /* Don't toggle when clicking inside the tree content */
            if (pEvent.target.closest('.nav-section-content')) return;

            const oSection = pHeader.closest('.nav-section');

            if (oSection) {
                oSection.classList.toggle('collapsed');
            }
        });
    });

    oNavSearch?.addEventListener('input', () => {

        const sTerm = (oNavSearch.value || '').toLowerCase();

        renderTree(oNavTreeAll, aMenuTree, oHiddenAll, 'all', sTerm, null);
        renderTree(oNavTreeAccount, aMenuTree, oHiddenAccount, sAccountId, sTerm, oHiddenAll);
    });
};

/* Initialize when DOM is ready */
document.addEventListener('DOMContentLoaded', () => {

    initNavManager();
});
