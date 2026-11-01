/**
 * Bridge between popup.js and navmanager.js. Created before any await so the
 * Nav Manager never races the async init of the explorer.
 */
window.fex = {
    navOpen: false,
    renderIfReady: () => {}
};

/**
 * Paints a startup failure into the record container and hides the two views
 * that would otherwise leave the popup blank.
 *
 * @param {string} pMessage - message to display
 */
const showStartupError = (pMessage) => {

    const oContainer = document.getElementById('container');
    const oTabBar = document.getElementById('tabBar');
    const oLegacyContainer = document.getElementById('legacyContainer');

    if (oTabBar) oTabBar.style.display = 'none';
    if (oLegacyContainer) oLegacyContainer.style.display = 'none';

    if (!oContainer) return;

    oContainer.textContent = '';

    const oMsg = document.createElement('div');

    oMsg.className = 'error-msg';
    oMsg.textContent = pMessage;
    oContainer.appendChild(oMsg);
    oContainer.style.display = '';
};

document.addEventListener('DOMContentLoaded', () => {

    runFieldExplorer().catch((pErr) => {

        const sMessage = 'Field Explorer failed to start: ' + (pErr?.message || String(pErr));

        /* The bridge is still the stub when init fails this early, and closing the
         * Nav Manager delegates the record views to it - give it something to paint */
        window.fex.renderIfReady = () => showStartupError(sMessage);

        showStartupError(sMessage);
    });
});

/**
 * Main entry point - initializes the Field Explorer popup
 * Fetches record data via XML API and renders UI
 */
