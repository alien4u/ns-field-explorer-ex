document.addEventListener('DOMContentLoaded', () => {

    runFieldExplorer();
});

/**
 * Main entry point - initializes the Field Explorer popup
 * Fetches record data via XML API and renders UI
 */
const runFieldExplorer = async () => {

    const browserAPI = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

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
    const oViewModeSelect = document.getElementById('viewModeSelect');
    const oFieldFilterSelect = document.getElementById('fieldFilterSelect');

    /* Links */
    const oRecordsBrowserLink = document.getElementById('recordsBrowserLink');
    const oRecordsCatalogLink = document.getElementById('recordsCatalogLink');

    /* Tab content containers */
    const oBodyFieldsTable = document.getElementById('bodyFieldsTable');
    const oSublistContainer = document.getElementById('sublistContainer');
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

    /* Sort state */
    let nSortColumn = null;
    let bSortAsc = true;

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

    /* ──── Field Filter Helper ──── */

    /**
     * Filters an object of fields based on current field filter setting.
     * @param {Object} pFields - key/value pairs to filter
     * @returns {Object} filtered fields
     */
    function filterFieldsByType(pFields) {

        const sFilter = oFieldFilterSelect?.value || 'all';
        if (sFilter === 'all') return pFields;

        const oFiltered = {};
        Object.entries(pFields).forEach(([sKey, vVal]) => {

            const bIsCustom = isCustomField(sKey);
            if (sFilter === 'custom' && bIsCustom) {
                oFiltered[sKey] = vVal;
            } else if (sFilter === 'standard' && !bIsCustom) {
                oFiltered[sKey] = vVal;
            }
        });
        return oFiltered;
    }

    /**
     * Filters sublist columns (array of column names) based on field filter.
     * @param {Array<string>} pCols - column ID strings
     * @returns {Array<string>} filtered columns
     */
    function filterSublistCols(pCols) {

        const sFilter = oFieldFilterSelect?.value || 'all';
        if (sFilter === 'all') return pCols;

        return pCols.filter(sCol => {

            const bIsCustom = isCustomField(sCol);
            return sFilter === 'custom' ? bIsCustom : !bIsCustom;
        });
    }

    /**
     * Filters sublist line data for legacy mode.
     * Removes columns from each line object based on filter.
     * @param {Object} pSublists - { sublistName: [line, ...] }
     * @returns {Object} filtered sublists
     */
    function filterSublistsForLegacy(pSublists) {

        const sFilter = oFieldFilterSelect?.value || 'all';
        if (sFilter === 'all') return pSublists;

        const oFiltered = {};
        Object.entries(pSublists).forEach(([pName, pLines]) => {

            const aFilteredLines = pLines.map(pLine => {

                const oFilteredLine = {};
                Object.entries(pLine).forEach(([pCol, pVal]) => {

                    const bIsCustom = isCustomField(pCol);
                    if (sFilter === 'custom' && bIsCustom) {
                        oFilteredLine[pCol] = pVal;
                    } else if (sFilter === 'standard' && !bIsCustom) {
                        oFilteredLine[pCol] = pVal;
                    }
                });
                return oFilteredLine;
            }).filter(pLine => Object.keys(pLine).length > 0);
            if (aFilteredLines.length > 0) {
                oFiltered[pName] = aFilteredLines;
            }
        });
        return oFiltered;
    }

    /* ──── Restore Settings ──── */

    const oSettings = await new Promise((resolve) => {

        browserAPI.storage.local.get(['fex_darkMode', 'fex_compactMode', 'fex_viewMode', 'fex_fieldFilter', 'fex_popupWidth', 'fex_popupHeight'], resolve);
    });

    if (oSettings.fex_darkMode) {
        document.body.classList.add('theme-dark');
        if (oDarkToggle) oDarkToggle.classList.add('active');
    }

    if (oSettings.fex_compactMode) {
        document.body.classList.add('fe-compact');
        if (oCompactToggle) oCompactToggle.classList.add('active');
    }

    if (oSettings.fex_viewMode && oViewModeSelect) {
        oViewModeSelect.value = oSettings.fex_viewMode;
    }

    if (oSettings.fex_fieldFilter && oFieldFilterSelect) {
        oFieldFilterSelect.value = oSettings.fex_fieldFilter;
    }

    /* ──── Restore Popup Size ──── */

    const nMinWidth = 350;
    const nMaxWidth = 800;
    const nMinHeight = 300;
    const nMaxHeight = 600;

    if (oSettings.fex_popupWidth) {
        document.body.style.width = Math.min(Math.max(oSettings.fex_popupWidth, nMinWidth), nMaxWidth) + 'px';
    }
    if (oSettings.fex_popupHeight) {
        document.body.style.height = Math.min(Math.max(oSettings.fex_popupHeight, nMinHeight), nMaxHeight) + 'px';
    }

    /* ──── Resize Handle ──── */

    const oResizeHandle = document.getElementById('resizeHandle');
    if (oResizeHandle) {

        let bDragging = false;
        let nStartX, nStartY, nStartW, nStartH;

        oResizeHandle.addEventListener('mousedown', (e) => {

            e.preventDefault();
            bDragging = true;
            nStartX = e.screenX;
            nStartY = e.screenY;
            nStartW = document.body.offsetWidth;
            nStartH = document.body.offsetHeight;
            document.body.classList.add('fe-resizing');
            oResizeHandle.classList.add('dragging');
        });

        document.addEventListener('mousemove', (e) => {

            if (!bDragging) return;
            const nNewW = Math.min(Math.max(nStartW - (e.screenX - nStartX), nMinWidth), nMaxWidth);
            const nNewH = Math.min(Math.max(nStartH + (e.screenY - nStartY), nMinHeight), nMaxHeight);
            document.body.style.width = nNewW + 'px';
            document.body.style.height = nNewH + 'px';
        });

        document.addEventListener('mouseup', () => {

            if (!bDragging) return;
            bDragging = false;
            document.body.classList.remove('fe-resizing');
            oResizeHandle.classList.remove('dragging');
            browserAPI.storage.local.set({
                fex_popupWidth: document.body.offsetWidth,
                fex_popupHeight: document.body.offsetHeight
            });
        });
    }

    /* Apply view mode immediately so the correct view is visible while data loads */
    applyViewMode();

    /* ──── View Mode Switching & Deferred Render ──── */

    /** Renders all record views if data is available */
    window.fexRenderIfReady = () => {

        if (!oRecord) {
            applyViewMode();
            return;
        }

        renderRecordInfo();
        renderBodyFields();

        const oTableHeaders = document.querySelectorAll('#bodyFieldsTableOuter thead th');
        oTableHeaders.forEach((pTh, pIndex) => {

            if (pTh._fexSortBound) return;
            pTh._fexSortBound = true;
            pTh.style.cursor = 'pointer';
            pTh.title = 'Click to sort';
            pTh.addEventListener('click', () => {

                if (nSortColumn === pIndex) {
                    bSortAsc = !bSortAsc;
                } else {
                    nSortColumn = pIndex;
                    bSortAsc = true;
                }

                oTableHeaders.forEach((pH) => {
                    pH.textContent = pH.textContent.replace(/ ▲| ▼/g, '');
                });
                pTh.textContent += bSortAsc ? ' ▲' : ' ▼';

                renderBodyFields();
            });
        });

        renderSublistSelector();
        renderActiveSublist();
        renderRawJson();
        updateLinks();
        applyViewMode();
    };

    /** Applies the current view mode (new vs legacy) and updates container visibility. */
    function applyViewMode() {

        /* Don't touch visibility if Nav Manager is open */
        const oNavPanel = document.getElementById('navManagerPanel');
        if (oNavPanel && oNavPanel.classList.contains('visible')) return;

        const sMode = oViewModeSelect?.value || 'new';

        /* No record loaded — show the non-record message in the target view */
        if (!oRecord && sNonRecordMsg) {
            showNonRecordMessage(sNonRecordMsg);
            return;
        }

        if (sMode === 'legacy') {
            oTabBar.style.display = 'none';
            oContainer.style.display = 'none';
            oLegacyContainer.style.display = 'block';
            renderLegacyView();
        } else {
            oTabBar.style.display = 'flex';
            oContainer.style.display = 'block';
            oLegacyContainer.style.display = 'none';
            if (oRecord) {
                updateFieldCount();
                renderBodyFields();
                renderActiveSublist();
                renderRawJson();
            }
        }
    }

    oViewModeSelect?.addEventListener('change', () => {

        browserAPI.storage.local.set({ fex_viewMode: oViewModeSelect.value });
        applyViewMode();
    });

    /* ──── Field Filter Handler ──── */

    oFieldFilterSelect?.addEventListener('change', () => {

        browserAPI.storage.local.set({ fex_fieldFilter: oFieldFilterSelect.value });
        if (!oRecord) return;
        updateFieldCount();
        const sMode = oViewModeSelect?.value || 'new';
        if (sMode === 'legacy') {
            renderLegacyView();
        } else {
            renderBodyFields();
            renderActiveSublist();
            renderRawJson();
        }
    });

    /* ──── Toggle Handlers ──── */

    oDarkToggle?.addEventListener('click', () => {

        oDarkToggle.classList.toggle('active');
        document.body.classList.toggle('theme-dark');
        browserAPI.storage.local.set({ fex_darkMode: document.body.classList.contains('theme-dark') });
    });

    oCompactToggle?.addEventListener('click', () => {

        oCompactToggle.classList.toggle('active');
        document.body.classList.toggle('fe-compact');
        browserAPI.storage.local.set({ fex_compactMode: document.body.classList.contains('fe-compact') });
    });

    /* ──── Tab Switching ──── */

    aTabBtns.forEach((pBtn) => {

        pBtn.addEventListener('click', () => {

            aTabBtns.forEach((pB) => pB.classList.remove('active'));
            aTabPanels.forEach((pP) => pP.classList.remove('active'));

            pBtn.classList.add('active');
            const sTarget = pBtn.dataset.tab;
            document.getElementById(sTarget).classList.add('active');
        });
    });

    /* ──── Search / Filter ──── */

    oSearchBox?.addEventListener('input', () => {

        if (!oRecord) return;

        const sMode = oViewModeSelect?.value || 'new';
        if (sMode === 'legacy') {
            renderLegacyView();
        } else {
            renderBodyFields();
            renderActiveSublist();
        }
    });

    oSearchBox?.focus();

    /* ──── Sublist Selector ──── */

    oSublistSelect?.addEventListener('change', () => {

        renderActiveSublist();
    });

    /* ──── Export Handlers ──── */

    oExportJsonBtn?.addEventListener('click', () => {

        if (!oRecord) return;
        const sJson = JSON.stringify(buildExportObject(), null, 2);
        downloadFile(sJson, `${oRecord.sRecordType}_${oRecord.sId}.json`, 'application/json');
    });

    oExportCsvBtn?.addEventListener('click', () => {

        if (!oRecord) return;

        const oFilteredBody = filterFieldsByType(oRecord.oBodyFields);
        const aRows = [['Field ID', 'Value', 'Type']];

        Object.entries(oFilteredBody).forEach(([pKey, pValue]) => {

            const sType = detectFieldType(pKey, pValue);
            const sVal = (typeof pValue === 'object') ? JSON.stringify(pValue) : String(pValue ?? '');
            aRows.push([pKey, sVal, sType]);
        });

        const sCsv = aRows.map((pRow) => pRow.map((pCol) => `"${String(pCol).replace(/"/g, '""')}"`).join(',')).join('\n');
        downloadFile(sCsv, `${oRecord.sRecordType}_${oRecord.sId}_fields.csv`, 'text/csv');
    });

    /* ──── Copy Raw JSON ──── */

    oCopyRawJsonBtn?.addEventListener('click', () => {

        if (!oRecord) return;
        const sJson = JSON.stringify(buildExportObject(), null, 2);
        copyButtonToClipboard(sJson, oCopyRawJsonBtn);
    });

    /* ──── Copy Legacy JSON ──── */

    oCopyLegacyJsonBtn?.addEventListener('click', () => {

        if (!oRecord) return;
        const sJson = JSON.stringify(buildExportObject(), null, 2);
        copyButtonToClipboard(sJson, oCopyLegacyJsonBtn);
    });

    /* ──── Export Object Builder ──── */

    function buildExportObject() {

        const oFilteredBody = filterFieldsByType(oRecord.oBodyFields);
        const oFilteredSublists = filterSublistsForLegacy(oRecord.oSublists);

        return {
            sRecordType: oRecord.sRecordType,
            sId: oRecord.sId,
            oBodyFields: oFilteredBody,
            oSublists: oFilteredSublists,
            iBodyFieldCount: Object.keys(oFilteredBody).length,
            iSublistCount: Object.keys(oFilteredSublists).length
        };
    }

    /* ──── Copy Button Helper ──── */

    function copyButtonToClipboard(pText, pBtn) {

        navigator.clipboard.writeText(pText).then(() => {

            const oLabel = pBtn.querySelector('span');
            oLabel.textContent = 'Copied!';
            pBtn.classList.add('copied');

            setTimeout(() => {
                oLabel.textContent = 'Copy';
                pBtn.classList.remove('copied');
            }, 1500);
        }).catch(() => {});
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

    /* ──── Copy to Clipboard ──── */

    /**
     * Copies text to clipboard and shows visual confirmation
     * @param {string} pText - text to copy
     * @param {HTMLElement} pElement - element to show confirmation on (optional)
     */
    /** Active copy timer, prevents overlapping restores */
    let nCopyTimer = 0;

    function copyToClipboard(pText, pElement) {

        navigator.clipboard.writeText(pText).then(() => {

            if (pElement) {
                const sOriginalText = pElement.textContent;
                pElement.textContent = '\u2713 Copied';
                pElement.classList.add('copied');

                clearTimeout(nCopyTimer);
                nCopyTimer = setTimeout(() => {
                    pElement.textContent = sOriginalText;
                    pElement.classList.remove('copied');
                }, 1000);
            }
        }).catch(() => {});
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
     */
    function showNonRecordMessage(pText) {

        sNonRecordMsg = pText;
        const sMode = oViewModeSelect?.value || 'new';

        oTabBar.style.display = 'none';

        if (oExportJsonBtn) { oExportJsonBtn.disabled = true; oExportJsonBtn.style.opacity = '0.4'; }
        if (oExportCsvBtn) { oExportCsvBtn.disabled = true; oExportCsvBtn.style.opacity = '0.4'; }

        if (sMode === 'legacy') {
            oContainer.style.display = 'none';
            oLegacyTree.textContent = '';
            const oMsg = document.createElement('div');
            oMsg.className = 'empty-msg';
            oMsg.textContent = pText;
            oLegacyTree.appendChild(oMsg);
            oLegacyContainer.style.display = 'block';
        } else {
            oLegacyContainer.style.display = 'none';
            oContainer.textContent = '';
            const oMsg = document.createElement('div');
            oMsg.className = 'empty-msg';
            oMsg.textContent = pText;
            oContainer.appendChild(oMsg);
            oContainer.style.display = 'block';
        }
    }

    const [oTab] = await browserAPI.tabs.query({ active: true, currentWindow: true });

    if (!oTab || !oTab.url || !oTab.url.includes('netsuite.com')) {

        showNonRecordMessage('Not on a NetSuite page.');
        return;
    }

    /* Check if this looks like a record page (has standalone id= parameter) */
    const oTabUrl = new URL(oTab.url);
    const bHasRecordId = oTabUrl.searchParams.has('id');

    if (!bHasRecordId) {

        showNonRecordMessage('No record detected on this page. Use the 🗂️ Nav button to manage navigation menus.');
        return;
    }

    const oXmlUrl = new URL(oTab.url);
    oXmlUrl.searchParams.set('xml', 'T');
    const sXmlUrl = oXmlUrl.toString();

    try {

        const [oResult] = await browserAPI.scripting.executeScript({
            target: { tabId: oTab.id },
            func: async (pUrl) => {

                try {
                    const oResp = await fetch(pUrl, { credentials: 'include' });
                    if (!oResp.ok) return { error: `HTTP ${oResp.status}` };
                    return { data: await oResp.text() };
                } catch (e) {
                    return { error: e.message };
                }
            },
            args: [sXmlUrl]
        });

        if (oResult.result?.error) {

            showNonRecordMessage(`Failed to fetch record: ${oResult.result.error}`);
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
        window.fexRenderIfReady();

    } catch (e) {
        showNonRecordMessage(`Error: ${e.message}`);
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
            iBodyFieldCount: Object.keys(oBodyFields).length,
            iSublistCount: Object.keys(oSublists).length
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

            const oVal = document.createElement('span');
            oVal.className = pPart.cls || 'info-value clickable';
            oVal.textContent = pPart.value;

            if (!pPart.cls) {
                oVal.title = 'Click to copy';
                oVal.addEventListener('click', () => copyToClipboard(oVal.textContent, oVal));
            }

            oRecordInfo.appendChild(oVal);
        });

        updateFieldCount();
    }

    /** Updates the field/sublist count badge based on current filter */
    function updateFieldCount() {

        if (!oFieldCount || !oRecord) return;

        const oFilteredBody = filterFieldsByType(oRecord.oBodyFields);
        const oFilteredSublists = filterSublistsForLegacy(oRecord.oSublists);
        const iBodyCount = Object.keys(oFilteredBody).length;
        const iSublistCount = Object.keys(oFilteredSublists).length;
        const sFilter = oFieldFilterSelect?.value || 'all';

        if (sFilter === 'all') {
            oFieldCount.textContent = `${iBodyCount} fields · ${iSublistCount} sublists`;
        } else {
            const sLabel = sFilter === 'custom' ? 'custom' : 'standard';
            oFieldCount.textContent = `${iBodyCount} ${sLabel} fields · ${iSublistCount} sublists`;
        }
    }

    /* ──── Render: Body Fields Table ──── */

    /**
     * Renders body fields table with search/filter applied
     */
    function renderBodyFields() {

        if (!oBodyFieldsTable || !oRecord) return;

        const sSearch = (oSearchBox?.value || '').toLowerCase();
        const oFilteredByType = filterFieldsByType(oRecord.oBodyFields);
        const aEntries = Object.entries(oFilteredByType);

        const aFiltered = sSearch
            ? aEntries.filter(([pKey, pVal]) => {

                const sVal = (typeof pVal === 'object') ? JSON.stringify(pVal) : String(pVal ?? '');
                return pKey.toLowerCase().includes(sSearch) || sVal.toLowerCase().includes(sSearch);
            })
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
                    sValA = String(pA[1] != null ? pA[1] : '').toLowerCase();
                    sValB = String(pB[1] != null ? pB[1] : '').toLowerCase();
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

            oBodyFieldsTable.textContent = '';
            oBodyFieldsTable.appendChild(createEmptyRow(3, 'No fields match your search.'));
            return;
        }

        const oFrag = document.createDocumentFragment();

        aFiltered.forEach(([pKey, pValue]) => {

            const sType = detectFieldType(pKey, pValue);
            const sIcon = getTypeIcon(sType);
            const sDisplayVal = formatDisplayValue(pValue);

            const oRow = document.createElement('tr');

            /* Field ID cell */
            const oIdTd = document.createElement('td');
            oIdTd.className = 'col-id';
            const oIdSpan = document.createElement('span');
            oIdSpan.className = 'clickable';
            oIdSpan.title = 'Click to copy field ID';
            oIdSpan.appendChild(highlightSearch(pKey, sSearch));
            oIdSpan.addEventListener('click', () => copyToClipboard(pKey, oIdSpan));
            oIdTd.appendChild(oIdSpan);
            oRow.appendChild(oIdTd);

            /* Value cell */
            const oValTd = document.createElement('td');
            oValTd.className = 'col-value';
            const oValSpan = document.createElement('span');
            oValSpan.className = 'clickable';
            oValSpan.title = 'Click to copy value';
            oValSpan.appendChild(highlightSearch(sDisplayVal, sSearch));
            oValSpan.addEventListener('click', () => {
                const sCopyVal = (typeof pValue === 'object') ? JSON.stringify(pValue) : String(pValue ?? '');
                copyToClipboard(sCopyVal, oValSpan);
            });
            oValTd.appendChild(oValSpan);
            oRow.appendChild(oValTd);

            /* Type cell */
            const oTypeTd = document.createElement('td');
            oTypeTd.className = 'col-type';
            const oTypeBadge = document.createElement('span');
            oTypeBadge.className = 'type-badge';
            oTypeBadge.title = sType;
            oTypeBadge.textContent = sIcon;
            oTypeTd.appendChild(oTypeBadge);
            oRow.appendChild(oTypeTd);

            oFrag.appendChild(oRow);
        });

        oBodyFieldsTable.textContent = '';
        oBodyFieldsTable.appendChild(oFrag);
    }

    /* ──── Render: Sublist Selector & Table ──── */

    /**
     * Populates sublist dropdown selector
     */
    function renderSublistSelector() {

        if (!oSublistSelect || !oRecord) return;

        oSublistSelect.textContent = '';

        const aSublistNames = Object.keys(oRecord.oSublists);

        if (aSublistNames.length === 0) {

            const oOpt = document.createElement('option');
            oOpt.textContent = 'No sublists found';
            oSublistSelect.appendChild(oOpt);
            return;
        }

        aSublistNames.forEach(pName => {

            const oOpt = document.createElement('option');
            oOpt.value = pName;
            const iLineCount = oRecord.oSublists[pName].length;
            oOpt.textContent = `${pName} (${iLineCount} lines)`;
            oSublistSelect.appendChild(oOpt);
        });
    }

    /**
     * Renders currently selected sublist as table with columns/rows
     */
    function renderActiveSublist() {

        if (!oSublistTable || !oRecord) return;

        const sSelected = oSublistSelect?.value;

        if (!sSelected || !oRecord.oSublists[sSelected]) {
            oSublistTable.textContent = '';
            oSublistTable.appendChild(createEmptyRow(1, 'Select a sublist above.'));
            return;
        }

        const aLines = oRecord.oSublists[sSelected];

        if (aLines.length === 0) {
            oSublistTable.textContent = '';
            oSublistTable.appendChild(createEmptyRow(1, 'No lines in this sublist.'));
            return;
        }

        const oColSet = new Set();
        aLines.forEach(pLine => Object.keys(pLine).forEach(pKey => oColSet.add(pKey)));
        let aCols = Array.from(oColSet);

        aCols = filterSublistCols(aCols);

        const sSearch = (oSearchBox?.value || '').toLowerCase();

        const aFilteredCols = sSearch
            ? aCols.filter(pCol => {

                if (pCol.toLowerCase().includes(sSearch)) return true;
                return aLines.some(pLine => {

                    const sVal = String(pLine[pCol] ?? '');
                    return sVal.toLowerCase().includes(sSearch);
                });
            })
            : aCols;

        if (aFilteredCols.length === 0) {
            oSublistTable.textContent = '';
            oSublistTable.appendChild(createEmptyRow(1, 'No fields match your search.'));
            return;
        }

        const oFrag = document.createDocumentFragment();

        const oHeaderRow = document.createElement('tr');
        oHeaderRow.className = 'sublist-header';

        const oLineNumTh = document.createElement('th');
        oLineNumTh.textContent = '#';
        oHeaderRow.appendChild(oLineNumTh);

        aFilteredCols.forEach(pCol => {

            const oTh = document.createElement('th');
            oTh.className = 'clickable';
            oTh.title = 'Click to copy field ID';
            oTh.textContent = pCol;
            oTh.addEventListener('click', () => copyToClipboard(pCol, oTh));
            oHeaderRow.appendChild(oTh);
        });

        oFrag.appendChild(oHeaderRow);

        aLines.forEach((pLine, pIndex) => {

            const oRow = document.createElement('tr');

            const oLineNumTd = document.createElement('td');
            oLineNumTd.className = 'line-num';
            oLineNumTd.textContent = pIndex + 1;
            oRow.appendChild(oLineNumTd);

            aFilteredCols.forEach(pCol => {

                const oTd = document.createElement('td');
                const vVal = pLine[pCol];
                const sDisplay = formatDisplayValue(vVal);

                oTd.className = 'clickable';
                oTd.title = 'Click to copy';
                oTd.appendChild(highlightSearch(sDisplay, sSearch));

                oTd.addEventListener('click', () => {

                    const sCopy = (typeof vVal === 'object') ? JSON.stringify(vVal) : String(vVal ?? '');
                    copyToClipboard(sCopy, oTd);
                });

                oRow.appendChild(oTd);
            });

            oFrag.appendChild(oRow);
        });

        oSublistTable.textContent = '';
        oSublistTable.appendChild(oFrag);
    }

    /* ──── Render: Raw JSON ──── */

    /**
     * Renders raw JSON view of filtered record data
     */
    function renderRawJson() {

        if (!oRawJsonContainer || !oRecord) return;

        const oFilteredBody = filterFieldsByType(oRecord.oBodyFields);
        const oFilteredSublists = filterSublistsForLegacy(oRecord.oSublists);

        const oExport = {
            sRecordType: oRecord.sRecordType,
            sId: oRecord.sId,
            oBodyFields: oFilteredBody,
            oSublists: oFilteredSublists,
            iBodyFieldCount: Object.keys(oFilteredBody).length,
            iSublistCount: Object.keys(oFilteredSublists).length
        };

        const sJson = JSON.stringify(oExport, null, 2);
        let oPre = oRawJsonContainer.querySelector('.raw-json');

        if (!oPre) {
            oPre = document.createElement('pre');
            oPre.className = 'raw-json';
            oRawJsonContainer.appendChild(oPre);
        }

        oPre.textContent = sJson;
    }

    /* ──── Render: Legacy Mode (JSONFormatter) ──── */

    /**
     * Renders legacy tree view using JSONFormatter library
     */
    function renderLegacyView() {

        if (!oLegacyTree || !oRecord) return;

        const sSearch = (oSearchBox?.value || '').toLowerCase();

        const oFilteredBody = filterFieldsByType(oRecord.oBodyFields);
        const oFilteredSublists = filterSublistsForLegacy(oRecord.oSublists);

        const oLegacyData = {
            recordType: oRecord.sRecordType,
            id: oRecord.sId,
            bodyFields: oFilteredBody,
            lineFields: oFilteredSublists
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
            const oRegex = new RegExp('(' + escapeRegex(sSearch) + ')', 'gi');
            const oWalker = document.createTreeWalker(
                oLegacyTree, NodeFilter.SHOW_TEXT
            );
            const aNodesToSplit = [];

            while (oWalker.nextNode()) {

                if (oRegex.test(oWalker.currentNode.textContent)) {
                    aNodesToSplit.push(oWalker.currentNode);
                }
                oRegex.lastIndex = 0;
            }

            aNodesToSplit.forEach((pNode) => {

                const oWrapper = document.createElement('span');
                const sText = pNode.textContent;
                let nLast = 0;
                let aFound;

                while ((aFound = oRegex.exec(sText)) !== null) {

                    if (aFound.index > nLast) {
                        oWrapper.appendChild(document.createTextNode(sText.slice(nLast, aFound.index)));
                    }
                    const oHl = document.createElement('span');
                    oHl.className = 'searchresult';
                    oHl.textContent = aFound[1];
                    oWrapper.appendChild(oHl);
                    nLast = oRegex.lastIndex;
                }

                if (nLast < sText.length) {
                    oWrapper.appendChild(document.createTextNode(sText.slice(nLast)));
                }

                pNode.parentNode.replaceChild(oWrapper, pNode);
            });
        }
    }

    /**
     * Deep filter for legacy record object — matches old extension behavior
     * Recursively filters object properties by search term
     * @param {Object} pObject - record object to filter
     * @param {string} pSearchTerm - search term
     * @returns {Object} filtered object
     */
    function filterLegacyRecord(pObject, pSearchTerm) {

        const sUpper = pSearchTerm.toUpperCase();
        return deepFilterObject(pObject, sUpper);
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
     * Creates a DocumentFragment with search term matches wrapped in <mark> elements.
     * @param {string} pText - text to highlight
     * @param {string} pSearch - lowercase search term
     * @returns {DocumentFragment} fragment with text nodes and <mark> elements
     */
    function highlightSearch(pText, pSearch) {

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

            const oMark = document.createElement('mark');
            oMark.textContent = aMatch[1];
            oFrag.appendChild(oMark);
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
