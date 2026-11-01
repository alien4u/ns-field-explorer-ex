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
    const oFilterBar = document.getElementById('filterBar');
    const oSearchWrap = document.getElementById('searchWrap');
    const oTabBar = document.getElementById('tabBar');
    const oContainer = document.getElementById('container');
    const oLegacyContainer = document.getElementById('legacyContainer');
    const oFooter = document.querySelector('footer');

    if (!oNavBtn || !oNavPanel) return;

    const oPermissionGate = document.getElementById('navPermissionGate');
    const oNavContent = document.getElementById('navManagerContent');
    const oGrantBtn = document.getElementById('navGrantAccessBtn');

    /* ──── State ──── */

    let sAccountId = '';
    let aMenuTree = [];
    /** @type {Map<string, {id: string, label: string}>} key → item info */
    let oHiddenAll = new Map();
    /** @type {Map<string, {id: string, label: string}>} key → item info */
    let oHiddenAccount = new Map();

    /* ──── Active Tab ──── */

    /**
     * Reads the active tab and its parsed URL.
     *
     * @returns {Promise<{oTab: Object|null, oUrl: URL|null}>}
     */
    const getActiveTab = async () => {

        try {

            const [oTab] = await browserAPI.tabs.query({ active: true, currentWindow: true });

            return { oTab: oTab || null, oUrl: oTab?.url ? new URL(oTab.url) : null };

        } catch (_e) {
            return { oTab: null, oUrl: null };
        }
    };

    /**
     * Extracts the full nav menu tree from the active tab via scripting.
     *
     * @returns {Promise<Array>} array of menu node objects
     */
    const extractMenuTree = async () => {

        try {

            const { oTab, oUrl } = await getActiveTab();

            /* Never scrape a foreign page - its menus would be stored as NetSuite hide rules */
            if (!oTab?.id || !oUrl || !isNetSuiteHostname(oUrl.hostname)) return [];

            const [oResult] = await browserAPI.scripting.executeScript({
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
                        'div[data-header-section="navigation"], div[role="group"]'
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

        } catch (_e) {
            return [];
        }
    };

    /* ──── Storage ──── */

    /**
     * Converts a stored array to a Map keyed by item key.
     *
     * @param {Array} pArr - stored array
     * @returns {Map<string, {id: string, label: string}>}
     */
    const arrayToMap = (pArr) => {

        const oMap = new Map();

        pArr.forEach((pItem) => {

            const oItem = normalizeHiddenItem(pItem);

            if (oItem) oMap.set(oItem.key, { id: oItem.id, label: oItem.label });
        });

        return oMap;
    };

    /**
     * Loads hidden menu IDs from storage.
     */
    const loadHiddenIds = async () => {

        const sAccountKey = buildNavHideKey(sAccountId);
        const aKeys = ['navHide_all'];

        if (sAccountKey) aKeys.push(sAccountKey);

        const oResult = await browserAPI.storage.local.get(aKeys);

        oHiddenAll = arrayToMap(oResult['navHide_all'] || []);
        oHiddenAccount = sAccountKey ? arrayToMap(oResult[sAccountKey] || []) : new Map();
    };

    /**
     * Saves hidden menu items to storage.
     *
     * @param {string} pScope - 'all' or account ID
     * @param {Map<string, {id: string, label: string}>} pMap - hidden items map
     */
    const saveHiddenIds = (pScope, pMap) => {

        const sKey = buildNavHideKey(pScope);

        if (!sKey) return Promise.resolve();

        const aArr = [];

        pMap.forEach((pVal, pMapKey) => {
            aArr.push({ key: pMapKey, id: pVal.id, label: pVal.label });
        });

        return browserAPI.storage.local.set({ [sKey]: aArr });
    };

    /* Every rule mutation runs through this one chain. Snapshotting and mutating on the
     * way in would let a second change start against shared state while the first write
     * is still out, and a rollback would then restore a snapshot taken before a newer
     * change that already succeeded. One queue covers both scopes, since the duplicate
     * cleanup crosses from the global map to the account map. */
    let oNavMutationQueue = Promise.resolve();

    /**
     * Applies a hide-rule change transactionally, after every earlier change has
     * settled. The panel must not report a rule removed while the stored rule and the
     * injected stylesheet are both still live, so a failed write puts the map back the
     * way it was and says so.
     *
     * The initiating control is deliberately NOT disabled while the write is out: the
     * queue already orders overlapping clicks, and disabling a focused control blurs it
     * synchronously, which would rob the repaint of the focus it needs to restore.
     *
     * @param {Map} pMap - map being mutated
     * @param {string} pScope - 'all' or account ID
     * @param {Function} pMutate - applies the change to pMap
     * @returns {Promise<boolean>} true when the write landed
     */
    const commitHiddenIds = (pMap, pScope, pMutate) => {

        const oTask = oNavMutationQueue.then(async () => {

            /* Snapshot and mutate only now that the queue has reached this task */
            const oSnapshot = new Map(pMap);

            try {

                pMutate();
                await saveHiddenIds(pScope, pMap);

                return true;

            } catch (pErr) {

                console.warn('[FEX] nav rule save', pErr);

                pMap.clear();
                oSnapshot.forEach((pValue, pKey) => pMap.set(pKey, pValue));

                renderScopeTrees();
                updateStatusCount();
                showNavError('Could not save changes - try again.');

                return false;
            }
        });

        /* The link must settle whatever the task did, or one failure wedges the queue */
        oNavMutationQueue = oTask.catch(() => {});

        return oTask;
    };

    /* ──── Tree Rendering ──── */

    /* Which branches the user has opened, by item key. The trees are rebuilt from the
     * maps on every save, search and rollback, so expansion cannot live in the DOM or it
     * collapses on each repaint. Both scopes render the same scraped menu, so one set
     * keeps them consistent with each other. */
    const oExpandedKeys = new Set();

    /**
     * Collects every item key present in the scraped menu snapshot.
     *
     * @param {Array<Object>} pItems - menu tree
     * @param {Set<string>} [pKeys] - accumulator
     * @returns {Set<string>} keys present in the snapshot
     */
    const collectTreeKeys = (pItems, pKeys) => {

        const oKeys = pKeys || new Set();

        pItems.forEach((pItem) => {

            const sKey = pItem.id || pItem.label || '';

            if (sKey) oKeys.add(sKey);
            if (pItem.children?.length) collectTreeKeys(pItem.children, oKeys);
        });

        return oKeys;
    };

    /**
     * Builds the per-scope "Clear all" control. The first click arms it for
     * three seconds, the second one executes.
     *
     * @param {Map} pHiddenMap - hidden items map for this scope
     * @param {string} pScope - 'all' or account ID
     * @returns {HTMLDivElement}
     */
    const buildClearAllBar = (pHiddenMap, pScope) => {

        const oBar = document.createElement('div');
        const oBtn = document.createElement('button');
        const nCount = pHiddenMap.size;
        const sIdle = `Clear all (${nCount})`;

        let nConfirmTimer = 0;
        let bArmed = false;

        oBar.className = 'nav-scope-actions';
        oBtn.className = 'nav-clear-btn';
        oBtn.type = 'button';
        oBtn.textContent = sIdle;

        oBtn.addEventListener('click', async () => {

            if (!bArmed) {

                bArmed = true;
                oBtn.textContent = `Confirm clear ${nCount}?`;
                oBtn.classList.add('armed');

                nConfirmTimer = setTimeout(() => {

                    bArmed = false;
                    oBtn.textContent = sIdle;
                    oBtn.classList.remove('armed');
                }, 3000);

                return;
            }

            clearTimeout(nConfirmTimer);

            const bSaved = await commitHiddenIds(pHiddenMap, pScope, () => pHiddenMap.clear());

            if (!bSaved) return;

            renderScopeTrees();
            updateStatusCount();
        });

        oBar.appendChild(oBtn);

        return oBar;
    };

    /**
     * Appends the rules whose menu item is missing from the current snapshot.
     * The snapshot only covers the page that was scraped, so these are listed
     * rather than deleted - another account or page may still show them.
     *
     * @param {HTMLElement} pContainer - scope container
     * @param {Map} pHiddenMap - hidden items map for this scope
     * @param {string} pScope - 'all' or account ID
     * @param {Set<string>} pTreeKeys - keys present in the snapshot
     */
    const appendOrphanSection = (pContainer, pHiddenMap, pScope, pTreeKeys) => {

        const aOrphans = [];

        pHiddenMap.forEach((pValue, pKey) => {

            if (!pTreeKeys.has(pKey)) aOrphans.push({ key: pKey, label: pValue.label });
        });

        if (aOrphans.length === 0) return;

        const oSection = document.createElement('div');
        const oHeader = document.createElement('div');
        const oToggle = document.createElement('span');
        const oTitle = document.createElement('span');
        const oNote = document.createElement('div');
        const oList = document.createElement('div');

        oSection.className = 'nav-orphans collapsed';

        oHeader.className = 'nav-orphans-header';
        oToggle.className = 'nav-orphans-toggle';
        oToggle.textContent = '▼';
        oTitle.textContent = `Not in current menu (${aOrphans.length})`;
        oHeader.appendChild(oToggle);
        oHeader.appendChild(oTitle);
        oHeader.addEventListener('click', () => oSection.classList.toggle('collapsed'));

        oNote.className = 'nav-orphans-note';
        oNote.textContent = 'Hidden by a rule but absent from the menu scanned on this page.';

        oList.className = 'nav-orphans-list';
        oList.appendChild(oNote);

        aOrphans.forEach((pOrphan) => {

            const oRow = document.createElement('div');
            const oLabel = document.createElement('span');
            const oUnhide = document.createElement('button');

            oRow.className = 'nav-orphan-row';
            oLabel.className = 'nav-orphan-label';
            oLabel.textContent = pOrphan.label || pOrphan.key;
            oLabel.title = pOrphan.key;

            oUnhide.className = 'nav-orphan-btn';
            oUnhide.type = 'button';
            oUnhide.textContent = 'Unhide';
            oUnhide.addEventListener('click', async () => {

                const bSaved = await commitHiddenIds(pHiddenMap, pScope, () => pHiddenMap.delete(pOrphan.key));

                if (!bSaved) return;

                renderScopeTrees();
                updateStatusCount();
            });

            oRow.appendChild(oLabel);
            oRow.appendChild(oUnhide);
            oList.appendChild(oRow);
        });

        oSection.appendChild(oHeader);
        oSection.appendChild(oList);
        pContainer.appendChild(oSection);
    };

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

        const aItems = pItems || [];

        /* Every repaint replaces the nodes, so a keyboard user loses the checkbox they
         * were on. Note which one it was before the container is emptied. */
        const oFocused = document.activeElement;
        const sFocusPath = (oFocused
            && oFocused.classList
            && oFocused.classList.contains('nav-tree-cb')
            && pContainer.contains(oFocused))
            ? (oFocused.dataset.fexPath || '')
            : '';

        pContainer.textContent = '';

        if (pHiddenMap.size > 0) {
            pContainer.appendChild(buildClearAllBar(pHiddenMap, pScope));
        }

        if (aItems.length === 0) {

            const oEmpty = document.createElement('div');

            oEmpty.className = 'nav-empty';
            oEmpty.textContent = 'No menu items found. Make sure you are on a NetSuite page.';
            pContainer.appendChild(oEmpty);

        } else {

            pContainer.appendChild(buildTreeUl(aItems, pHiddenMap, pScope, pSearchTerm, 0, pGlobalMap, ''));
        }

        appendOrphanSection(pContainer, pHiddenMap, pScope, collectTreeKeys(aItems));

        if (!sFocusPath) return;

        const oReplacement = pContainer.querySelector(`.nav-tree-cb[data-fex-path="${CSS.escape(sFocusPath)}"]`);

        if (oReplacement) oReplacement.focus();
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
     * @param {string} pParentPath - render path of the parent item, '' at the root
     * @returns {HTMLUListElement}
     */
    const buildTreeUl = (pItems, pHiddenMap, pScope, pSearchTerm, pDepth, pGlobalMap, pParentPath) => {

        const oUl = document.createElement('ul');
        oUl.className = 'nav-tree';

        if (pDepth > 0) {
            oUl.classList.add('nav-tree-nested');
        }

        pItems.forEach((pItem, pIndex) => {

            /* Position in the scraped tree, not the item key: the extractor dedups only
             * top-level entries per container, so one key can render more than once and
             * a key would point focus at the wrong occurrence. The index is taken before
             * the search filter, so a path means the same item in a filtered render. */
            const sItemPath = pParentPath ? `${pParentPath}.${pIndex}` : String(pIndex);

            /* Filter by search term */
            if (pSearchTerm && !matchesSearch(pItem, pSearchTerm)) return;

            const oLi = document.createElement('li');
            oLi.className = 'nav-tree-item';

            /* Expand/collapse toggle for items with children */
            const bHasChildren = pItem.children && pItem.children.length > 0;

            const oRow = document.createElement('div');
            oRow.className = 'nav-tree-row';

            /* Checkbox — use automation ID, fall back to label */
            const sItemKey = pItem.id || pItem.label || '';

            if (bHasChildren) {

                const oToggle = document.createElement('span');
                const bExpanded = oExpandedKeys.has(sItemKey);

                oToggle.className = 'nav-tree-toggle';
                oToggle.textContent = bExpanded ? '▼' : '▶';

                if (bExpanded) oLi.classList.add('expanded');

                oToggle.addEventListener('click', () => {

                    const bNowExpanded = !oExpandedKeys.has(sItemKey);

                    if (bNowExpanded) {
                        oExpandedKeys.add(sItemKey);
                    } else {
                        oExpandedKeys.delete(sItemKey);
                    }

                    oLi.classList.toggle('expanded', bNowExpanded);
                    oToggle.textContent = bNowExpanded ? '▼' : '▶';
                });

                oRow.appendChild(oToggle);

            } else {

                const oSpacer = document.createElement('span');
                oSpacer.className = 'nav-tree-spacer';
                oRow.appendChild(oSpacer);
            }

            /* Check if this item is globally hidden (only relevant for account tree) */
            const bGloballyHidden = pGlobalMap ? pGlobalMap.has(sItemKey) : false;

            const oCb = document.createElement('input');
            oCb.type = 'checkbox';
            oCb.className = 'nav-tree-cb';
            oCb.dataset.fexPath = sItemPath;

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

            oCb.addEventListener('change', async (pEvent) => {

                pEvent.stopPropagation();

                if (!sItemKey) return;

                const bChecked = oCb.checked;

                /* A failed write re-renders from the restored map, which puts the
                 * checkbox back on its own */
                const bSaved = await commitHiddenIds(pHiddenMap, pScope, () => {

                    if (bChecked) {
                        pHiddenMap.set(sItemKey, { id: pItem.id, label: pItem.label });
                    } else {
                        pHiddenMap.delete(sItemKey);
                    }
                });

                if (!bSaved) return;

                /* Checking in All Instances also drops any duplicate account rule */
                if (!pGlobalMap) {
                    await cleanupAccountDuplicates(sItemKey, bChecked);
                }

                /* Re-render on success as well. An earlier task's rollback may have
                 * rebuilt the trees while this one was queued, leaving this handler
                 * holding a detached checkbox whose live replacement still shows the
                 * pre-change state. Both outcomes now repaint from the maps. */
                renderScopeTrees();
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

                const oChildUl = buildTreeUl(pItem.children, pHiddenMap, pScope, pSearchTerm, pDepth + 1, pGlobalMap, sItemPath);
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
    const cleanupAccountDuplicates = async (pKey, pAdded) => {

        if (!pAdded || !sAccountId || !oHiddenAccount.has(pKey)) return;

        await commitHiddenIds(oHiddenAccount, sAccountId, () => oHiddenAccount.delete(pKey));
    };

    /**
     * Replaces the account tree with a hint when no account could be detected.
     * Rules saved under an empty scope would land in a key no reader loads.
     */
    const renderAccountHint = () => {

        oNavTreeAccount.textContent = '';

        const oHint = document.createElement('div');

        oHint.className = 'nav-empty';
        oHint.textContent = 'Open a NetSuite account page to manage per-account rules';
        oNavTreeAccount.appendChild(oHint);
    };

    /**
     * Re-renders the account tree (called when global state changes).
     */
    const renderAccountTree = () => {

        if (!sAccountId) {
            renderAccountHint();
            return;
        }

        const sTerm = (oNavSearch?.value || '').toLowerCase();

        renderTree(oNavTreeAccount, aMenuTree, oHiddenAccount, sAccountId, sTerm, oHiddenAll);
    };

    /**
     * Re-renders both scope trees against the current search term.
     */
    const renderScopeTrees = () => {

        const sTerm = (oNavSearch?.value || '').toLowerCase();

        renderTree(oNavTreeAll, aMenuTree, oHiddenAll, 'all', sTerm, null);
        renderAccountTree();
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

        const nAll = oHiddenAll.size;
        const nAccount = oHiddenAccount.size;
        const aParts = [];

        if (nAll > 0) aParts.push(`${nAll} global`);
        if (nAccount > 0) aParts.push(`${nAccount} account`);

        oNavStatus.textContent = aParts.length > 0
            ? `Hiding ${aParts.join(' + ')} menu items`
            : 'No menu items hidden';
    };

    /* ──── Registration Status ──── */

    /* One retry at a time. ensureNavhiderRegistered reads the current registration and
     * then writes, and those steps are not atomic: two concurrent calls from the absent
     * state both see "absent", both register, and the loser takes Chrome's duplicate-id
     * rejection and reports 'failed' even though the registration landed. Absent is
     * exactly the state a user retries from, so the race is reachable. */
    let bRetryInFlight = false;

    /**
     * Surfaces a failed rule write, using the registration warning's placement.
     *
     * @param {string} pMessage - message to show
     */
    const showNavError = (pMessage) => {

        const oExisting = document.getElementById('navSaveError');

        if (oExisting) oExisting.remove();

        const oStrip = document.createElement('div');
        const oText = document.createElement('span');
        const oDismiss = document.createElement('button');

        oStrip.id = 'navSaveError';
        oStrip.className = 'nav-reg-warning';
        oText.textContent = pMessage;

        oDismiss.className = 'nav-reg-btn';
        oDismiss.type = 'button';
        oDismiss.textContent = 'Dismiss';
        oDismiss.addEventListener('click', () => oStrip.remove());

        oStrip.appendChild(oText);
        oStrip.appendChild(oDismiss);
        oNavPanel.insertBefore(oStrip, oNavContent);
    };

    /**
     * Surfaces a failed content-script registration. Rule editing still works,
     * but nothing would apply the rules on page load, so say so.
     *
     * @param {string} pStatus - ensureNavhiderRegistered() result
     */
    const applyRegistrationStatus = (pStatus) => {

        const oExisting = document.getElementById('navRegWarning');

        if (pStatus !== 'failed') {

            if (oExisting) oExisting.remove();
            return;
        }

        if (oExisting) return;

        const oStrip = document.createElement('div');
        const oText = document.createElement('span');
        const oRetry = document.createElement('button');
        const oDismiss = document.createElement('button');

        oStrip.id = 'navRegWarning';
        oStrip.className = 'nav-reg-warning';

        oText.textContent = 'Automatic menu hiding may not be active.';

        oRetry.className = 'nav-reg-btn';
        oRetry.type = 'button';
        oRetry.textContent = 'Retry';
        oRetry.addEventListener('click', async () => {

            /* Feedback through the label, not .disabled: disabling a focused control blurs
             * it synchronously. Re-entry is held off by the guard instead. */
            if (bRetryInFlight) return;

            bRetryInFlight = true;
            oRetry.textContent = 'Retrying...';

            try {

                const sStatus = await ensureNavhiderRegistered();

                oRetry.textContent = 'Retry';
                applyRegistrationStatus(sStatus);

            } finally {
                bRetryInFlight = false;
            }
        });

        oDismiss.className = 'nav-reg-btn';
        oDismiss.type = 'button';
        oDismiss.textContent = 'Dismiss';
        oDismiss.addEventListener('click', () => oStrip.remove());

        oStrip.appendChild(oText);
        oStrip.appendChild(oRetry);
        oStrip.appendChild(oDismiss);
        oNavPanel.insertBefore(oStrip, oNavContent);
    };

    /* ──── Panel Toggle ──── */

    /**
     * Hides main content and shows the nav panel shell.
     */
    const showPanelShell = () => {

        if (oHeader) oHeader.style.display = 'none';
        if (oFilterBar) oFilterBar.style.display = 'none';
        if (oSearchWrap) oSearchWrap.style.display = 'none';
        if (oTabBar) oTabBar.style.display = 'none';
        if (oContainer) oContainer.style.display = 'none';
        if (oLegacyContainer) oLegacyContainer.style.display = 'none';
        if (oFooter) oFooter.style.display = 'none';

        if (window.fex) window.fex.navOpen = true;

        oNavPanel.classList.add('visible');
    };

    /**
     * Shows the permission gate interstitial, hiding the nav content.
     */
    const showPermissionGate = () => {

        showPanelShell();
        oPermissionGate.classList.add('visible');
        oNavContent.classList.add('hidden');
    };

    /**
     * Shows the Nav Manager panel with full content (permission already granted).
     */
    const showPanel = async () => {

        showPanelShell();
        oPermissionGate.classList.remove('visible');
        oNavContent.classList.remove('hidden');

        const { oUrl } = await getActiveTab();

        sAccountId = oUrl ? getAccountIdFromHostname(oUrl.hostname) : '';

        await loadHiddenIds();

        if (oNavAccountLabel) {
            oNavAccountLabel.textContent = sAccountId
                ? `Account: ${sAccountId}`
                : 'Account: (not detected)';
        }

        const fnLoadingMsg = (pContainer) => {

            pContainer.textContent = '';

            const oDiv = document.createElement('div');

            oDiv.className = 'nav-loading';
            oDiv.textContent = '⏳ Scanning navigation menu...';
            pContainer.appendChild(oDiv);
        };

        fnLoadingMsg(oNavTreeAll);
        fnLoadingMsg(oNavTreeAccount);

        aMenuTree = await extractMenuTree();

        renderScopeTrees();
        updateStatusCount();

        if (oNavSearch) oNavSearch.focus();
    };

    /**
     * Hides the Nav Manager panel and restores main content
     * respecting the current view mode (new vs legacy).
     */
    const hidePanel = () => {

        oNavPanel.classList.remove('visible');

        if (window.fex) window.fex.navOpen = false;

        /* Always restore header, search, filter bar, footer */
        if (oHeader) oHeader.style.display = '';
        if (oFilterBar) oFilterBar.style.display = '';
        if (oSearchWrap) oSearchWrap.style.display = '';
        if (oFooter) oFooter.style.display = '';

        /* renderIfReady handles record pages, and falls through to applyViewMode
         * for non-record pages so their message comes back */
        window.fex?.renderIfReady();
    };

    /* ──── Event Listeners ──── */

    oNavBtn.addEventListener('click', async () => {

        const bHasPermission = await browserAPI.permissions.contains({
            origins: [FEX_NETSUITE_ORIGIN]
        });

        if (!bHasPermission) {
            showPermissionGate();
            return;
        }

        const sStatus = await ensureNavhiderRegistered();

        await showPanel();
        applyRegistrationStatus(sStatus);
    });

    oGrantBtn.addEventListener('click', async () => {

        const bGranted = await browserAPI.permissions.request({
            origins: [FEX_NETSUITE_ORIGIN]
        });

        if (!bGranted) return;

        const sStatus = await ensureNavhiderRegistered();

        await showPanel();
        applyRegistrationStatus(sStatus);
    });

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

    oNavSearch?.addEventListener('input', fexDebounce(renderScopeTrees, 150));
};

document.addEventListener('DOMContentLoaded', () => {

    initNavManager().catch((pErr) => console.warn('[FEX] nav manager', pErr));
});