const runFieldExplorer = async () => {

    /* ──── DOM References ──── */

    const oSearchBox = document.getElementById('searchBox');
    const oContainer = document.getElementById('container');
    const oRecordInfo = document.getElementById('recordInfo');
    const oFieldCount = document.getElementById('fieldCount');
    const aTabBtns = document.querySelectorAll('.tab-btn');
    const aTabPanels = document.querySelectorAll('.tab-panel');

    /* Controls */
    const oDarkToggle = document.getElementById('darkModeToggle');
    const oCompactToggle = document.getElementById('compactModeToggle');
    const oExportJsonBtn = document.getElementById('exportJsonBtn');
    const oExportCsvBtn = document.getElementById('exportCsvBtn');
    const oExportSublistCsvBtn = document.getElementById('exportSublistCsvBtn');
    const oViewModeSelect = document.getElementById('viewModeSelect');
    const oFieldFilterSelect = document.getElementById('fieldFilterSelect');

    /* Links */
    const oRecordsBrowserLink = document.getElementById('recordsBrowserLink');
    const oRecordsCatalogLink = document.getElementById('recordsCatalogLink');

    /* Tab content containers */
    const oBodyFieldsTable = document.getElementById('bodyFieldsTable');
    const oSublistSelect = document.getElementById('sublistSelect');
    const oSublistTable = document.getElementById('sublistTable');
    const oRawJsonContainer = document.getElementById('rawJsonContainer');
    const oCopyRawJsonBtn = document.getElementById('copyRawJsonBtn');

    /* Legacy mode containers */
    const oTabBar = document.getElementById('tabBar');
    const oLegacyContainer = document.getElementById('legacyContainer');
    const oLegacyTree = document.getElementById('legacyTree');
    const oCopyLegacyJsonBtn = document.getElementById('copyLegacyJsonBtn');

    /* Parsed record data */
    let oRecord = null;

    /* Non-record page message (set when no record detected) */
    let sNonRecordMsg = '';
    let sNonRecordClass = 'empty-msg';

    /* Sort state */
    let nSortColumn = null;
    let bSortAsc = true;

    /* Panels holding stale output because a render was skipped while they were hidden */
    const oDirty = { body: false, sublists: false, raw: false };

    /* Rows currently painted in the sublist table, resolved by the delegated copy handler */
    let aRenderedCols = [];
    let aRenderedLines = [];

    const nSublistRenderCap = 500;

    /* ──── Custom Field Detection ──── */

    /**
     * Determines if a field ID represents a custom field
     * @param {string} pFieldId - field ID to check
     * @returns {boolean} true if custom field
     */
    function isCustomField(pFieldId) {

        const sId = (pFieldId || '').toLowerCase();
        return /^(custbody|custcol|custitem|custevent|custentity|custrecord)/.test(sId);
    }

    /* ──── Filter Helpers ──── */

    /**
     * Tests a field ID against the active field filter.
     * @param {string} pFieldId - field ID to check
     * @returns {boolean} true when the field survives the filter
     */
    function matchesFieldFilter(pFieldId) {

        const sFilter = oFieldFilterSelect?.value || 'all';

        if (sFilter === 'all') return true;

        return sFilter === 'custom' ? isCustomField(pFieldId) : !isCustomField(pFieldId);
    }

    /**
     * @returns {string} active view mode ('new' or 'legacy')
     */
    function getViewMode() {

        return oViewModeSelect?.value || 'new';
    }

    /**
     * Renders a field value as the string used for copy, search and CSV.
     * @param {*} pValue - field value
     * @returns {string} flat string representation
     */
    function stringifyFieldValue(pValue) {

        if (pValue === null || pValue === undefined) return '';

        return (typeof pValue === 'object') ? JSON.stringify(pValue) : String(pValue);
    }

    /**
     * Filters an object of fields based on current field filter setting.
     * @param {Object} pFields - key/value pairs to filter
     * @returns {Object} filtered fields
     */
    function filterFieldsByType(pFields) {

        if ((oFieldFilterSelect?.value || 'all') === 'all') return pFields;

        const oFiltered = {};

        Object.entries(pFields).forEach(([pKey, pVal]) => {

            if (matchesFieldFilter(pKey)) oFiltered[pKey] = pVal;
        });

        return oFiltered;
    }

    /**
     * Filters sublist columns (array of column names) based on field filter.
     * @param {Array<string>} pCols - column ID strings
     * @returns {Array<string>} filtered columns
     */
    function filterSublistCols(pCols) {

        return pCols.filter((pCol) => matchesFieldFilter(pCol));
    }

    /**
     * Filters sublist line data for legacy mode.
     * Removes columns from each line object based on filter.
     * @param {Object} pSublists - { sublistName: [line, ...] }
     * @returns {Object} filtered sublists
     */
    function filterSublistsForLegacy(pSublists) {

        if ((oFieldFilterSelect?.value || 'all') === 'all') return pSublists;

        const oFiltered = {};

        Object.entries(pSublists).forEach(([pName, pLines]) => {

            const aFilteredLines = pLines.map((pLine) => {

                const oFilteredLine = {};

                Object.entries(pLine).forEach(([pCol, pVal]) => {

                    if (matchesFieldFilter(pCol)) oFilteredLine[pCol] = pVal;
                });

                return oFilteredLine;

            }).filter((pLine) => Object.keys(pLine).length > 0);

            if (aFilteredLines.length > 0) {
                oFiltered[pName] = aFilteredLines;
            }
        });

        return oFiltered;
    }

    /* ──── Storage Helpers ──── */

    /* Roaming preferences live in storage.sync with storage.local as the always-fresh fallback */
    const FEX_ROAMING_KEYS = ['fex_darkMode', 'fex_compactMode', 'fex_viewMode', 'fex_fieldFilter'];

    /* Popup size is device-local by design - screens differ per machine */
    const FEX_SIZE_KEYS = ['fex_popupWidth', 'fex_popupHeight'];

    /* Values boot.js reads synchronously before the first paint */
    const FEX_MIRROR_KEYS = ['fex_popupWidth', 'fex_popupHeight', 'fex_darkMode', 'fex_compactMode'];

    /* Roaming values sync has not accepted yet. Hydrated from storage.local during
     * Restore Settings; without it the next open would merge the stale sync copy back
     * over a choice the user already made. */
    const oSyncPending = {};

    /* Issue order of the sync writes made this session, and the newest issued per key.
     * Writes for one key can settle out of order, so only the newest may decide that
     * key's pending state - see settleSyncWrite. Hydrated entries carry no sequence,
     * which makes them older than anything issued this session. */
    const oSyncWriteSeq = {};

    let nSyncWriteSeq = 0;

    /**
     * Swallows a rejected settings write. Quota and I/O failures are non-fatal -
     * the popup keeps working on the values it already read.
     * @param {Promise} pWrite - storage write promise
     */
    function guardWrite(pWrite) {

        pWrite.catch((pErr) => console.warn('[FEX] settings write', pErr));
    }

    /**
     * Writes the pending set to storage.local, dropping the key once it empties.
     */
    function persistSyncPending() {

        guardWrite(Object.keys(oSyncPending).length > 0
            ? browserAPI.storage.local.set({ fex_syncPending: { ...oSyncPending } })
            : browserAPI.storage.local.remove('fex_syncPending'));
    }

    /**
     * Applies a completed sync write to the pending set. Only the newest write issued
     * for a key may decide that key's state: writes settle out of order, so an older
     * success must not erase what a newer rejection recorded, and an older rejection
     * must not resurrect what a newer success cleared. Either way the loser is the
     * write the user superseded.
     *
     * @param {string} pKey - fex_* setting key
     * @param {number} pSeq - issue order of the completed write
     * @param {*} pValue - value to leave pending, or undefined when the write landed
     */
    function settleSyncWrite(pKey, pSeq, pValue) {

        if (oSyncWriteSeq[pKey] !== pSeq) return;

        if (pValue === undefined) {

            if (oSyncPending[pKey] === undefined) return;

            delete oSyncPending[pKey];

        } else {
            oSyncPending[pKey] = pValue;
        }

        persistSyncPending();
    }

    /**
     * Refreshes a pre-paint mirror value, best effort. localStorage throws in
     * Firefox private windows and that must never divert init - boot.js is the
     * only reader and falls back to the CSS defaults on its own.
     * @param {string} pKey - mirror key
     * @param {*} pValue - value to store
     */
    function writeMirror(pKey, pValue) {

        try {
            localStorage.setItem(pKey, String(pValue));
        } catch (_e) { /* pre-paint restore degrades to CSS defaults */ }
    }

    /**
     * Persists a roaming preference to sync, local and the pre-paint mirror.
     * A sync failure is non-fatal, but it is remembered: sync keeps the older value
     * and would otherwise win the next merge and undo this change.
     * @param {string} pKey - fex_* setting key
     * @param {*} pValue - value to store
     */
    function saveSetting(pKey, pValue) {

        const nSeq = ++nSyncWriteSeq;

        /* Record the intent before the sync write is even issued. Recording it from the
         * rejection handler loses it when the popup closes first: the document unloads,
         * the handler never runs, and the next open merges stale sync over the new local
         * value. One local.set carries the preference and the pending snapshot together
         * so the two can never land apart. */
        oSyncWriteSeq[pKey] = nSeq;
        oSyncPending[pKey] = pValue;

        guardWrite(browserAPI.storage.local.set({
            [pKey]: pValue,
            fex_syncPending: { ...oSyncPending }
        }));

        browserAPI.storage.sync.set({ [pKey]: pValue })
            .then(() => settleSyncWrite(pKey, nSeq, undefined))
            .catch((pErr) => {

                console.warn('[FEX] settings write', pErr);
                settleSyncWrite(pKey, nSeq, pValue);
            });

        if (FEX_MIRROR_KEYS.includes(pKey)) writeMirror(pKey, pValue);
    }

    /**
     * Persists the popup dimensions to local storage and the pre-paint mirror.
     * @param {number} pWidth - clamped width in px
     * @param {number} pHeight - clamped height in px
     */
    function savePopupSize(pWidth, pHeight) {

        guardWrite(browserAPI.storage.local.set({ fex_popupWidth: pWidth, fex_popupHeight: pHeight }));
        writeMirror('fex_popupWidth', pWidth);
        writeMirror('fex_popupHeight', pHeight);
    }

    /* ──── Restore Settings ──── */

    const [oLocal, oSync] = await Promise.all([
        browserAPI.storage.local.get([...FEX_ROAMING_KEYS, ...FEX_SIZE_KEYS, 'fex_settingsMigrated', 'fex_syncPending']),
        browserAPI.storage.sync.get(FEX_ROAMING_KEYS).catch(() => ({}))
    ]);

    const oSettings = { ...oLocal };

    FEX_ROAMING_KEYS.forEach((pKey) => {

        if (oSync[pKey] !== undefined) oSettings[pKey] = oSync[pKey];
    });

    /* A value sync rejected is the user's latest explicit intent, so it outranks the
     * older copy sync still holds. Runs on every open, whatever the migration state. */
    Object.assign(oSyncPending, oLocal.fex_syncPending || {});

    FEX_ROAMING_KEYS.forEach((pKey) => {

        if (oSyncPending[pKey] !== undefined) oSettings[pKey] = oSyncPending[pKey];
    });

    /* v1.1.1 stored a boolean; v1.2.0 stores 'auto' | 'on' | 'off' */
    if (oSettings.fex_darkMode === true) {
        oSettings.fex_darkMode = 'on';
    } else if (oSettings.fex_darkMode === false) {
        oSettings.fex_darkMode = 'off';
    } else if (!oSettings.fex_darkMode) {
        oSettings.fex_darkMode = 'auto';
    }

    /* Keep the local fallback equal to what sync just resolved to. Only keys with a
     * real source get written: persisting the migration's 'auto' default would make a
     * device that never chose a theme look like it had, and the copy-forward gate below
     * reads exactly that to decide what may be published. */
    const oReconcile = {};

    FEX_ROAMING_KEYS.forEach((pKey) => {

        const bSourced = oLocal[pKey] !== undefined
            || oSync[pKey] !== undefined
            || oSyncPending[pKey] !== undefined;

        if (bSourced && oSettings[pKey] !== undefined && oSettings[pKey] !== oLocal[pKey]) {
            oReconcile[pKey] = oSettings[pKey];
        }
    });

    if (Object.keys(oReconcile).length > 0) {
        guardWrite(browserAPI.storage.local.set(oReconcile));
    }

    /* Re-attempt the push sync rejected earlier. On another failure the set stays put
     * and the next open tries again. */
    if (Object.keys(oSyncPending).length > 0) {

        const oRetry = { ...oSyncPending };
        const nRetrySeq = ++nSyncWriteSeq;

        Object.keys(oRetry).forEach((pKey) => { oSyncWriteSeq[pKey] = nRetrySeq; });

        browserAPI.storage.sync.set(oRetry)
            .then(() => {

                Object.keys(oRetry).forEach((pKey) => settleSyncWrite(pKey, nRetrySeq, undefined));
            })
            .catch(() => { /* the entries stand as they are - retried on the next open */ });
    }

    /* One-time copy-forward per device: push pre-sync preferences up for keys sync
     * does not know yet. The marker is set only once the write actually lands. */
    if (!oLocal.fex_settingsMigrated) {

        const oCopyForward = {};

        /* Gate on the raw local read, not the merged object: the tri-state migration
         * defaults fex_darkMode to 'auto', and publishing that from a device that never
         * stored a theme would overwrite another device's explicit choice. A pending
         * value is that same explicit intent, so it qualifies too - and it carries the
         * value the retry above sends, so the two writes cannot disagree. */
        FEX_ROAMING_KEYS.forEach((pKey) => {

            const bHeldLocally = oLocal[pKey] !== undefined || oSyncPending[pKey] !== undefined;

            if (oSync[pKey] === undefined && bHeldLocally) oCopyForward[pKey] = oSettings[pKey];
        });

        browserAPI.storage.sync.set(oCopyForward)
            .then(() => browserAPI.storage.local.set({ fex_settingsMigrated: true }))
            .catch(() => { /* retried on the next popup open */ });
    }

    writeMirror('fex_darkMode', oSettings.fex_darkMode);
    writeMirror('fex_compactMode', oSettings.fex_compactMode === true);

    if (oSettings.fex_popupWidth) writeMirror('fex_popupWidth', oSettings.fex_popupWidth);
    if (oSettings.fex_popupHeight) writeMirror('fex_popupHeight', oSettings.fex_popupHeight);

    /* ──── Theme & Compact Mode ──── */

    const oRoot = document.documentElement;
    const oDarkQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const FEX_THEME_CYCLE = ['auto', 'on', 'off'];

    let sThemeMode = oSettings.fex_darkMode;
    let bCompact = oSettings.fex_compactMode === true;

    /**
     * Resolves a theme mode to the appearance it produces.
     * @param {string} pMode - 'auto', 'on' or 'off'
     * @param {boolean} pOsDark - whether the OS currently prefers dark
     * @returns {boolean} true when the mode paints dark
     */
    function isEffectiveDark(pMode, pOsDark) {

        return pMode === 'on' || (pMode === 'auto' && pOsDark);
    }

    /**
     * Paints the current mode. The OS preference is passed in so a click applies the same
     * observation it selected the mode from; callers without a sample read it fresh.
     * @param {boolean} [pOsDark] - sampled OS preference
     */
    function applyThemeMode(pOsDark) {

        const bOsDark = pOsDark === undefined ? oDarkQuery.matches : pOsDark;
        const bDark = isEffectiveDark(sThemeMode, bOsDark);

        oRoot.classList.toggle('theme-dark', bDark);

        if (!oDarkToggle) return;

        oDarkToggle.classList.toggle('active', bDark);
        oDarkToggle.title = `Theme: ${sThemeMode === 'auto' ? 'Auto' : (sThemeMode === 'on' ? 'Dark' : 'Light')}`;
    }

    applyThemeMode();

    oRoot.classList.toggle('fe-compact', bCompact);
    if (oCompactToggle) oCompactToggle.classList.toggle('active', bCompact);

    oDarkQuery.addEventListener('change', () => {

        if (sThemeMode === 'auto') applyThemeMode();
    });

    oDarkToggle?.addEventListener('click', () => {

        /* One observation drives the selection and the paint. Reading the media query twice
         * would let a flip between them store a mode that disagrees with what was painted. */
        const bOsDark = oDarkQuery.matches;
        const bCurrentDark = isEffectiveDark(sThemeMode, bOsDark);
        const nAt = FEX_THEME_CYCLE.indexOf(sThemeMode);

        /* Three modes over two appearances, so advancing blindly produces a click that
         * changes nothing - auto to on under a dark OS, off to auto under a light one.
         * Skip a candidate that looks the same as what is already on screen. */
        let sNext = FEX_THEME_CYCLE[(nAt + 1) % FEX_THEME_CYCLE.length];

        if (isEffectiveDark(sNext, bOsDark) === bCurrentDark) {
            sNext = FEX_THEME_CYCLE[(nAt + 2) % FEX_THEME_CYCLE.length];
        }

        sThemeMode = sNext;
        applyThemeMode(bOsDark);
        saveSetting('fex_darkMode', sThemeMode);
    });

    oCompactToggle?.addEventListener('click', () => {

        bCompact = !bCompact;
        oRoot.classList.toggle('fe-compact', bCompact);
        oCompactToggle.classList.toggle('active', bCompact);
        saveSetting('fex_compactMode', bCompact);
    });

    if (oSettings.fex_viewMode && oViewModeSelect) {
        oViewModeSelect.value = oSettings.fex_viewMode;
    }

    if (oSettings.fex_fieldFilter && oFieldFilterSelect) {
        oFieldFilterSelect.value = oSettings.fex_fieldFilter;
    }

    /* ──── Restore Popup Size ──── */

    /* Chrome caps popup windows at 800x600; staying under the cap keeps the
     * shrink-to-fit path out of the degenerate boundary case */
    const nMinWidth = 350;
    const nMaxWidth = 792;
    const nMinHeight = 300;
    const nMaxHeight = 592;

    if (oSettings.fex_popupWidth) {

        const sWidth = Math.min(Math.max(parseInt(oSettings.fex_popupWidth, 10) || nMinWidth, nMinWidth), nMaxWidth) + 'px';

        if (oRoot.style.getPropertyValue('--fe-width') !== sWidth) oRoot.style.setProperty('--fe-width', sWidth);
    }

    if (oSettings.fex_popupHeight) {

        const sHeight = Math.min(Math.max(parseInt(oSettings.fex_popupHeight, 10) || nMinHeight, nMinHeight), nMaxHeight) + 'px';

        if (oRoot.style.getPropertyValue('--fe-height') !== sHeight) oRoot.style.setProperty('--fe-height', sHeight);
    }

    /* ──── Resize Handle ──── */

    const oResizeHandle = document.getElementById('resizeHandle');

    if (oResizeHandle) {

        let bDragging = false;
        let nStartX = 0;
        let nStartY = 0;
        let nStartW = 0;
        let nStartH = 0;
        let nNewW = 0;
        let nNewH = 0;

        oResizeHandle.addEventListener('mousedown', (pEvent) => {

            pEvent.preventDefault();
            bDragging = true;
            nStartX = pEvent.screenX;
            nStartY = pEvent.screenY;
            nStartW = document.body.offsetWidth;
            nStartH = document.body.offsetHeight;
            nNewW = nStartW;
            nNewH = nStartH;
            document.body.classList.add('fe-resizing');
            oResizeHandle.classList.add('dragging');
        });

        document.addEventListener('mousemove', (pEvent) => {

            if (!bDragging) return;

            nNewW = Math.min(Math.max(nStartW - (pEvent.screenX - nStartX), nMinWidth), nMaxWidth);
            nNewH = Math.min(Math.max(nStartH + (pEvent.screenY - nStartY), nMinHeight), nMaxHeight);
            oRoot.style.setProperty('--fe-width', nNewW + 'px');
            oRoot.style.setProperty('--fe-height', nNewH + 'px');
        });

        document.addEventListener('mouseup', () => {

            if (!bDragging) return;

            bDragging = false;
            document.body.classList.remove('fe-resizing');
            oResizeHandle.classList.remove('dragging');
            savePopupSize(nNewW, nNewH);
        });
    }

    /* ──── Sortable Headers ──── */

    const aTableHeaders = document.querySelectorAll('#bodyFieldsTableOuter thead th');

    aTableHeaders.forEach((pTh, pIndex) => {

        pTh.tabIndex = 0;
        pTh.title = 'Click to sort';

        const fnSort = () => {

            if (nSortColumn === pIndex) {
                bSortAsc = !bSortAsc;
            } else {
                nSortColumn = pIndex;
                bSortAsc = true;
            }

            aTableHeaders.forEach((pHeader) => {

                pHeader.textContent = pHeader.textContent.replace(/ ▲| ▼/g, '');
                pHeader.removeAttribute('aria-sort');
            });

            pTh.textContent += bSortAsc ? ' ▲' : ' ▼';
            pTh.setAttribute('aria-sort', bSortAsc ? 'ascending' : 'descending');

            renderBodyFields();
        };

        pTh.addEventListener('click', fnSort);

        pTh.addEventListener('keydown', (pEvent) => {

            if (pEvent.key !== 'Enter' && pEvent.key !== ' ') return;
            if (pEvent.key === ' ') pEvent.preventDefault();

            fnSort();
        });
    });

    /* Apply view mode immediately so the correct view is visible while data loads */
    applyViewMode();

    /* ──── View Mode Switching & Deferred Render ──── */

    /** Renders all record views if data is available */
    window.fex.renderIfReady = () => {

        if (!oRecord) {
            applyViewMode();
            return;
        }

        renderRecordInfo();
        renderSublistSelector();
        updateLinks();
        applyViewMode();
    };

    /** Applies the current view mode (new vs legacy) and updates container visibility. */
    function applyViewMode() {

        if (window.fex.navOpen) return;

        /* No record loaded — show the non-record message in the target view */
        if (!oRecord && sNonRecordMsg) {
            showNonRecordMessage(sNonRecordMsg, sNonRecordClass);
            return;
        }

        if (getViewMode() === 'legacy') {

            oTabBar.style.display = 'none';
            oContainer.style.display = 'none';
            oLegacyContainer.style.display = '';
            renderLegacyView();
            return;
        }

        oTabBar.style.display = '';
        oContainer.style.display = '';
        oLegacyContainer.style.display = 'none';

        if (!oRecord) return;

        updateFieldCount();
        renderActivePanel();
    }

    /**
     * Renders the panel the user is looking at and marks the other two stale so
     * they re-render on their next activation instead of on every keystroke.
     */
    function renderActivePanel() {

        const sActive = document.querySelector('.tab-panel.active')?.id || 'panelBody';

        oDirty.body = sActive !== 'panelBody';
        oDirty.sublists = sActive !== 'panelSublists';
        oDirty.raw = sActive !== 'panelRaw';

        if (sActive === 'panelBody') {
            renderBodyFields();
        } else if (sActive === 'panelSublists') {
            renderActiveSublist();
        } else {
            renderRawJson();
        }
    }

    oViewModeSelect?.addEventListener('change', () => {

        saveSetting('fex_viewMode', oViewModeSelect.value);
        applyViewMode();
    });

    /* ──── Field Filter Handler ──── */

    oFieldFilterSelect?.addEventListener('change', () => {

        saveSetting('fex_fieldFilter', oFieldFilterSelect.value);

        if (!oRecord) return;

        updateFieldCount();

        if (getViewMode() === 'legacy') {
            renderLegacyView();
            return;
        }

        renderSublistSelector();
        renderActivePanel();
    });

    /* ──── Tab Switching ──── */

    /**
     * Activates a tab, moves the roving tabindex and renders the panel if stale.
     * @param {HTMLElement} pBtn - tab button to activate
     */
    function activateTab(pBtn) {

        aTabBtns.forEach((pOther) => {

            const bActive = pOther === pBtn;

            pOther.classList.toggle('active', bActive);
            pOther.setAttribute('aria-selected', bActive ? 'true' : 'false');
            pOther.tabIndex = bActive ? 0 : -1;
        });

        aTabPanels.forEach((pPanel) => pPanel.classList.remove('active'));

        const sTarget = pBtn.dataset.tab;

        document.getElementById(sTarget)?.classList.add('active');

        if (!oRecord) return;

        if (sTarget === 'panelBody' && oDirty.body) {
            renderBodyFields();
            oDirty.body = false;
        } else if (sTarget === 'panelSublists' && oDirty.sublists) {
            renderActiveSublist();
            oDirty.sublists = false;
        } else if (sTarget === 'panelRaw' && oDirty.raw) {
            renderRawJson();
            oDirty.raw = false;
        }
    }

    aTabBtns.forEach((pBtn) => {

        pBtn.addEventListener('click', () => activateTab(pBtn));
    });

    oTabBar?.addEventListener('keydown', (pEvent) => {

        if (pEvent.key !== 'ArrowLeft' && pEvent.key !== 'ArrowRight') return;

        const aBtns = Array.from(aTabBtns);
        const nCurrent = aBtns.indexOf(document.activeElement);

        if (nCurrent < 0) return;

        pEvent.preventDefault();

        const nNext = (nCurrent + (pEvent.key === 'ArrowRight' ? 1 : -1) + aBtns.length) % aBtns.length;

        activateTab(aBtns[nNext]);
        aBtns[nNext].focus();
    });

    /* ──── Search / Filter ──── */

    oSearchBox?.addEventListener('input', fexDebounce(() => {

        if (!oRecord) return;

        if (getViewMode() === 'legacy') {
            renderLegacyView();
            return;
        }

        renderActivePanel();
    }, 150));

    oSearchBox?.focus();

    /* ──── Sublist Selector ──── */

    oSublistSelect?.addEventListener('change', () => {

        renderActiveSublist();
    });

    /* One delegated pair for the whole sublist table - a capped render is still 500 rows wide */
    oSublistTable?.addEventListener('click', (pEvent) => {

        const oClickable = pEvent.target.closest?.('.clickable');

        if (oClickable) copySublistTarget(oClickable);
    });

    oSublistTable?.addEventListener('keydown', (pEvent) => {

        if (pEvent.key !== 'Enter' && pEvent.key !== ' ') return;

        const oClickable = pEvent.target.closest?.('.clickable');

        if (!oClickable) return;

        if (pEvent.key === ' ') pEvent.preventDefault();

        copySublistTarget(oClickable);
    });

    /* Lazily expanded legacy rows add anchors after render, so catch them on the way out */
    oLegacyTree?.addEventListener('click', (pEvent) => {

        const oAnchor = pEvent.target.closest?.('a[href]');

        if (!oAnchor) return;

        oAnchor.target = '_blank';
        oAnchor.rel = 'noopener noreferrer';
    }, true);

    /* ──── CSV Helpers ──── */

    /* Excel only detects UTF-8 in a downloaded CSV when the BOM is present */
    const CSV_BOM = '\ufeff';

    /**
     * Quotes a CSV cell and neutralizes values a spreadsheet would evaluate.
     * @param {*} pValue - cell value
     * @returns {string} quoted, formula-safe cell
     */
    function toCsvCell(pValue) {

        /* Half-width and full-width forms of the four spreadsheet formula leaders, plus
         * the whitespace a leading formula can hide behind (OWASP CSV injection) */
        const sValue = String(pValue ?? '');
        const sGuarded = /^[=+\-@\t\r\n＝＋－＠]/.test(sValue) ? `'${sValue}` : sValue;

        return `"${sGuarded.replace(/"/g, '""')}"`;
    }

    /**
     * Serializes rows to CSV text with the BOM prefix.
     * @param {Array<Array>} pRows - header row followed by data rows
     * @returns {string} CSV document
     */
    function buildCsv(pRows) {

        return CSV_BOM + pRows.map((pRow) => pRow.map((pCol) => toCsvCell(pCol)).join(',')).join('\n');
    }

    /* ──── Export Handlers ──── */

    /* Exports follow the field filter, ignore the search box and ignore the render cap */

    oExportJsonBtn?.addEventListener('click', () => {

        if (!oRecord) return;

        const sJson = JSON.stringify(buildExportObject(), null, 2);

        downloadFile(sJson, `${oRecord.sRecordType}_${oRecord.sId}.json`, 'application/json');
    });

    oExportCsvBtn?.addEventListener('click', () => {

        if (!oRecord) return;

        const aRows = [['Field ID', 'Value', 'Type']];

        Object.entries(filterFieldsByType(oRecord.oBodyFields)).forEach(([pKey, pValue]) => {

            aRows.push([pKey, stringifyFieldValue(pValue), detectFieldType(pKey, pValue)]);
        });

        downloadFile(buildCsv(aRows), `${oRecord.sRecordType}_${oRecord.sId}_fields.csv`, 'text/csv');
    });

    oExportSublistCsvBtn?.addEventListener('click', () => {

        if (!oRecord) return;

        const sSelected = oSublistSelect?.value;
        const aLines = sSelected ? oRecord.oSublists[sSelected] : null;

        if (!aLines || aLines.length === 0) return;

        const oColSet = new Set();

        aLines.forEach((pLine) => Object.keys(pLine).forEach((pKey) => oColSet.add(pKey)));

        const aCols = filterSublistCols(Array.from(oColSet));

        if (aCols.length === 0) return;

        const aRows = [['#', ...aCols]];

        aLines.forEach((pLine, pIndex) => {

            aRows.push([pIndex + 1, ...aCols.map((pCol) => formatDisplayValue(pLine[pCol]))]);
        });

        downloadFile(buildCsv(aRows), `${oRecord.sRecordType}_${oRecord.sId}_${sSelected}.csv`, 'text/csv');
    });

    /* ──── Copy Raw / Legacy JSON ──── */

    oCopyRawJsonBtn?.addEventListener('click', () => {

        if (!oRecord) return;

        copyWithFeedback(JSON.stringify(buildExportObject(), null, 2), oCopyRawJsonBtn, {
            label: 'Copied!',
            duration: 1500,
            labelTarget: oCopyRawJsonBtn.querySelector('span')
        });
    });

    oCopyLegacyJsonBtn?.addEventListener('click', () => {

        if (!oRecord) return;

        copyWithFeedback(JSON.stringify(buildExportObject(), null, 2), oCopyLegacyJsonBtn, {
            label: 'Copied!',
            duration: 1500,
            labelTarget: oCopyLegacyJsonBtn.querySelector('span')
        });
    });

    /* ──── Export Object Builder ──── */

    /**
     * Builds the filtered record projection shared by the JSON export and the
     * Raw JSON panel.
     * @returns {Object} export payload
     */
    function buildExportObject() {

        const oFilteredBody = filterFieldsByType(oRecord.oBodyFields);
        const oFilteredSublists = filterSublistsForLegacy(oRecord.oSublists);

        return {
            sRecordType: oRecord.sRecordType,
            sId: oRecord.sId,
            oBodyFields: oFilteredBody,
            oSublists: oFilteredSublists,
            nBodyFieldCount: Object.keys(oFilteredBody).length,
            nSublistCount: Object.keys(oFilteredSublists).length
        };
    }

    /* ──── Copy to Clipboard ──── */

    /** @type {WeakMap<HTMLElement, {nTimer: number, aOriginal: Array<Node>}>} */
    const oCopyState = new WeakMap();

    /**
     * Copies text and flashes the outcome on the element the user activated.
     * Per-element state keeps two copies within the restore window from
     * stranding a "Copied" label on either one.
     *
     * @param {string} pText - text to copy
     * @param {HTMLElement} pElement - element carrying the feedback classes
     * @param {Object} [pOpts] - { label, duration, labelTarget }
     */
    function copyWithFeedback(pText, pElement, pOpts) {

        if (!pElement) return;

        const oOpts = pOpts || {};
        const oTarget = oOpts.labelTarget || pElement;
        const oPending = oCopyState.get(pElement);
        const nDuration = oOpts.duration || 1000;

        /* Hold the nodes rather than the text: a cell rendered under an active
         * search carries <mark> children that textContent would flatten away */
        const aOriginal = oPending ? oPending.aOriginal : Array.from(oTarget.childNodes);

        if (oPending) clearTimeout(oPending.nTimer);

        const fnFlash = (pLabel, pClass, pDelay) => {

            oTarget.textContent = pLabel;
            pElement.classList.add(pClass);

            const nTimer = setTimeout(() => {

                oTarget.textContent = '';
                aOriginal.forEach((pNode) => oTarget.appendChild(pNode));
                pElement.classList.remove(pClass);
                oCopyState.delete(pElement);
            }, pDelay);

            oCopyState.set(pElement, { nTimer: nTimer, aOriginal: aOriginal });
        };

        navigator.clipboard.writeText(pText)
            .then(() => fnFlash(oOpts.label || '✓ Copied', 'copied', nDuration))
            .catch(() => fnFlash('Copy failed', 'copy-error', 1500));
    }

    /**
     * Builds the inner copy affordance for a table cell. Table elements keep
     * their native semantics; the button role lives on this span.
     *
     * @param {string} pLabel - accessible label
     * @param {DocumentFragment|string} pContent - visible content
     * @param {string} [pClass] - class list, defaults to 'clickable'
     * @returns {HTMLSpanElement}
     */
    function createCopySpan(pLabel, pContent, pClass) {

        const oSpan = document.createElement('span');

        oSpan.className = pClass || 'clickable';
        oSpan.setAttribute('role', 'button');
        oSpan.setAttribute('aria-label', pLabel);
        oSpan.tabIndex = 0;
        oSpan.title = 'Click to copy';

        if (typeof pContent === 'string') {
            oSpan.textContent = pContent;
        } else {
            oSpan.appendChild(pContent);
        }

        return oSpan;
    }

    /**
     * Wires pointer and keyboard activation on a copy affordance.
     * @param {HTMLElement} pElement - copy affordance
     * @param {string} pText - text to copy
     */
    function bindCopyTarget(pElement, pText) {

        pElement.addEventListener('click', () => copyWithFeedback(pText, pElement));

        pElement.addEventListener('keydown', (pEvent) => {

            if (pEvent.key !== 'Enter' && pEvent.key !== ' ') return;
            if (pEvent.key === ' ') pEvent.preventDefault();

            copyWithFeedback(pText, pElement);
        });
    }

    /* ──── Download Helper ──── */

    /**
     * Triggers browser download of generated content
     * @param {string} pContent - file content
     * @param {string} pFilename - download filename
     * @param {string} pMimeType - MIME type (e.g., 'application/json')
     */
    function downloadFile(pContent, pFilename, pMimeType) {

        const oBlob = new Blob([pContent], { type: pMimeType });
        const sUrl = URL.createObjectURL(oBlob);
        const oLink = document.createElement('a');

        oLink.href = sUrl;
        oLink.download = pFilename;
        document.body.appendChild(oLink);
        oLink.click();
        oLink.remove();
        URL.revokeObjectURL(sUrl);
    }

    /* ──── Empty Row Helper ──── */

    /**
     * Creates a single-row table message (e.g. "No results")
     * @param {number} pColSpan - number of columns to span
     * @param {string} pMessage - message text
     * @param {string} [pClass] - CSS class for the td (default: 'empty-msg')
     * @returns {HTMLTableRowElement}
     */
    function createEmptyRow(pColSpan, pMessage, pClass) {

        const oTr = document.createElement('tr');
        const oTd = document.createElement('td');

        oTd.colSpan = pColSpan;
        oTd.className = pClass || 'empty-msg';
        oTd.textContent = pMessage;
        oTr.appendChild(oTd);

        return oTr;
    }

    /* ──── Field Type Detection ──── */

    /**
     * Infers field type from field ID and value patterns
     * @param {string} pFieldId - field ID
     * @param {*} pValue - field value
     * @returns {string} field type (checkbox, date, select, currency, etc.)
     */
    function detectFieldType(pFieldId, pValue) {

        const sId = (pFieldId || '').toLowerCase();
        const sVal = String(pValue ?? '');

        if (sVal === 'T' || sVal === 'F') return 'checkbox';
        if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(sVal)) return 'date';
        if (/\d{4}-\d{2}-\d{2}T/.test(sVal)) return 'datetime';

        if (typeof pValue === 'object' && pValue !== null) {
            if (pValue._text || pValue.__text) return 'select';
            if (Array.isArray(pValue)) return 'multiselect';
            return 'object';
        }

        if (/^-?\d+\.\d{2}$/.test(sVal) && !sId.includes('id')) return 'currency';
        if (/^-?\d+(\.\d+)?$/.test(sVal) && sVal.length < 15) return 'number';
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sVal)) return 'email';
        if (/^https?:\/\//.test(sVal)) return 'url';
        if (sId.endsWith('id') || sId === 'id' || sId === '_id') return 'id';

        return 'text';
    }

    /**
     * Returns icon/emoji for a field type
     * @param {string} pType - field type
     * @returns {string} icon character
     */
    function getTypeIcon(pType) {

        const oMap = {
            'checkbox':    '☑',
            'date':        '📅',
            'datetime':    '📅',
            'select':      '▼',
            'multiselect': '▼▼',
            'currency':    '💲',
            'number':      '#',
            'email':       '✉',
            'url':         '🔗',
            'id':          '🔑',
            'object':      '{}',
            'text':        'Aa'
        };

        return oMap[pType] || 'Aa';
    }

    /* ──── Fetch & Parse Record via &xml=T ──── */

    /**
     * Shows a message across both new and legacy view containers.
     * @param {string} pText - message to display
     * @param {string} [pClass] - message class ('empty-msg' or 'error-msg')
     */
    function showNonRecordMessage(pText, pClass) {

        sNonRecordMsg = pText;
        sNonRecordClass = pClass || 'empty-msg';

        oTabBar.style.display = 'none';

        [oExportJsonBtn, oExportCsvBtn, oExportSublistCsvBtn].forEach((pBtn) => {

            if (!pBtn) return;

            pBtn.disabled = true;
            pBtn.style.opacity = '0.4';
        });

        const oMsg = document.createElement('div');

        oMsg.className = sNonRecordClass;
        oMsg.textContent = pText;

        if (getViewMode() === 'legacy') {

            oContainer.style.display = 'none';
            oLegacyTree.textContent = '';
            oLegacyTree.appendChild(oMsg);
            oLegacyContainer.style.display = '';
            return;
        }

        oLegacyContainer.style.display = 'none';
        oContainer.textContent = '';
        oContainer.appendChild(oMsg);
        oContainer.style.display = '';
    }

    const [oTab] = await browserAPI.tabs.query({ active: true, currentWindow: true });

    let oTabUrl = null;

    try {
        oTabUrl = oTab?.url ? new URL(oTab.url) : null;
    } catch (_e) {
        oTabUrl = null;
    }

    if (!oTabUrl || !isNetSuiteHostname(oTabUrl.hostname)) {

        showNonRecordMessage('Not on a NetSuite page.');
        return;
    }

    /* Check if this looks like a record page (has standalone id= parameter) */
    if (!oTabUrl.searchParams.has('id')) {

        showNonRecordMessage('No record detected on this page. Use the Nav Manager button (folder icon) in the toolbar to manage navigation menus.');
        return;
    }

    const oXmlUrl = new URL(oTabUrl);
    oXmlUrl.searchParams.set('xml', 'T');

    try {

        const [oResult] = await browserAPI.scripting.executeScript({
            target: { tabId: oTab.id },
            func: async (pUrl) => {

                try {
                    const oResp = await fetch(pUrl, { credentials: 'include' });
                    if (!oResp.ok) return { error: `HTTP ${oResp.status}` };
                    return { data: await oResp.text() };
                } catch (pErr) {
                    return { error: pErr.message };
                }
            },
            args: [oXmlUrl.toString()]
        });

        if (oResult.result?.error) {

            showNonRecordMessage(`Failed to fetch record: ${oResult.result.error}`, 'error-msg');
            return;
        }

        const sXmlData = oResult.result?.data;

        if (!sXmlData) {
            showNonRecordMessage('No data returned. Are you on a record page?');
            return;
        }

        oRecord = parseXmlRecord(sXmlData);

        if (!oRecord) {
            showNonRecordMessage('Could not parse record data. Are you on a record page?');
            return;
        }

        /* Render all views (or defer if Nav Manager is open) */
        window.fex.renderIfReady();

    } catch (pErr) {
        showNonRecordMessage(`Error: ${pErr.message}`, 'error-msg');
    }

    /* ──── XML Parser ──── */

    /**
     * Parses NetSuite XML record into structured data
     * @param {string} pXmlString - XML string from &xml=T URL
     * @returns {Object|null} parsed record with sRecordType, sId, oBodyFields, oSublists
     */
    function parseXmlRecord(pXmlString) {

        const oParser = new DOMParser();
        const oDoc = oParser.parseFromString(pXmlString, 'text/xml');

        const oRecordNode = oDoc.querySelector('record');

        if (!oRecordNode) return null;

        const sRecordType = oRecordNode.getAttribute('recordType') || '';
        const sId = oRecordNode.getAttribute('id') || '';
        const oBodyFields = {};
        const oSublists = {};

        Array.from(oRecordNode.children).forEach(pChild => {

            const sName = pChild.nodeName;

            if (sName === 'machine') {

                const sSublistName = pChild.getAttribute('name') || sName;
                const aLines = [];

                Array.from(pChild.children).filter(pEl => pEl.nodeName === 'line').forEach(pLine => {

                    const oLineData = {};

                    Array.from(pLine.children).forEach(pField => {

                        oLineData[pField.nodeName] = parseFieldNode(pField);
                    });

                    Array.from(pLine.attributes).forEach(pAttr => {

                        if (!oLineData[pAttr.name]) {
                            oLineData[pAttr.name] = pAttr.value;
                        }
                    });

                    aLines.push(oLineData);
                });

                oSublists[sSublistName] = aLines;

            } else {

                oBodyFields[sName] = parseFieldNode(pChild);
            }
        });

        Array.from(oRecordNode.attributes).forEach(pAttr => {

            if (pAttr.name !== 'recordType' && pAttr.name !== 'id') {
                oBodyFields['_' + pAttr.name] = pAttr.value;
            }
        });

        return {
            sRecordType: sRecordType,
            sId: sId,
            oBodyFields: oBodyFields,
            oSublists: oSublists,
            nBodyFieldCount: Object.keys(oBodyFields).length,
            nSublistCount: Object.keys(oSublists).length
        };
    }

    /**
     * Recursively parses an XML field node into JS value
     * @param {Element} pNode - XML DOM node
     * @returns {*} parsed value (string, object, or nested structure)
     */
    function parseFieldNode(pNode) {

        if (pNode.children.length > 0) {

            const oObj = {};

            Array.from(pNode.children).forEach(pChild => {

                const sName = pChild.nodeName;
                const vParsed = parseFieldNode(pChild);

                if (sName in oObj) {
                    /* Duplicate child name — convert to array */
                    if (!Array.isArray(oObj[sName])) {
                        oObj[sName] = [oObj[sName]];
                    }
                    oObj[sName].push(vParsed);
                } else {
                    oObj[sName] = vParsed;
                }
            });

            const sText = pNode.textContent?.trim();
            if (sText && Object.keys(oObj).length === 0) return sText;

            Array.from(pNode.attributes).forEach(pAttr => {

                oObj['_' + pAttr.name] = pAttr.value;
            });

            return oObj;
        }

        if (pNode.attributes.length > 0) {

            const oObj = { _value: pNode.textContent?.trim() || '' };

            Array.from(pNode.attributes).forEach(pAttr => {

                oObj['_' + pAttr.name] = pAttr.value;
            });

            if (Object.keys(oObj).length === 1) return oObj._value;

            return oObj;
        }

        return pNode.textContent?.trim() || '';
    }

    /* ──── Render: Record Info Header ──── */

    /**
     * Renders record type and ID in header
     */
    function renderRecordInfo() {

        if (!oRecordInfo || !oRecord) return;

        oRecordInfo.textContent = '';

        const aInfoParts = [
            { label: 'Record:', value: oRecord.sRecordType },
            { label: null, value: '|', cls: 'info-sep' },
            { label: 'ID:', value: oRecord.sId }
        ];

        aInfoParts.forEach((pPart) => {

            if (pPart.label) {

                const oLabel = document.createElement('span');

                oLabel.className = 'info-label';
                oLabel.textContent = pPart.label;
                oRecordInfo.appendChild(oLabel);
            }

            if (pPart.cls) {

                const oSep = document.createElement('span');

                oSep.className = pPart.cls;
                oSep.textContent = pPart.value;
                oRecordInfo.appendChild(oSep);
                return;
            }

            const oVal = createCopySpan(`Copy ${pPart.value}`, pPart.value, 'info-value clickable');

            bindCopyTarget(oVal, pPart.value);
            oRecordInfo.appendChild(oVal);
        });

        updateFieldCount();
    }

    /** Updates the field/sublist count badge based on current filter */
    function updateFieldCount() {

        if (!oFieldCount || !oRecord) return;

        const nBodyCount = Object.keys(filterFieldsByType(oRecord.oBodyFields)).length;
        const sFilter = oFieldFilterSelect?.value || 'all';
        const sLabel = sFilter === 'all' ? '' : (sFilter === 'custom' ? 'custom ' : 'standard ');

        /* Sublists stay unfiltered so the badge always agrees with the dropdown */
        oFieldCount.textContent = `${nBodyCount} ${sLabel}fields · ${oRecord.nSublistCount} sublists`;
    }

    /* ──── Render: Body Fields Table ──── */

    /**
     * Renders body fields table with search/filter applied
     */
    function renderBodyFields() {

        if (!oBodyFieldsTable || !oRecord) return;

        const sSearch = (oSearchBox?.value || '').toLowerCase();
        const aEntries = Object.entries(filterFieldsByType(oRecord.oBodyFields));

        const aFiltered = sSearch
            ? aEntries.filter(([pKey, pVal]) =>
                pKey.toLowerCase().includes(sSearch)
                || stringifyFieldValue(pVal).toLowerCase().includes(sSearch))
            : aEntries;

        /* Sort if a column is selected */
        if (nSortColumn !== null) {

            aFiltered.sort((pA, pB) => {

                let sValA = '';
                let sValB = '';

                if (nSortColumn === 0) {
                    sValA = pA[0].toLowerCase();
                    sValB = pB[0].toLowerCase();
                } else if (nSortColumn === 1) {
                    sValA = formatDisplayValue(pA[1]).toLowerCase();
                    sValB = formatDisplayValue(pB[1]).toLowerCase();
                } else if (nSortColumn === 2) {
                    sValA = detectFieldType(pA[0], pA[1]).toLowerCase();
                    sValB = detectFieldType(pB[0], pB[1]).toLowerCase();
                }

                if (sValA < sValB) return bSortAsc ? -1 : 1;
                if (sValA > sValB) return bSortAsc ? 1 : -1;
                return 0;
            });
        }

        if (aFiltered.length === 0) {

            const sFilter = oFieldFilterSelect?.value || 'all';

            oBodyFieldsTable.textContent = '';
            oBodyFieldsTable.appendChild(createEmptyRow(3, sSearch
                ? 'No fields match your search.'
                : (sFilter === 'all' ? 'No fields in this record.' : `No ${sFilter} fields in this record.`)));
            return;
        }

        const oFrag = document.createDocumentFragment();

        aFiltered.forEach(([pKey, pValue]) => {

            const sType = detectFieldType(pKey, pValue);
            const oRow = document.createElement('tr');

            const oIdTd = document.createElement('td');
            oIdTd.className = 'col-id';
            const oIdSpan = createCopySpan(`Copy field ${pKey}`, highlightSearch(pKey, sSearch));
            bindCopyTarget(oIdSpan, pKey);
            oIdTd.appendChild(oIdSpan);
            oRow.appendChild(oIdTd);

            const oValTd = document.createElement('td');
            oValTd.className = 'col-value';
            const sDisplayVal = formatDisplayValue(pValue);
            const oValSpan = createCopySpan(`Copy value of ${pKey}`, highlightSearch(sDisplayVal, sSearch));
            bindCopyTarget(oValSpan, stringifyFieldValue(pValue));
            oValTd.appendChild(oValSpan);
            oRow.appendChild(oValTd);

            const oTypeTd = document.createElement('td');
            oTypeTd.className = 'col-type';
            const oTypeBadge = document.createElement('span');
            oTypeBadge.className = 'type-badge';
            oTypeBadge.title = sType;
            oTypeBadge.textContent = getTypeIcon(sType);
            oTypeTd.appendChild(oTypeBadge);
            oRow.appendChild(oTypeTd);

            oFrag.appendChild(oRow);
        });

        oBodyFieldsTable.textContent = '';
        oBodyFieldsTable.appendChild(oFrag);
    }

    /* ──── Render: Sublist Selector & Table ──── */

    /**
     * Populates sublist dropdown selector, preserving the current selection.
     */
    function renderSublistSelector() {

        if (!oSublistSelect || !oRecord) return;

        const sPrevious = oSublistSelect.value;
        const aSublistNames = Object.keys(oRecord.oSublists);

        oSublistSelect.textContent = '';

        if (aSublistNames.length === 0) {

            const oOpt = document.createElement('option');

            oOpt.value = '';
            oOpt.disabled = true;
            oOpt.textContent = 'No sublists found';
            oSublistSelect.appendChild(oOpt);
            return;
        }

        aSublistNames.forEach((pName) => {

            const oOpt = document.createElement('option');

            oOpt.value = pName;
            oOpt.textContent = `${pName} (${oRecord.oSublists[pName].length} lines)`;
            oSublistSelect.appendChild(oOpt);
        });

        if (aSublistNames.includes(sPrevious)) oSublistSelect.value = sPrevious;
    }

    /**
     * Renders currently selected sublist as table with columns/rows
     */
    function renderActiveSublist() {

        if (!oSublistTable || !oRecord) return;

        aRenderedCols = [];
        aRenderedLines = [];

        const sSelected = oSublistSelect?.value;
        const sFilter = oFieldFilterSelect?.value || 'all';

        if (!sSelected || !oRecord.oSublists[sSelected]) {

            oSublistTable.textContent = '';
            oSublistTable.appendChild(createEmptyRow(1, oRecord.nSublistCount === 0
                ? 'This record has no sublists.'
                : 'Select a sublist above.'));
            return;
        }

        const aLines = oRecord.oSublists[sSelected];

        if (aLines.length === 0) {

            oSublistTable.textContent = '';
            oSublistTable.appendChild(createEmptyRow(1, 'No lines in this sublist.'));
            return;
        }

        const oColSet = new Set();

        aLines.forEach((pLine) => Object.keys(pLine).forEach((pKey) => oColSet.add(pKey)));

        const aCols = filterSublistCols(Array.from(oColSet));

        if (aCols.length === 0) {

            oSublistTable.textContent = '';
            oSublistTable.appendChild(createEmptyRow(1, sFilter === 'all'
                ? 'No fields in this sublist.'
                : `No ${sFilter} fields in this sublist.`));
            return;
        }

        const sSearch = (oSearchBox?.value || '').toLowerCase();

        const aFilteredCols = sSearch
            ? aCols.filter((pCol) =>
                pCol.toLowerCase().includes(sSearch)
                || aLines.some((pLine) => stringifyFieldValue(pLine[pCol]).toLowerCase().includes(sSearch)))
            : aCols;

        if (aFilteredCols.length === 0) {

            oSublistTable.textContent = '';
            oSublistTable.appendChild(createEmptyRow(1, 'No fields match your search.'));
            return;
        }

        /* A column id hit keeps every line; otherwise a line needs a value hit */
        const bColIdHit = !sSearch || aFilteredCols.some((pCol) => pCol.toLowerCase().includes(sSearch));
        const aVisibleLines = [];

        aLines.forEach((pLine, pIndex) => {

            const bKeep = bColIdHit
                || aFilteredCols.some((pCol) => stringifyFieldValue(pLine[pCol]).toLowerCase().includes(sSearch));

            /* Line numbers stay absolute so a filtered view still maps back to the record */
            if (bKeep) aVisibleLines.push({ nNumber: pIndex + 1, oLine: pLine });
        });

        if (aVisibleLines.length === 0) {

            oSublistTable.textContent = '';
            oSublistTable.appendChild(createEmptyRow(aFilteredCols.length + 1, 'No lines match your search.'));
            return;
        }

        aRenderedCols = aFilteredCols;
        aRenderedLines = aVisibleLines.slice(0, nSublistRenderCap);

        const oFrag = document.createDocumentFragment();
        const oHeaderRow = document.createElement('tr');

        oHeaderRow.className = 'sublist-header';

        const oLineNumTh = document.createElement('th');

        oLineNumTh.textContent = '#';
        oHeaderRow.appendChild(oLineNumTh);

        aFilteredCols.forEach((pCol) => {

            const oTh = document.createElement('th');

            oTh.appendChild(createCopySpan(`Copy field ${pCol}`, pCol));
            oHeaderRow.appendChild(oTh);
        });

        oFrag.appendChild(oHeaderRow);

        aRenderedLines.forEach((pEntry) => {

            const oRow = document.createElement('tr');
            const oLineNumTd = document.createElement('td');

            oLineNumTd.className = 'line-num';
            oLineNumTd.textContent = pEntry.nNumber;
            oRow.appendChild(oLineNumTd);

            aFilteredCols.forEach((pCol) => {

                const oTd = document.createElement('td');
                const sDisplay = formatDisplayValue(pEntry.oLine[pCol]);

                oTd.appendChild(createCopySpan(`Copy value of ${pCol}`, highlightSearch(sDisplay, sSearch)));
                oRow.appendChild(oTd);
            });

            oFrag.appendChild(oRow);
        });

        if (aVisibleLines.length > nSublistRenderCap) {

            oFrag.appendChild(createEmptyRow(aFilteredCols.length + 1,
                `Showing first ${nSublistRenderCap} of ${aVisibleLines.length} lines - use search to narrow.`));
        }

        oSublistTable.textContent = '';
        oSublistTable.appendChild(oFrag);
    }

    /**
     * Copies the cell or header behind a delegated sublist activation.
     * @param {HTMLElement} pClickable - activated copy affordance
     */
    function copySublistTarget(pClickable) {

        const oCell = pClickable.closest('td, th');
        const oRow = oCell?.parentElement;

        if (!oCell || !oRow) return;

        /* Column 0 is the line-number gutter, row 0 is the header row */
        const nColIndex = oCell.cellIndex - 1;

        if (nColIndex < 0 || nColIndex >= aRenderedCols.length) return;

        const sCol = aRenderedCols[nColIndex];

        if (oCell.tagName === 'TH') {

            copyWithFeedback(sCol, pClickable);
            return;
        }

        const oEntry = aRenderedLines[oRow.rowIndex - 1];

        if (oEntry) copyWithFeedback(stringifyFieldValue(oEntry.oLine[sCol]), pClickable);
    }

    /* ──── Render: Raw JSON ──── */

    /**
     * Renders raw JSON view of filtered record data
     */
    function renderRawJson() {

        if (!oRawJsonContainer || !oRecord) return;

        let oPre = oRawJsonContainer.querySelector('.raw-json');

        if (!oPre) {

            oPre = document.createElement('pre');
            oPre.className = 'raw-json';
            oRawJsonContainer.appendChild(oPre);
        }

        oPre.textContent = JSON.stringify(buildExportObject(), null, 2);
    }

    /* ──── Render: Legacy Mode (JSONFormatter) ──── */

    /**
     * Renders legacy tree view using JSONFormatter library
     */
    function renderLegacyView() {

        if (!oLegacyTree || !oRecord) return;

        const sSearch = (oSearchBox?.value || '').toLowerCase();

        const oLegacyData = {
            recordType: oRecord.sRecordType,
            id: oRecord.sId,
            bodyFields: filterFieldsByType(oRecord.oBodyFields),
            lineFields: filterSublistsForLegacy(oRecord.oSublists)
        };

        /* Apply search filter if searching */
        const [oDisplayData, nExpandLevels] = sSearch
            ? [filterLegacyRecord(oLegacyData, sSearch), Infinity]
            : [oLegacyData, 2];

        const oFormatter = new JSONFormatter(oDisplayData, nExpandLevels, {
            theme: 'dark'
        });

        oLegacyTree.textContent = '';
        oLegacyTree.appendChild(oFormatter.render());

        if (sSearch) {

            const oRegex = new RegExp(escapeRegex(sSearch), 'i');
            const oWalker = document.createTreeWalker(oLegacyTree, NodeFilter.SHOW_TEXT);
            const aNodesToSplit = [];

            while (oWalker.nextNode()) {

                if (oRegex.test(oWalker.currentNode.textContent)) {
                    aNodesToSplit.push(oWalker.currentNode);
                }
            }

            aNodesToSplit.forEach((pNode) => {

                const oWrapper = document.createElement('span');

                oWrapper.appendChild(highlightSearch(pNode.textContent, sSearch, 'span', 'searchresult'));
                pNode.parentNode.replaceChild(oWrapper, pNode);
            });
        }

        /* Anchors rendered from http-prefixed field values would navigate the popup away */
        oLegacyTree.querySelectorAll('a[href]').forEach((pAnchor) => {

            pAnchor.target = '_blank';
            pAnchor.rel = 'noopener noreferrer';
        });
    }

    /**
     * Deep filter for legacy record object — matches old extension behavior
     * Recursively filters object properties by search term
     * @param {Object} pObject - record object to filter
     * @param {string} pSearchTerm - search term
     * @returns {Object} filtered object
     */
    function filterLegacyRecord(pObject, pSearchTerm) {

        return deepFilterObject(pObject, pSearchTerm.toUpperCase());
    }

    /**
     * Recursively filters object properties by uppercase search term
     * @param {*} pObj - object to filter
     * @param {string} pSearchUpper - uppercase search term
     * @returns {*} filtered object or array
     */
    function deepFilterObject(pObj, pSearchUpper) {

        if (typeof pObj !== 'object' || pObj === null) return pObj;

        const oResult = Array.isArray(pObj) ? [] : {};

        Object.entries(pObj).forEach(([pKey, pValue]) => {

            if (typeof pValue !== 'object' || pValue === null) {

                const sKeyStr = String(pKey).toUpperCase();
                const sValStr = String(pValue ?? '').toUpperCase();

                if (sKeyStr.includes(pSearchUpper) || sValStr.includes(pSearchUpper)) {
                    oResult[pKey] = pValue;
                }

            } else {

                const oFiltered = deepFilterObject(pValue, pSearchUpper);

                if (Object.keys(oFiltered).length > 0) {
                    oResult[pKey] = oFiltered;
                }
            }
        });

        return oResult;
    }

    /* ──── Render: Links ──── */

    /**
     * Updates documentation links with current record type
     */
    function updateLinks() {

        if (!oRecord) return;

        const RECORDS_BROWSER_URL = 'https://system.netsuite.com/help/helpcenter/en_US/srbrowser/Browser2025_2/script/record';
        const RECORDS_CATALOG_URL = 'https://system.netsuite.com/app/recordscatalog/rcbrowser.nl?whence=#/record_ss';

        const sEncodedType = encodeURIComponent(oRecord.sRecordType);

        if (oRecordsBrowserLink) {
            oRecordsBrowserLink.href = `${RECORDS_BROWSER_URL}/${sEncodedType}.html`;
            oRecordsBrowserLink.style.display = 'inline';
        }

        if (oRecordsCatalogLink) {
            oRecordsCatalogLink.href = `${RECORDS_CATALOG_URL}/${sEncodedType}`;
            oRecordsCatalogLink.style.display = 'inline';
        }
    }

    /* ──── Display Helpers ──── */

    /**
     * Formats field value for display (handles objects with _text/_value)
     * @param {*} pValue - field value
     * @returns {string} formatted display string
     */
    function formatDisplayValue(pValue) {

        if (pValue === null || pValue === undefined) return '';

        if (typeof pValue === 'object') {

            if (pValue._text) return `${pValue._text} [${pValue._value || ''}]`;
            if (pValue.__text) return `${pValue.__text} [${pValue._value || ''}]`;

            return JSON.stringify(pValue);
        }

        return String(pValue);
    }

    /**
     * Creates a DocumentFragment with search term matches wrapped in highlight elements.
     * @param {string} pText - text to highlight
     * @param {string} pSearch - lowercase search term
     * @param {string} [pTag] - element name for matches (default: 'mark')
     * @param {string} [pClass] - class applied to match elements
     * @returns {DocumentFragment} fragment with text nodes and highlight elements
     */
    function highlightSearch(pText, pSearch, pTag = 'mark', pClass = '') {

        const oFrag = document.createDocumentFragment();

        if (!pText) return oFrag;

        if (!pSearch) {
            oFrag.appendChild(document.createTextNode(pText));
            return oFrag;
        }

        const oRegex = new RegExp('(' + escapeRegex(pSearch) + ')', 'gi');
        let nLastIndex = 0;
        let aMatch;

        while ((aMatch = oRegex.exec(pText)) !== null) {

            if (aMatch.index > nLastIndex) {
                oFrag.appendChild(document.createTextNode(pText.slice(nLastIndex, aMatch.index)));
            }

            const oHit = document.createElement(pTag);

            if (pClass) oHit.className = pClass;

            oHit.textContent = aMatch[1];
            oFrag.appendChild(oHit);
            nLastIndex = oRegex.lastIndex;
        }

        if (nLastIndex < pText.length) {
            oFrag.appendChild(document.createTextNode(pText.slice(nLastIndex)));
        }

        return oFrag;
    }

    /**
     * Escapes regex special characters
     * @param {string} pStr - string to escape
     * @returns {string} regex-safe string
     */
    function escapeRegex(pStr) {

        return pStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
};
