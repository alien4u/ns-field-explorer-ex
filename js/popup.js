/**
 * Bridge between popup.js and navmanager.js. Created before any await so the
 * Nav Manager never races the async init of the explorer.
 */
window.fex = {
    navOpen: false,
    renderIfReady: () => {},
    applySearch: () => {}
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

    /* Before anything can fail or gate the page: the footer shows the version everywhere */
    const oFooterVersion = document.getElementById('footerVersion');

    if (oFooterVersion) oFooterVersion.textContent = `Field Explorer EX v${browserAPI.runtime.getManifest().version}`;

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
    const oShowEmptyToggle = document.getElementById('showEmptyToggle');
    const oPinBtn = document.getElementById('pinBtn');
    const oPinStatus = document.getElementById('pinStatus');

    /* Links */
    const oRecordsBrowserLink = document.getElementById('recordsBrowserLink');
    const oRecordsCatalogLink = document.getElementById('recordsCatalogLink');

    /* Tab content containers */
    const oBodyFieldsTable = document.getElementById('bodyFieldsTable');
    const oSublistSelect = document.getElementById('sublistSelect');
    const oSublistTable = document.getElementById('sublistTable');
    const oRawJsonContainer = document.getElementById('rawJsonContainer');
    const oCopyRawJsonBtn = document.getElementById('copyRawJsonBtn');
    const oCompareHeader = document.getElementById('compareHeader');
    const oCompareBody = document.getElementById('compareBody');

    /* Tab buttons relabelled at runtime */
    const oTabBtnBody = document.getElementById('tabBtnBody');
    const oTabBtnSublists = document.getElementById('tabBtnSublists');
    const oTabBtnCompare = document.getElementById('tabBtnCompare');

    /* Legacy mode containers */
    const oTabBar = document.getElementById('tabBar');
    const oLegacyContainer = document.getElementById('legacyContainer');
    const oLegacyTree = document.getElementById('legacyTree');
    const oCopyLegacyJsonBtn = document.getElementById('copyLegacyJsonBtn');

    /* Parsed record data */
    let oRecord = null;

    /* Labels and types per field, merged from the page and the Oracle reference */
    let oFieldMeta = { oBody: {}, oSublists: {} };

    /* Rows matching the current term, filter and Empty state. Tab counts, the sublist dropdown
     * and the tables all read this one result, so they cannot disagree. */
    let oSearchView = null;

    /* Line haystacks, built once per sublist the first time a term is set */
    const oSublistIndexes = {};

    /* Pinned snapshot and its diff against the loaded record */
    const oSessionStore = browserAPI.storage.session || null;
    let oPinned = null;
    let oCompareDiff = null;
    let sCurrentAccount = '';

    /* Non-record page message (set when no record detected) */
    let sNonRecordMsg = '';
    let sNonRecordClass = 'empty-msg';

    /* Sort state */
    let nSortColumn = null;
    let bSortAsc = true;

    /* Panels holding stale output because a render was skipped while they were hidden */
    const oDirty = { body: false, sublists: false, raw: false, compare: false };

    /* Rows currently painted in the sublist table, resolved by the delegated copy handler */
    let aRenderedCols = [];
    let aRenderedLines = [];

    const nSublistRenderCap = 500;

    /* ──── Filter Helpers ──── */

    /**
     * @returns {string} active field filter ('all', 'custom' or 'standard')
     */
    function getFieldFilter() {

        return oFieldFilterSelect?.value || 'all';
    }

    /**
     * @returns {string} lowercase search term, '' for none
     */
    function getSearchTerm() {

        return (oSearchBox?.value || '').toLowerCase();
    }

    /**
     * Tests a field ID against the active field filter.
     * @param {string} pFieldId - field ID to check
     * @returns {boolean} true when the field survives the filter
     */
    function matchesFieldFilter(pFieldId) {

        return passesFieldFilter(pFieldId, getFieldFilter());
    }

    /**
     * @returns {string} active view mode ('new' or 'legacy')
     */
    function getViewMode() {

        return oViewModeSelect?.value || 'new';
    }

    /**
     * Filters an object of fields based on current field filter setting.
     * @param {Object} pFields - key/value pairs to filter
     * @returns {Object} filtered fields
     */
    function filterFieldsByType(pFields) {

        if (getFieldFilter() === 'all') return pFields;

        const oFiltered = {};

        Object.entries(pFields).forEach(([pKey, pVal]) => {

            if (matchesFieldFilter(pKey)) oFiltered[pKey] = pVal;
        });

        return oFiltered;
    }

    /**
     * Filters sublist line data for legacy mode.
     * Removes columns from each line object based on filter.
     * @param {Object} pSublists - { sublistName: [line, ...] }
     * @returns {Object} filtered sublists
     */
    function filterSublistsForLegacy(pSublists) {

        if (getFieldFilter() === 'all') return pSublists;

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
    const FEX_ROAMING_KEYS = [
        'fex_darkMode', 'fex_compactMode', 'fex_viewMode', 'fex_fieldFilter', 'fex_showEmpty'
    ];

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

        /* The formatter fixes its colors at render time, so a visible tree has to be rebuilt */
        if (oRecord && getViewMode() === 'legacy' && !window.fex.navOpen) renderLegacyView();

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

    if (oShowEmptyToggle) oShowEmptyToggle.checked = oSettings.fex_showEmpty === true;

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
        updateCompareTab();

        if (oPinBtn && oSessionStore) oPinBtn.style.display = '';

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
        updateTabLabels();
        renderActivePanel();
    }

    /**
     * Renders the panel the user is looking at and marks the others stale so
     * they re-render on their next activation instead of on every keystroke.
     */
    function renderActivePanel() {

        const sActive = document.querySelector('.tab-panel.active')?.id || 'panelBody';

        oDirty.body = sActive !== 'panelBody';
        oDirty.sublists = sActive !== 'panelSublists';
        oDirty.raw = sActive !== 'panelRaw';
        oDirty.compare = sActive !== 'panelCompare';

        if (sActive === 'panelBody') {
            renderBodyFields();
        } else if (sActive === 'panelSublists') {
            renderSublistPanel();
        } else if (sActive === 'panelCompare') {
            renderCompare();
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

        updateTabLabels();
        renderActivePanel();
    });

    /* ──── Empty Fields Handler ──── */

    oShowEmptyToggle?.addEventListener('change', () => {

        saveSetting('fex_showEmpty', oShowEmptyToggle.checked);

        if (!oRecord || getViewMode() === 'legacy') return;

        updateTabLabels();
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
            renderSublistPanel();
            oDirty.sublists = false;
        } else if (sTarget === 'panelRaw' && oDirty.raw) {
            renderRawJson();
            oDirty.raw = false;
        } else if (sTarget === 'panelCompare' && oDirty.compare) {
            renderCompare();
            oDirty.compare = false;
        }
    }

    aTabBtns.forEach((pBtn) => {

        pBtn.addEventListener('click', () => activateTab(pBtn));
    });

    oTabBar?.addEventListener('keydown', (pEvent) => {

        if (pEvent.key !== 'ArrowLeft' && pEvent.key !== 'ArrowRight') return;

        const aBtns = Array.from(aTabBtns).filter((pBtn) => pBtn.style.display !== 'none');
        const nCurrent = aBtns.indexOf(document.activeElement);

        if (nCurrent < 0) return;

        pEvent.preventDefault();

        const nNext = (nCurrent + (pEvent.key === 'ArrowRight' ? 1 : -1) + aBtns.length) % aBtns.length;

        activateTab(aBtns[nNext]);
        aBtns[nNext].focus();
    });

    /* ──── Search / Filter ──── */

    window.fex.applySearch = () => {

        if (!oRecord) return;

        if (getViewMode() === 'legacy') {
            renderLegacyView();
            return;
        }

        updateTabLabels();
        renderActivePanel();
    };

    oSearchBox?.addEventListener('input', fexDebounce(() => window.fex.applySearch(), 150));

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

    /* ──── Export Handlers ──── */

    /* Exports follow the field filter, ignore the search box and ignore the render cap */

    oExportJsonBtn?.addEventListener('click', () => {

        if (!oRecord) return;

        const sJson = JSON.stringify(buildExportObject(), null, 2);

        downloadFile(sJson, `${oRecord.sRecordType}_${oRecord.sId || 'new'}.json`, 'application/json');
    });

    oExportCsvBtn?.addEventListener('click', () => {

        if (!oRecord) return;

        const aRows = [['Field ID', 'Label', 'Value', 'Type']];
        const bShowEmpty = !!oShowEmptyToggle?.checked;

        buildBodyRows(oRecord, oFieldMeta, '', getFieldFilter(), bShowEmpty).forEach((pRow) => {

            aRows.push([pRow.sId, pRow.sLabel, stringifyFieldValue(pRow.vValue), pRow.sType]);
        });

        downloadFile(buildCsv(aRows), `${oRecord.sRecordType}_${oRecord.sId || 'new'}_fields.csv`, 'text/csv');
    });

    oExportSublistCsvBtn?.addEventListener('click', () => {

        if (!oRecord) return;

        const sSelected = oSublistSelect?.value;
        const aLines = sSelected ? oRecord.oSublists[sSelected] : null;

        if (!aLines || aLines.length === 0) return;

        const aCols = oRecord.oSublistInfo[sSelected].aCols.filter((pCol) => matchesFieldFilter(pCol));

        if (aCols.length === 0) return;

        const aRows = [['#', ...aCols]];

        aLines.forEach((pLine, pIndex) => {

            aRows.push([pIndex + 1, ...aCols.map((pCol) => formatDisplayValue(pLine[pCol]))]);
        });

        const sFileId = oRecord.sId || 'new';

        downloadFile(buildCsv(aRows), `${oRecord.sRecordType}_${sFileId}_${sSelected}.csv`, 'text/csv');
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
            oFieldLabels: buildFieldLabels(oFilteredBody, oFilteredSublists, oFieldMeta),
            nBodyFieldCount: Object.keys(oFilteredBody).length,
            nSublistCount: Object.keys(oFilteredSublists).length
        };
    }

    /* ──── Pin / Compare ──── */

    /**
     * Shows the outcome of a pin action next to the count badge.
     * @param {string} pMessage - message, '' to clear
     * @param {boolean} pIsError - style as a failure
     */
    function showPinStatus(pMessage, pIsError) {

        if (!oPinStatus) return;

        oPinStatus.textContent = pMessage;
        oPinStatus.classList.toggle('error', pIsError);
    }

    oPinBtn?.addEventListener('click', async () => {

        if (!oRecord || !oSessionStore) return;

        const oSnapshot = {
            sAccount: sCurrentAccount,
            sRecordType: oRecord.sRecordType,
            sId: oRecord.sId,
            oBodyFields: oRecord.oBodyFields,
            oSublists: oRecord.oSublists,
            oFieldLabels: buildFieldLabels(oRecord.oBodyFields, oRecord.oSublists, oFieldMeta),
            nPinnedAt: Date.now()
        };

        try {
            await oSessionStore.set({ [FEX_PINNED_KEY]: oSnapshot });
        } catch (pErr) {

            console.warn('[FEX] pin', pErr);
            showPinStatus('Could not pin this record', true);
            return;
        }

        oPinned = oSnapshot;
        oCompareDiff = null;
        showPinStatus('Pinned', false);
        updateCompareTab();

        if (document.getElementById('panelCompare')?.classList.contains('active')) renderCompare();
    });

    /**
     * Shows or hides the Compare tab. Its count ignores search and filter on purpose, so it does
     * not move while the user narrows the view.
     */
    function updateCompareTab() {

        if (!oTabBtnCompare) return;

        if (!oPinned || !oRecord) {

            const bWasActive = oTabBtnCompare.classList.contains('active');

            oTabBtnCompare.style.display = 'none';

            if (bWasActive) activateTab(oTabBtnBody);

            return;
        }

        oCompareDiff = oCompareDiff || diffRecords(oPinned, {
            oBodyFields: oRecord.oBodyFields,
            oSublists: oRecord.oSublists,
            oFieldLabels: buildFieldLabels(oRecord.oBodyFields, oRecord.oSublists, oFieldMeta)
        });

        oTabBtnCompare.textContent = `Compare (${oCompareDiff.nTotal})`;
        oTabBtnCompare.style.display = '';
        oDirty.compare = true;
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

    /* ──── Fetch & Parse Record via &xml=T ──── */

    /**
     * Shows a message across both new and legacy view containers.
     * @param {string} pText - message to display
     * @param {string} [pClass] - message class ('empty-msg' or 'error-msg')
     */
    function showNonRecordMessage(pText, pClass) {

        sNonRecordMsg = pText;
        sNonRecordClass = pClass || 'empty-msg';

        /* Closing the Nav Manager repaints this through applyViewMode */
        if (window.fex.navOpen) return;

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

    if (!isRecordCandidatePage(oTabUrl.href)) {

        showNonRecordMessage(FEX_MSG_NO_RECORD);
        return;
    }

    sCurrentAccount = getAccountIdFromHostname(oTabUrl.hostname) || oTabUrl.hostname;

    const oXmlUrl = new URL(oTabUrl);
    oXmlUrl.searchParams.set('xml', 'T');

    try {

        const oTarget = { tabId: oTab.id };

        /* The page read shares the wait with the fetch, and its failure only costs labels */
        const [aFetchResults, oPageMeta] = await Promise.all([
            browserAPI.scripting.executeScript({
                target: oTarget,
                func: fexFetchRecordXml,
                args: [oXmlUrl.toString(), FEX_FETCH_TIMEOUT_MS]
            }),
            browserAPI.scripting.executeScript({ target: oTarget, func: fexReadPageMetadata })
                .then((pResults) => pResults?.[0]?.result || {})
                .catch(() => ({}))
        ]);

        const oFetch = aFetchResults?.[0]?.result;
        const oParsed = oFetch?.bXml ? parseRecordResponse(oFetch.sBody) : null;
        const oOutcome = mapFetchOutcome(oFetch, oParsed);

        if (oOutcome.sKind !== 'record') {

            showNonRecordMessage(oOutcome.sMessage, oOutcome.sClass);
            return;
        }

        const oReference = await fetch(browserAPI.runtime.getURL(FEX_REFERENCE_PATH))
            .then((pResp) => (pResp.ok ? pResp.json() : {}))
            .catch(() => ({}));

        oFieldMeta = buildFieldMeta(oParsed.oRecord, oPageMeta, oReference);
        oRecord = oParsed.oRecord;

        if (oSessionStore) {

            oPinned = await oSessionStore.get(FEX_PINNED_KEY)
                .then((pStored) => pStored[FEX_PINNED_KEY] || null)
                .catch(() => null);
        }

        /* Render all views (or defer if Nav Manager is open) */
        window.fex.renderIfReady();

    } catch (pErr) {
        showNonRecordMessage(`Error: ${pErr.message}`, 'error-msg');
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

            /* In create mode there is no id to copy, so (new) renders through the plain branch */
            oRecord.sId ? { label: 'ID:', value: oRecord.sId } : { label: 'ID:', value: '(new)', cls: 'info-value' }
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
        const sFilter = getFieldFilter();
        const sLabel = sFilter === 'all' ? '' : (sFilter === 'custom' ? 'custom ' : 'standard ');
        const nEmptyCount = oRecord.aEmptyFields.filter((pId) => matchesFieldFilter(pId)).length;
        const sEmpty = nEmptyCount > 0 ? ` · ${nEmptyCount} empty` : '';

        /* Sublists stay unfiltered so the badge always agrees with the dropdown */
        oFieldCount.textContent = `${nBodyCount} ${sLabel}fields · ${oRecord.nSublistCount} sublists${sEmpty}`;
    }

    /* ──── Search View ──── */

    /**
     * Returns the rows matching the current term, filter and Empty state, working them out only
     * when one of those changed.
     * @returns {{sTerm: string, sFilter: string, aBodyRows: Array, oSublists: Object}}
     */
    function getSearchView() {

        const sTerm = getSearchTerm();
        const sFilter = getFieldFilter();
        const bShowEmpty = !!oShowEmptyToggle?.checked;
        const sKey = JSON.stringify([sTerm, sFilter, bShowEmpty]);

        if (oSearchView?.sKey === sKey) return oSearchView;

        const oSublists = {};

        Object.entries(oRecord.oSublists).forEach(([pName, pLines]) => {

            if (sTerm && !oSublistIndexes[pName]) oSublistIndexes[pName] = buildSublistIndex(pLines);

            oSublists[pName] = searchSublist(pLines, oRecord.oSublistInfo[pName], oFieldMeta.oSublists[pName] || {},
                oSublistIndexes[pName] || null, sTerm, sFilter, bShowEmpty);
        });

        oSearchView = {
            sKey: sKey,
            sTerm: sTerm,
            sFilter: sFilter,
            aBodyRows: buildBodyRows(oRecord, oFieldMeta, sTerm, sFilter, bShowEmpty),
            oSublists: oSublists
        };

        return oSearchView;
    }

    /**
     * Puts match counts on the Body Fields and Sublists tabs while a term is set.
     */
    function updateTabLabels() {

        if (!oRecord || !oTabBtnBody || !oTabBtnSublists) return;

        const oView = getSearchView();

        if (!oView.sTerm) {

            oTabBtnBody.textContent = 'Body Fields';
            oTabBtnSublists.textContent = 'Sublists';
            return;
        }

        let nLines = 0;

        Object.values(oView.oSublists).forEach((pMatch) => {

            nLines += pMatch.aLineIndexes.length;
        });

        oTabBtnBody.textContent = `Body Fields (${oView.aBodyRows.length})`;
        oTabBtnSublists.textContent = `Sublists (${nLines})`;
    }

    /* ──── Render: Body Fields Table ──── */

    /**
     * Builds the muted label line shown under a field ID.
     * @param {string} pLabel - field label
     * @param {boolean} pMandatory - show the mandatory marker
     * @param {string} pSearch - lowercase search term
     * @returns {HTMLSpanElement}
     */
    function createLabelLine(pLabel, pMandatory, pSearch) {

        const oLine = document.createElement('span');

        oLine.className = 'fe-field-label';
        oLine.appendChild(highlightSearch(pLabel, pSearch));

        if (pMandatory) {

            const oMark = document.createElement('span');

            oMark.className = 'fe-mandatory';
            oMark.title = 'Mandatory';
            oMark.textContent = '*';
            oLine.appendChild(oMark);
        }

        return oLine;
    }

    /**
     * Renders body fields table with search/filter applied
     */
    function renderBodyFields() {

        if (!oBodyFieldsTable || !oRecord) return;

        const oView = getSearchView();
        const sSearch = oView.sTerm;
        const aRows = oView.aBodyRows.slice();

        /* Sort if a column is selected */
        if (nSortColumn !== null) {

            aRows.sort((pA, pB) => {

                let sValA = '';
                let sValB = '';

                if (nSortColumn === 0) {
                    sValA = pA.sId.toLowerCase();
                    sValB = pB.sId.toLowerCase();
                } else if (nSortColumn === 1) {
                    sValA = formatDisplayValue(pA.vValue).toLowerCase();
                    sValB = formatDisplayValue(pB.vValue).toLowerCase();
                } else if (nSortColumn === 2) {
                    sValA = pA.sType.toLowerCase();
                    sValB = pB.sType.toLowerCase();
                }

                if (sValA < sValB) return bSortAsc ? -1 : 1;
                if (sValA > sValB) return bSortAsc ? 1 : -1;
                return 0;
            });
        }

        if (aRows.length === 0) {

            const sFilterWord = oView.sFilter === 'all' ? '' : `${oView.sFilter} `;

            oBodyFieldsTable.textContent = '';
            oBodyFieldsTable.appendChild(createEmptyRow(3, sSearch
                ? 'No fields match your search.'
                : `No ${sFilterWord}fields in this record.`));
            return;
        }

        const oFrag = document.createDocumentFragment();

        aRows.forEach((pRow) => {

            const sKey = pRow.sId;
            const oRow = document.createElement('tr');

            const oIdTd = document.createElement('td');
            oIdTd.className = 'col-id';
            const oIdSpan = createCopySpan(`Copy field ${sKey}`, highlightSearch(sKey, sSearch));
            bindCopyTarget(oIdSpan, sKey);
            oIdTd.appendChild(oIdSpan);

            if (pRow.sLabel || pRow.bMandatory) {
                oIdTd.appendChild(createLabelLine(pRow.sLabel, pRow.bMandatory, sSearch));
            }

            oRow.appendChild(oIdTd);

            const oValTd = document.createElement('td');
            oValTd.className = 'col-value';

            if (pRow.bEmpty) {

                const oEmptySpan = createCopySpan(`Copy field ${sKey}`, '(empty)', 'clickable fe-empty-value');

                bindCopyTarget(oEmptySpan, sKey);
                oValTd.appendChild(oEmptySpan);

            } else {

                const sDisplayVal = formatDisplayValue(pRow.vValue);
                const oValSpan = createCopySpan(`Copy value of ${sKey}`, highlightSearch(sDisplayVal, sSearch));

                bindCopyTarget(oValSpan, stringifyFieldValue(pRow.vValue));
                oValTd.appendChild(oValSpan);
            }

            oRow.appendChild(oValTd);

            const oTypeTd = document.createElement('td');
            oTypeTd.className = 'col-type';
            const oTypeBadge = document.createElement('span');
            oTypeBadge.className = 'type-badge';
            oTypeBadge.title = pRow.sType;
            oTypeBadge.textContent = getTypeIcon(pRow.sType);
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

        const oView = getSearchView();

        aSublistNames.forEach((pName) => {

            const oOpt = document.createElement('option');
            const sLines = `${pName} (${oRecord.oSublists[pName].length} lines)`;

            oOpt.value = pName;
            oOpt.textContent = oView.sTerm
                ? `${sLines} - ${oView.oSublists[pName].aLineIndexes.length} matches`
                : sLines;
            oSublistSelect.appendChild(oOpt);
        });

        if (aSublistNames.includes(sPrevious)) oSublistSelect.value = sPrevious;
    }

    /**
     * Renders the Sublists tab for the current search: refreshes the dropdown counts and moves
     * the selection when it has no matches and another sublist does. A sublist the user picks
     * by hand goes through renderActiveSublist alone, so it stays picked.
     */
    function renderSublistPanel() {

        renderSublistSelector();

        const oView = getSearchView();

        if (oView.sTerm && oSublistSelect && !oView.oSublists[oSublistSelect.value]?.aLineIndexes.length) {

            const sFirstHit = Object.keys(oView.oSublists).find((pName) => {

                return oView.oSublists[pName].aLineIndexes.length > 0;
            });

            if (sFirstHit) oSublistSelect.value = sFirstHit;
        }

        renderActiveSublist();
    }

    /**
     * Renders currently selected sublist as table with columns/rows
     */
    function renderActiveSublist() {

        if (!oSublistTable || !oRecord) return;

        aRenderedCols = [];
        aRenderedLines = [];

        const sSelected = oSublistSelect?.value;

        if (!sSelected || !oRecord.oSublists[sSelected]) {

            oSublistTable.textContent = '';
            oSublistTable.appendChild(createEmptyRow(1, oRecord.nSublistCount === 0
                ? 'This record has no sublists.'
                : 'Select a sublist above.'));
            return;
        }

        const aLines = oRecord.oSublists[sSelected];
        const oView = getSearchView();
        const sSearch = oView.sTerm;
        const oMatch = oView.oSublists[sSelected];
        const oColMeta = oFieldMeta.oSublists[sSelected] || {};
        const aCols = oMatch.aCols;

        if (aCols.length === 0) {

            let sMessage = 'No lines in this sublist.';

            if (aLines.length > 0) {

                const sFilterWord = oView.sFilter === 'all' ? '' : `${oView.sFilter} `;

                sMessage = sSearch ? 'No fields match your search.' : `No ${sFilterWord}fields in this sublist.`;
            }

            oSublistTable.textContent = '';
            oSublistTable.appendChild(createEmptyRow(1, sMessage));
            return;
        }

        /* Line numbers stay absolute so a filtered view still maps back to the record */
        aRenderedCols = aCols;
        aRenderedLines = oMatch.aLineIndexes.slice(0, nSublistRenderCap).map((pIndex) => {

            return { nNumber: pIndex + 1, oLine: aLines[pIndex] };
        });

        const oFrag = document.createDocumentFragment();
        const oHeaderRow = document.createElement('tr');

        oHeaderRow.className = 'sublist-header';

        const oLineNumTh = document.createElement('th');

        oLineNumTh.textContent = '#';
        oHeaderRow.appendChild(oLineNumTh);

        aCols.forEach((pCol) => {

            const oTh = document.createElement('th');
            const oMeta = oColMeta[pCol] || {};
            const oIdSpan = createCopySpan(`Copy field ${pCol}`, highlightSearch(pCol, sSearch));

            if (oMeta.sType) {
                oTh.title = oMeta.sType;
                oIdSpan.title = `${oMeta.sType} - click to copy`;
            }

            oTh.appendChild(oIdSpan);

            if (oMeta.sLabel || oMeta.bMandatory) {
                oTh.appendChild(createLabelLine(oMeta.sLabel, oMeta.bMandatory, sSearch));
            }

            oHeaderRow.appendChild(oTh);
        });

        oFrag.appendChild(oHeaderRow);

        aRenderedLines.forEach((pEntry) => {

            const oRow = document.createElement('tr');
            const oLineNumTd = document.createElement('td');

            oLineNumTd.className = 'line-num';
            oLineNumTd.textContent = pEntry.nNumber;
            oRow.appendChild(oLineNumTd);

            aCols.forEach((pCol) => {

                const oTd = document.createElement('td');
                const sDisplay = formatDisplayValue(pEntry.oLine[pCol]);

                oTd.appendChild(createCopySpan(`Copy value of ${pCol}`, highlightSearch(sDisplay, sSearch)));
                oRow.appendChild(oTd);
            });

            oFrag.appendChild(oRow);
        });

        if (aLines.length === 0) oFrag.appendChild(createEmptyRow(aCols.length + 1, 'No lines in this sublist.'));

        if (oMatch.aLineIndexes.length > nSublistRenderCap) {

            oFrag.appendChild(createEmptyRow(aCols.length + 1,
                `Showing first ${nSublistRenderCap} of ${oMatch.aLineIndexes.length} lines - use search to narrow.`));
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
     * Renders raw JSON view of filtered record data, narrowed by the search term. The Copy button
     * and the exports stay unfiltered.
     */
    function renderRawJson() {

        if (!oRawJsonContainer || !oRecord) return;

        let oPre = oRawJsonContainer.querySelector('.raw-json');

        if (!oPre) {

            oPre = document.createElement('pre');
            oPre.className = 'raw-json';
            oRawJsonContainer.appendChild(oPre);
        }

        const sSearch = getSearchTerm();
        const oExport = buildExportObject();
        const oShown = sSearch ? deepFilterObject(oExport, sSearch.toUpperCase()) : oExport;

        oPre.textContent = JSON.stringify(oShown, null, 2);
    }

    /* ──── Render: Compare ──── */

    /**
     * Formats a compare identity line.
     * @param {string} pTitle - 'Pinned' or 'Current'
     * @param {string} pAccount - account
     * @param {string} pType - record type
     * @param {string} pId - record id, '' in create mode
     * @returns {HTMLDivElement}
     */
    function createCompareIdentity(pTitle, pAccount, pType, pId) {

        const oLine = document.createElement('div');
        const oTitle = document.createElement('span');
        const oValue = document.createElement('span');

        oLine.className = 'cmp-identity';
        oTitle.className = 'info-label';
        oTitle.textContent = `${pTitle}:`;
        oValue.className = 'info-value';
        oValue.textContent = `${pAccount} / ${pType} / ${pId || '(new)'}`;
        oLine.appendChild(oTitle);
        oLine.appendChild(oValue);

        return oLine;
    }

    /**
     * Builds one compare table.
     * @param {Array<Object>} pRows - rows kept by the filter
     * @param {Object} pLabels - field id to label
     * @param {boolean} pWithLines - add the line number column
     * @param {string} pSearch - lowercase search term
     * @returns {HTMLTableElement}
     */
    function createCompareTable(pRows, pLabels, pWithLines, pSearch) {

        const oTable = document.createElement('table');
        const oHead = document.createElement('thead');
        const oHeadRow = document.createElement('tr');
        const oTbody = document.createElement('tbody');

        oTable.className = 'cmp-table';

        [...(pWithLines ? ['Line'] : []), 'Field', 'Pinned', 'Current'].forEach((pTitle) => {

            const oTh = document.createElement('th');

            oTh.textContent = pTitle;

            if (pTitle === 'Line') oTh.className = 'cmp-col-line';

            oHeadRow.appendChild(oTh);
        });

        oHead.appendChild(oHeadRow);
        oTable.appendChild(oHead);

        pRows.slice(0, nSublistRenderCap).forEach((pRow) => {

            const oRow = document.createElement('tr');

            oRow.className = `cmp-${pRow.sKind}`;

            if (pWithLines) {

                const oLineTd = document.createElement('td');

                oLineTd.className = 'line-num';
                oLineTd.textContent = pRow.nLine;
                oRow.appendChild(oLineTd);
            }

            const oFieldTd = document.createElement('td');

            oFieldTd.className = 'cmp-field';
            oFieldTd.appendChild(highlightSearch(pRow.sCol, pSearch));

            if (pLabels[pRow.sCol]) oFieldTd.appendChild(createLabelLine(pLabels[pRow.sCol], false, pSearch));

            oRow.appendChild(oFieldTd);

            [pRow.sPinned, pRow.sCurrent].forEach((pValue) => {

                const oTd = document.createElement('td');

                oTd.appendChild(highlightSearch(pValue, pSearch));
                oRow.appendChild(oTd);
            });

            oTbody.appendChild(oRow);
        });

        if (pRows.length > nSublistRenderCap) {

            oTbody.appendChild(createEmptyRow(pWithLines ? 4 : 3,
                `Showing first ${nSublistRenderCap} of ${pRows.length} rows - use search to narrow.`));
        }

        oTable.appendChild(oTbody);

        return oTable;
    }

    /**
     * Renders the Compare tab: both identities, then the differences that survive the current
     * filter and search.
     */
    function renderCompare() {

        if (!oCompareHeader || !oCompareBody || !oRecord || !oPinned || !oCompareDiff) return;

        const sSearch = getSearchTerm();
        const sFilter = getFieldFilter();
        const oIdentities = document.createElement('div');
        const oUnpinBtn = document.createElement('button');

        oIdentities.className = 'cmp-identities';
        oIdentities.appendChild(createCompareIdentity('Pinned', oPinned.sAccount, oPinned.sRecordType, oPinned.sId));
        oIdentities.appendChild(createCompareIdentity('Current', sCurrentAccount, oRecord.sRecordType, oRecord.sId));

        oUnpinBtn.id = 'unpinBtn';
        oUnpinBtn.type = 'button';
        oUnpinBtn.className = 'fe-mini-btn';
        oUnpinBtn.textContent = 'Unpin';
        oUnpinBtn.addEventListener('click', async () => {

            try {
                await oSessionStore.remove(FEX_PINNED_KEY);
            } catch (pErr) {

                console.warn('[FEX] unpin', pErr);
                showPinStatus('Could not unpin this record', true);
                return;
            }

            oPinned = null;
            oCompareDiff = null;
            showPinStatus('', false);
            updateCompareTab();

            /* The button that had focus just left the document with its panel */
            oTabBtnBody?.focus();
        });

        oCompareHeader.textContent = '';
        oCompareHeader.appendChild(oIdentities);
        oCompareHeader.appendChild(oUnpinBtn);

        if (oPinned.sRecordType !== oRecord.sRecordType) {

            const oNotice = document.createElement('div');

            oNotice.className = 'cmp-notice';
            oNotice.textContent = `Record types differ: ${oPinned.sRecordType} and ${oRecord.sRecordType}.`;
            oCompareHeader.appendChild(oNotice);
        }

        oCompareBody.textContent = '';

        if (oCompareDiff.nTotal === 0) {

            const oMsg = document.createElement('div');

            oMsg.className = 'empty-msg';
            oMsg.textContent = 'No differences.';
            oCompareBody.appendChild(oMsg);
            return;
        }

        const oFrag = document.createDocumentFragment();
        const aBodyRows = filterDiffRows(oCompareDiff.aBody, oCompareDiff.oBodyLabels, sSearch, sFilter);

        if (aBodyRows.length > 0) {

            const oTitle = document.createElement('div');

            oTitle.className = 'cmp-section-title';
            oTitle.textContent = 'Body Fields';
            oFrag.appendChild(oTitle);
            oFrag.appendChild(createCompareTable(aBodyRows, oCompareDiff.oBodyLabels, false, sSearch));
        }

        oCompareDiff.aSublists.forEach((pSublist) => {

            const aRows = filterDiffRows(pSublist.aRows, pSublist.oLabels, sSearch, sFilter);

            if (aRows.length === 0) return;

            const oTitle = document.createElement('div');

            oTitle.className = 'cmp-section-title';
            oTitle.textContent = `Sublist: ${pSublist.sName}`;
            oFrag.appendChild(oTitle);
            oFrag.appendChild(createCompareTable(aRows, pSublist.oLabels, true, sSearch));
        });

        if (!oFrag.hasChildNodes()) {

            const oMsg = document.createElement('div');

            oMsg.className = 'empty-msg';
            oMsg.textContent = 'No differences match the current search or filter.';
            oFrag.appendChild(oMsg);
        }

        oCompareBody.appendChild(oFrag);
    }

    /* ──── Render: Legacy Mode (JSONFormatter) ──── */

    /**
     * Renders legacy tree view using JSONFormatter library
     */
    function renderLegacyView() {

        if (!oLegacyTree || !oRecord) return;

        const sSearch = getSearchTerm();

        const oLegacyData = {
            recordType: oRecord.sRecordType,
            id: oRecord.sId,
            bodyFields: filterFieldsByType(oRecord.oBodyFields),
            lineFields: filterSublistsForLegacy(oRecord.oSublists)
        };

        /* Apply search filter if searching */
        const [oDisplayData, nExpandLevels] = sSearch
            ? [deepFilterObject(oLegacyData, sSearch.toUpperCase()), Infinity]
            : [oLegacyData, 2];

        const oFormatter = new JSONFormatter(oDisplayData, nExpandLevels,
            oRoot.classList.contains('theme-dark') ? { theme: 'dark' } : {});

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

    /* ──── Render: Links ──── */

    /**
     * Updates documentation links with current record type
     */
    function updateLinks() {

        if (!oRecord) return;

        const oLinks = buildDocLinks(oTabUrl.origin, oRecord.sRecordType);

        if (oRecordsBrowserLink) {
            oRecordsBrowserLink.href = oLinks.sBrowser || '#';
            oRecordsBrowserLink.style.display = oLinks.sBrowser ? 'inline' : 'none';
        }

        if (oRecordsCatalogLink) {
            oRecordsCatalogLink.href = oLinks.sCatalog;
            oRecordsCatalogLink.style.display = 'inline';
        }
    }

    /* ──── Display Helpers ──── */

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

        /* The includes check saves building a regex per cell on large sublists */
        if (!pSearch || !pText.toLowerCase().includes(pSearch)) {
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
