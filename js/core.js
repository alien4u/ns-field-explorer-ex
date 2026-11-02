/**
 * Core Logic - Field Explorer EX
 *
 * Popup only, loaded after shared.js and before popup.js. Plain script globals, no DOM wiring:
 * popup.js and navmanager.js own the UI, this file owns the decisions, so the decisions can be
 * tested on their own. Two functions here are injected into the NetSuite tab, see below.
 *
 * @module core
 */

const FEX_FETCH_TIMEOUT_MS = 60000;
const FEX_RECORDS_BROWSER_VERSION = 'Browser2026_1';
const FEX_REFERENCE_PATH = 'data/records-reference.json';
const FEX_PINNED_KEY = 'fex_pinned';
const FEX_SENSITIVE_FIELDS = new Set(['_csrf', '_eml_nkey_']);
const FEX_LOGIN_PATH = '/app/login/';

/* Paths that are never records, or (/app/site/) must not be requested a second time */
const FEX_NON_RECORD_PATHS = ['/app/site/', '/app/center/', FEX_LOGIN_PATH, '/app/reporting/', '/app/common/search/'];

const FEX_MSG_NO_RECORD = 'No record detected on this page. ' +
    'Use the Nav Manager button (folder icon) in the toolbar to manage navigation menus.';
const FEX_MSG_SESSION = 'Could not reach NetSuite. Your session may have expired - log in and reopen.';
const FEX_MSG_TIMEOUT = 'NetSuite took too long to respond. Try again.';
const FEX_MSG_UNPARSEABLE = 'Could not parse record data. Are you on a record page?';

/* Separates values inside a search haystack, so a term cannot match across two of them */
const FEX_HAY_SEP = '\u0001';

/* ──── Field Classification ──── */

/**
 * Determines if a field ID belongs to a custom field namespace.
 *
 * @param {string} pFieldId - field ID to check
 * @returns {boolean} true for custom fields; customform and customer are native
 */
const isCustomField = (pFieldId) => {

    const sId = (pFieldId || '').toLowerCase();

    return /^(custbody|custcol|custentity|custevent|custitemnumber|custitem|custrecord|custpage|cseg)/.test(sId);
};

/**
 * Determines if a field ID is platform plumbing rather than a field of the record.
 *
 * @param {string} pFieldId - field ID to check
 * @returns {boolean} true for internals
 */
const isInternalFieldId = (pFieldId) => {

    const sId = pFieldId || '';

    return /^(_|nsapi|nlapi|wf[A-Z])/.test(sId) || sId === 'nsbrowserenv' || sId === 'selectedtab';
};

/**
 * Tests a field ID against a Custom/Standard filter value.
 *
 * @param {string} pFieldId - field ID to check
 * @param {string} pFilter - 'all', 'custom' or 'standard'
 * @returns {boolean} true when the field survives the filter
 */
const passesFieldFilter = (pFieldId, pFilter) => {

    if (!pFilter || pFilter === 'all') return true;

    return pFilter === 'custom' ? isCustomField(pFieldId) : !isCustomField(pFieldId);
};

/* ──── Values ──── */

/**
 * Renders a field value as the string used for copy, search, CSV and compare.
 *
 * @param {*} pValue - field value
 * @returns {string} flat string representation
 */
const stringifyFieldValue = (pValue) => {

    if (pValue === null || pValue === undefined) return '';

    return (typeof pValue === 'object') ? JSON.stringify(pValue) : String(pValue);
};

/**
 * Formats a field value for display (handles objects with _text/_value).
 *
 * @param {*} pValue - field value
 * @returns {string} formatted display string
 */
const formatDisplayValue = (pValue) => {

    if (pValue === null || pValue === undefined) return '';

    if (typeof pValue === 'object') {

        if (pValue._text) return `${pValue._text} [${pValue._value || ''}]`;
        if (pValue.__text) return `${pValue.__text} [${pValue._value || ''}]`;

        return JSON.stringify(pValue);
    }

    return String(pValue);
};

/* ──── Type Detection ──── */

/**
 * Infers a field type from its ID and value. Last resort, after the page and the reference.
 *
 * @param {string} pFieldId - field ID
 * @param {*} pValue - field value
 * @returns {string} field type
 */
const detectFieldType = (pFieldId, pValue) => {

    const sId = (pFieldId || '').toLowerCase();
    const sVal = String(pValue ?? '');
    const bIdName = sId === 'id' || sId.endsWith('_id');

    if (sVal === 'T' || sVal === 'F') return 'checkbox';
    if (/\d{4}-\d{2}-\d{2}T/.test(sVal)) return 'datetime';

    /* M/D/YYYY and YYYY-MM-DD with / . or - separators, then D-Mon-YYYY with those or a space */
    if (/^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}(?!\d)/.test(sVal)) return 'date';
    if (/^\d{4}[/.-]\d{1,2}[/.-]\d{1,2}(?!\d)/.test(sVal)) return 'date';
    if (/^\d{1,2}[/.\- ](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[/.\- ]\d{4}(?!\d)/i.test(sVal)) {
        return 'date';
    }

    if (typeof pValue === 'object' && pValue !== null) {

        if (pValue._text || pValue.__text) return 'select';

        return 'object';
    }

    if (/^-?\d+\.\d{2}$/.test(sVal) && !bIdName) return 'currency';
    if (/^-?\d+(\.\d+)?$/.test(sVal) && sVal.length < 15) return 'number';
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sVal)) return 'email';
    if (/^https?:\/\//.test(sVal)) return 'url';
    if (bIdName) return 'id';

    return 'text';
};

/**
 * Resolves a field's type: the page says what it is, the reference says what it usually is,
 * the heuristic guesses.
 *
 * @param {string} pFieldId - field ID
 * @param {*} pValue - field value
 * @param {string} [pKnownType] - page type, else reference type
 * @returns {string} resolved type
 */
const resolveFieldType = (pFieldId, pValue, pKnownType) => pKnownType || detectFieldType(pFieldId, pValue);

/**
 * Returns the badge glyph for a field type.
 *
 * @param {string} pType - resolved field type
 * @returns {string} icon character, 'Aa' for anything unknown
 */
const getTypeIcon = (pType) => {

    const oMap = {
        checkbox: '☑',
        date: '📅',
        datetime: '📅',
        datetimetz: '📅',
        select: '▼',
        multiselect: '▼▼',
        currency: '💲',
        currency2: '💲',
        poscurrency: '💲',
        number: '#',
        integer: '#',
        posinteger: '#',
        float: '#',
        posfloat: '#',
        rate: '%',
        ratehighprecision: '%',
        percent: '%',
        email: '✉',
        emails: '✉',
        phone: 'Tel',
        url: '🔗',
        address: '⌂',
        id: '🔑',
        object: '{}',
        textarea: '¶',
        inlinehtml: '</>',
        richtext: '</>',
        rtext: '</>',
        text: 'Aa'
    };

    return oMap[pType] || 'Aa';
};

/* ──── Page Gate ──── */

/**
 * Decides whether a page is worth requesting with xml=T. Suitelets must not be, since the second
 * request would run the Suitelet again.
 *
 * @param {string} pUrl - tab URL
 * @returns {boolean} true for a NetSuite .nl page that can be a record
 */
const isRecordCandidatePage = (pUrl) => {

    let oUrl = null;

    try {
        oUrl = new URL(pUrl);
    } catch (_e) {
        return false;
    }

    if (!isNetSuiteHostname(oUrl.hostname)) return false;

    const sPath = oUrl.pathname.toLowerCase();

    if (!sPath.endsWith('.nl') || sPath.endsWith('list.nl')) return false;

    return !FEX_NON_RECORD_PATHS.some((pPrefix) => sPath.startsWith(pPrefix));
};

/* ──── Injected Into The NetSuite Tab ──── */

/* executeScript serializes these two, so they cannot reference anything outside their own body */

/**
 * Requests the record XML inside the tab's session. The abort also covers the body read.
 *
 * @param {string} pUrl - record URL with xml=T
 * @param {number} pTimeoutMs - abort deadline
 * @returns {Promise<Object>} { sKind: 'timeout' | 'network' }, or the response facts with sKind 'response'
 */
const fexFetchRecordXml = async (pUrl, pTimeoutMs) => {

    const oAbort = new AbortController();
    const nTimer = setTimeout(() => oAbort.abort(), pTimeoutMs);

    try {

        const oResp = await fetch(pUrl, { credentials: 'include', signal: oAbort.signal });
        const bXml = /xml/i.test(oResp.headers.get('content-type') || '');

        return {
            sKind: 'response',
            bOk: oResp.ok,
            nStatus: oResp.status,
            bXml: bXml,
            sFinalPath: new URL(oResp.url || pUrl).pathname,
            sBody: bXml ? await oResp.text() : ''
        };

    } catch (pErr) {
        return { sKind: pErr.name === 'AbortError' ? 'timeout' : 'network' };
    } finally {
        clearTimeout(nTimer);
    }
};

/**
 * Reads what the rendered form says about its fields. Raw strings only: the popup normalizes
 * them, and it matches edit-mode sublist labels once the XML has named the columns.
 *
 * @returns {Object} { oFieldTypes, oLabels, oCells, oHeaderTypes }
 */
const fexReadPageMetadata = () => {

    const oFieldTypes = {};
    const oLabels = {};
    const oCells = {};
    const oHeaderTypes = {};

    document.querySelectorAll('.uir-field-wrapper[data-field-name]').forEach((pWrapper) => {

        oFieldTypes[pWrapper.getAttribute('data-field-name')] = pWrapper.getAttribute('data-field-type') || '';
    });

    document.querySelectorAll('[id$="_fs_lbl"]').forEach((pLabel) => {

        oLabels[pLabel.id.slice(0, -'_fs_lbl'.length)] = pLabel.textContent;
    });

    document.querySelectorAll('[id$="_splits"]').forEach((pTable) => {

        const oColumns = {};

        pTable.querySelectorAll('tr.uir-machine-row td[data-field-name]').forEach((pCell) => {

            const sCol = pCell.getAttribute('data-field-name');

            if (!oColumns[sCol]) oColumns[sCol] = pCell.getAttribute('data-ns-tooltip') || '';
        });

        oCells[pTable.id.slice(0, -'_splits'.length)] = oColumns;
    });

    document.querySelectorAll('[id$="_headerrow"]').forEach((pRow) => {

        const oColumns = {};

        pRow.querySelectorAll('td[data-label][data-column-type]').forEach((pCell) => {

            oColumns[pCell.getAttribute('data-label')] = pCell.getAttribute('data-column-type');
        });

        oHeaderTypes[pRow.id.slice(0, -'_headerrow'.length)] = oColumns;
    });

    return { oFieldTypes: oFieldTypes, oLabels: oLabels, oCells: oCells, oHeaderTypes: oHeaderTypes };
};

/* ──── XML Parsing ──── */

/**
 * Parses an XML field node into a JS value.
 *
 * @param {Element} pNode - XML DOM node
 * @returns {*} parsed value (string, object, or nested structure)
 */
const parseFieldNode = (pNode) => {

    if (pNode.children.length > 0) {

        const oObj = {};

        Array.from(pNode.children).forEach((pChild) => {

            const sName = pChild.nodeName;
            const vParsed = parseFieldNode(pChild);

            if (sName in oObj) {

                /* Duplicate child name - convert to array */
                if (!Array.isArray(oObj[sName])) {
                    oObj[sName] = [oObj[sName]];
                }

                oObj[sName].push(vParsed);

            } else {
                oObj[sName] = vParsed;
            }
        });

        Array.from(pNode.attributes).forEach((pAttr) => {

            oObj['_' + pAttr.name] = pAttr.value;
        });

        return oObj;
    }

    if (pNode.attributes.length > 0) {

        const oObj = { _value: pNode.textContent.trim() };

        Array.from(pNode.attributes).forEach((pAttr) => {

            oObj['_' + pAttr.name] = pAttr.value;
        });

        return oObj;
    }

    return pNode.textContent.trim();
};

/**
 * Splits a comma-separated fields attribute.
 *
 * @param {string|null} pList - attribute value
 * @returns {Array<string>} unique field names
 */
const splitFieldList = (pList) => {

    return Array.from(new Set((pList || '').split(',').map((pName) => pName.trim()).filter(Boolean)));
};

/**
 * Reads an xml=T body. Sensitive names stop here, so nothing downstream can show, copy, search or
 * export them.
 *
 * @param {string} pXmlString - response text
 * @returns {{oRecord: Object|null, oError: Object|null}} oError is { sDetail, sCode }
 */
const parseRecordResponse = (pXmlString) => {

    const oDoc = new DOMParser().parseFromString(pXmlString, 'text/xml');
    const oRecordNode = oDoc.querySelector('record');

    if (!oRecordNode) {

        const oErrorNode = oDoc.querySelector('onlineError');

        if (!oErrorNode) return { oRecord: null, oError: null };

        return {
            oRecord: null,
            oError: {
                sDetail: oErrorNode.querySelector('detail')?.textContent.trim()
                    || oErrorNode.querySelector('description')?.textContent.trim()
                    || 'NetSuite returned an error',
                sCode: oErrorNode.querySelector('code')?.textContent.trim() || ''
            }
        };
    }

    const oBodyFields = {};
    const oSublists = {};
    const oSublistInfo = {};

    Array.from(oRecordNode.children).forEach((pChild) => {

        const sName = pChild.nodeName;

        if (sName !== 'machine') {

            if (!FEX_SENSITIVE_FIELDS.has(sName)) oBodyFields[sName] = parseFieldNode(pChild);

            return;
        }

        const sSublistName = pChild.getAttribute('name') || sName;
        const oSeenCols = new Set();
        const aLines = [];

        Array.from(pChild.children).forEach((pLine) => {

            if (pLine.nodeName !== 'line') return;

            const oLineData = {};

            Array.from(pLine.children).forEach((pField) => {

                if (FEX_SENSITIVE_FIELDS.has(pField.nodeName)) return;

                oLineData[pField.nodeName] = parseFieldNode(pField);
                oSeenCols.add(pField.nodeName);
            });

            Array.from(pLine.attributes).forEach((pAttr) => {

                if (!oLineData[pAttr.name]) {
                    oLineData[pAttr.name] = pAttr.value;
                    oSeenCols.add(pAttr.name);
                }
            });

            aLines.push(oLineData);
        });

        oSublists[sSublistName] = aLines;
        oSublistInfo[sSublistName] = {
            sType: pChild.getAttribute('type') || '',
            aCols: Array.from(oSeenCols),
            aEmptyCols: splitFieldList(pChild.getAttribute('fields'))
                .filter((pCol) => !oSeenCols.has(pCol) && !isInternalFieldId(pCol))
        };
    });

    Array.from(oRecordNode.attributes).forEach((pAttr) => {

        /* fields becomes aEmptyFields below; it is a field list, not a field */
        if (!['recordType', 'id', 'fields'].includes(pAttr.name)) {
            oBodyFields['_' + pAttr.name] = pAttr.value;
        }
    });

    const oRecord = {
        sRecordType: oRecordNode.getAttribute('recordType') || '',
        sId: oRecordNode.getAttribute('id') || '',
        oBodyFields: oBodyFields,
        oSublists: oSublists,
        oSublistInfo: oSublistInfo,
        aEmptyFields: splitFieldList(oRecordNode.getAttribute('fields')).filter((pName) => {

            return !Object.hasOwn(oBodyFields, pName)
                && !Object.hasOwn(oSublists, pName)
                && !isInternalFieldId(pName);
        }),
        nBodyFieldCount: Object.keys(oBodyFields).length,
        nSublistCount: Object.keys(oSublists).length
    };

    return { oRecord: oRecord, oError: null };
};

/* ──── Fetch Outcome ──── */

/**
 * Maps what the injected fetch returned to the one thing the popup does about it.
 *
 * @param {Object|undefined} pFetch - fexFetchRecordXml result
 * @param {Object|null} pParsed - parseRecordResponse result, null when the body was not XML
 * @returns {{sKind: string, sMessage: string, sClass: string}} sKind 'record' carries no message
 */
const mapFetchOutcome = (pFetch, pParsed) => {

    const fnError = (pKind, pMessage) => ({ sKind: pKind, sMessage: pMessage, sClass: 'error-msg' });

    if (!pFetch) return fnError('unparseable', FEX_MSG_UNPARSEABLE);
    if (pFetch.sKind === 'timeout') return fnError('timeout', FEX_MSG_TIMEOUT);
    if (pFetch.sKind === 'network') return fnError('session', FEX_MSG_SESSION);

    if (!pFetch.bXml && (pFetch.sFinalPath || '').toLowerCase().startsWith(FEX_LOGIN_PATH)) {
        return fnError('session', FEX_MSG_SESSION);
    }

    if (pParsed?.oRecord) return { sKind: 'record', sMessage: '', sClass: '' };

    if (pParsed?.oError) {

        const sCode = pParsed.oError.sCode;

        return fnError('netsuite-error', sCode ? `${pParsed.oError.sDetail} (${sCode})` : pParsed.oError.sDetail);
    }

    if (!pFetch.bOk) return fnError('http-error', `Failed to fetch record: HTTP ${pFetch.nStatus}`);

    if (!pFetch.bXml) return { sKind: 'not-record', sMessage: FEX_MSG_NO_RECORD, sClass: 'empty-msg' };

    return fnError('unparseable', FEX_MSG_UNPARSEABLE);
};

/* ──── Labels And Types ──── */

/**
 * Cleans a label read from the page. A trailing asterisk is the form's mandatory marker.
 *
 * @param {string} [pText] - raw label text, such as "Date\n*"
 * @returns {{sLabel: string, bMandatory: boolean}}
 */
const normalizePageLabel = (pText) => {

    const sText = String(pText ?? '').replace(/\s+/g, ' ').trim();
    const bMandatory = sText.endsWith('*');

    return { sLabel: bMandatory ? sText.slice(0, -1).trim() : sText, bMandatory: bMandatory };
};

/**
 * Merges the sources for every field and column of a record. Page wins over reference, and
 * mandatory shows when either says so.
 *
 * @param {Object} pRecord - parsed record
 * @param {Object} [pPage] - fexReadPageMetadata result, empty when the read failed
 * @param {Object} [pReference] - records reference, empty when it failed to load
 * @returns {{oBody: Object, oSublists: Object}} entries are { sLabel, sType, bMandatory }
 */
const buildFieldMeta = (pRecord, pPage, pReference) => {

    const oPage = pPage || {};
    const oRefRecord = (pReference || {})[pRecord.sRecordType] || {};
    const oFieldTypes = oPage.oFieldTypes || {};
    const oLabels = oPage.oLabels || {};
    const oRefFields = oRefRecord.f || {};
    const oBody = {};
    const oSublists = {};

    [...Object.keys(pRecord.oBodyFields), ...pRecord.aEmptyFields].forEach((pId) => {

        const oLabel = normalizePageLabel(oLabels[pId]);
        const aRef = oRefFields[pId] || [];

        oBody[pId] = {
            sLabel: oLabel.sLabel || aRef[0] || '',
            sType: oFieldTypes[pId] || aRef[1] || '',
            bMandatory: oLabel.bMandatory || !!aRef[2]
        };
    });

    Object.entries(pRecord.oSublistInfo).forEach(([pName, pInfo]) => {

        const oCells = (oPage.oCells || {})[pName] || {};
        const oRefCols = (oRefRecord.s || {})[pName] || {};
        const oHeaderTypes = {};
        const oColumns = {};

        /* Edit-mode header cells name their column by label, not by field id */
        Object.entries((oPage.oHeaderTypes || {})[pName] || {}).forEach(([pHeader, pType]) => {

            oHeaderTypes[normalizePageLabel(pHeader).sLabel] = pType;
        });

        [...pInfo.aCols, ...pInfo.aEmptyCols].forEach((pCol) => {

            const oLabel = normalizePageLabel(oCells[pCol] || oLabels[`${pName}_${pCol}`]);
            const aRef = oRefCols[pCol] || [];

            oColumns[pCol] = {
                sLabel: oLabel.sLabel || aRef[0] || '',
                sType: (oLabel.sLabel ? oHeaderTypes[oLabel.sLabel] : '') || aRef[1] || '',
                bMandatory: oLabel.bMandatory || !!aRef[2]
            };
        });

        oSublists[pName] = oColumns;
    });

    return { oBody: oBody, oSublists: oSublists };
};

/**
 * Projects known labels onto a set of populated fields and lines. Hand it the same filtered
 * objects an export carries and the labels follow that export.
 *
 * @param {Object} pBodyFields - body fields in this projection
 * @param {Object} pSublists - sublist lines in this projection
 * @param {Object} pMeta - buildFieldMeta result
 * @returns {{body: Object, sublists: Object}}
 */
const buildFieldLabels = (pBodyFields, pSublists, pMeta) => {

    const oBody = {};
    const oSublists = {};

    Object.keys(pBodyFields).forEach((pId) => {

        const sLabel = pMeta.oBody[pId]?.sLabel;

        if (sLabel) oBody[pId] = sLabel;
    });

    Object.entries(pSublists).forEach(([pName, pLines]) => {

        const oColMeta = pMeta.oSublists[pName] || {};
        const oColumns = {};

        pLines.forEach((pLine) => {

            Object.keys(pLine).forEach((pCol) => {

                if (oColMeta[pCol]?.sLabel) oColumns[pCol] = oColMeta[pCol].sLabel;
            });
        });

        if (Object.keys(oColumns).length > 0) oSublists[pName] = oColumns;
    });

    return { body: oBody, sublists: oSublists };
};

/* ──── Search ──── */

/**
 * Tests a lowercase term against any of the given texts, case-insensitively.
 *
 * @param {string} pTerm - lowercase search term
 * @param {...string} pTexts - texts to look in
 * @returns {boolean}
 */
const fieldTextHit = (pTerm, ...pTexts) => pTexts.some((pText) => (pText || '').toLowerCase().includes(pTerm));

/**
 * Builds the body field rows for the current view. The table, its count and the CSV all read
 * this, which is what keeps them in agreement.
 *
 * @param {Object} pRecord - parsed record
 * @param {Object} pMeta - buildFieldMeta result
 * @param {string} pTerm - lowercase search term, '' for none
 * @param {string} pFilter - field filter value
 * @param {boolean} pShowEmpty - Empty checkbox state; a term finds empties either way
 * @returns {Array<Object>} rows of { sId, vValue, sLabel, sType, bMandatory, bEmpty }
 */
const buildBodyRows = (pRecord, pMeta, pTerm, pFilter, pShowEmpty) => {

    const aRows = [];

    Object.entries(pRecord.oBodyFields).forEach(([pId, pValue]) => {

        if (!passesFieldFilter(pId, pFilter)) return;

        const oMeta = pMeta.oBody[pId] || {};

        if (pTerm && !fieldTextHit(pTerm, pId, oMeta.sLabel, stringifyFieldValue(pValue))) return;

        aRows.push({
            sId: pId,
            vValue: pValue,
            sLabel: oMeta.sLabel || '',
            sType: resolveFieldType(pId, pValue, oMeta.sType),
            bMandatory: !!oMeta.bMandatory,
            bEmpty: false
        });
    });

    if (!pTerm && !pShowEmpty) return aRows;

    pRecord.aEmptyFields.forEach((pId) => {

        if (!passesFieldFilter(pId, pFilter)) return;

        const oMeta = pMeta.oBody[pId] || {};

        if (pTerm && !fieldTextHit(pTerm, pId, oMeta.sLabel)) return;

        aRows.push({
            sId: pId,
            vValue: '',
            sLabel: oMeta.sLabel || '',
            sType: resolveFieldType(pId, '', oMeta.sType),
            bMandatory: !!oMeta.bMandatory,
            bEmpty: true
        });
    });

    return aRows;
};

/**
 * Builds the search haystacks for a sublist's lines, in one pass. One string per column answers
 * "does this column have a hit", two per line answer "does this line have a hit" under each
 * field filter. Search cost then stays flat however many keystrokes follow.
 *
 * @param {Array<Object>} pLines - sublist lines
 * @returns {{oColHay: Map, aStandardHay: Array<string>, aCustomHay: Array<string>}}
 */
const buildSublistIndex = (pLines) => {

    const oColParts = new Map();
    const oCustomCols = new Map();
    const aStandardHay = new Array(pLines.length);
    const aCustomHay = new Array(pLines.length);

    pLines.forEach((pLine, pIndex) => {

        const aStandard = [];
        const aCustom = [];

        Object.entries(pLine).forEach(([pCol, pValue]) => {

            const sLower = stringifyFieldValue(pValue).toLowerCase();

            if (!oColParts.has(pCol)) {
                oColParts.set(pCol, []);
                oCustomCols.set(pCol, isCustomField(pCol));
            }

            oColParts.get(pCol).push(sLower);
            (oCustomCols.get(pCol) ? aCustom : aStandard).push(sLower);
        });

        aStandardHay[pIndex] = aStandard.join(FEX_HAY_SEP);
        aCustomHay[pIndex] = aCustom.join(FEX_HAY_SEP);
    });

    const oColHay = new Map();

    oColParts.forEach((pParts, pCol) => oColHay.set(pCol, pParts.join(FEX_HAY_SEP)));

    return { oColHay: oColHay, aStandardHay: aStandardHay, aCustomHay: aCustomHay };
};

/**
 * Works out which columns and lines of a sublist are visible. A column id or label hit keeps
 * every line; otherwise a line needs a value hit in a column that survives the filter.
 *
 * @param {Array<Object>} pLines - sublist lines
 * @param {Object} pInfo - oSublistInfo entry
 * @param {Object} pColMeta - column metadata for this sublist
 * @param {Object|null} pIndex - buildSublistIndex result, required with a term
 * @param {string} pTerm - lowercase search term, '' for none
 * @param {string} pFilter - field filter value
 * @param {boolean} pShowEmpty - Empty checkbox state; a term finds empties either way
 * @returns {{aCols: Array<string>, aLineIndexes: Array<number>}}
 */
const searchSublist = (pLines, pInfo, pColMeta, pIndex, pTerm, pFilter, pShowEmpty) => {

    const aCols = [];
    let bKeepAllLines = !pTerm;

    pInfo.aCols.forEach((pCol) => {

        if (!passesFieldFilter(pCol, pFilter)) return;

        if (!pTerm) {
            aCols.push(pCol);
            return;
        }

        const bNameHit = fieldTextHit(pTerm, pCol, pColMeta[pCol]?.sLabel);

        if (bNameHit) bKeepAllLines = true;

        if (bNameHit || pIndex.oColHay.get(pCol)?.includes(pTerm)) aCols.push(pCol);
    });

    pInfo.aEmptyCols.forEach((pCol) => {

        if (!passesFieldFilter(pCol, pFilter)) return;

        if (!pTerm) {

            if (pShowEmpty) aCols.push(pCol);

            return;
        }

        if (fieldTextHit(pTerm, pCol, pColMeta[pCol]?.sLabel)) {
            aCols.push(pCol);
            bKeepAllLines = true;
        }
    });

    const aLineIndexes = [];

    if (aCols.length === 0) return { aCols: aCols, aLineIndexes: aLineIndexes };

    const bStandard = pFilter !== 'custom';
    const bCustom = pFilter !== 'standard';

    for (let nLine = 0; nLine < pLines.length; nLine++) {

        if (bKeepAllLines
            || (bStandard && pIndex.aStandardHay[nLine].includes(pTerm))
            || (bCustom && pIndex.aCustomHay[nLine].includes(pTerm))) {

            aLineIndexes.push(nLine);
        }
    }

    return { aCols: aCols, aLineIndexes: aLineIndexes };
};

/**
 * Recursively filters object properties by an uppercase search term. Backs the Legacy tree and
 * the Raw JSON panel.
 *
 * @param {*} pObj - object to filter
 * @param {string} pSearchUpper - uppercase search term
 * @returns {*} filtered object or array
 */
const deepFilterObject = (pObj, pSearchUpper) => {

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
};

/* ──── CSV ──── */

/* Excel only detects UTF-8 in a downloaded CSV when the BOM is present */
const CSV_BOM = '\ufeff';

/**
 * Quotes a CSV cell and neutralizes values a spreadsheet would evaluate.
 *
 * @param {*} pValue - cell value
 * @returns {string} quoted, formula-safe cell
 */
const toCsvCell = (pValue) => {

    /* Half-width and full-width forms of the four spreadsheet formula leaders, plus
     * the whitespace a leading formula can hide behind (OWASP CSV injection) */
    const sValue = String(pValue ?? '');
    const sGuarded = /^[=+\-@\t\r\n＝＋－＠]/.test(sValue) ? `'${sValue}` : sValue;

    return `"${sGuarded.replace(/"/g, '""')}"`;
};

/**
 * Serializes rows to CSV text with the BOM prefix.
 *
 * @param {Array<Array>} pRows - header row followed by data rows
 * @returns {string} CSV document
 */
const buildCsv = (pRows) => {

    return CSV_BOM + pRows.map((pRow) => pRow.map((pCol) => toCsvCell(pCol)).join(',')).join('\n');
};

/* ──── Documentation Links ──── */

/**
 * Builds the documentation links for a record type on the tab's own origin.
 *
 * @param {string} pOrigin - tab origin
 * @param {string} pRecordType - record type
 * @returns {{sBrowser: string, sCatalog: string}} sBrowser is '' for types the browser cannot have
 */
const buildDocLinks = (pOrigin, pRecordType) => {

    const sType = encodeURIComponent(pRecordType || '');
    const bAccountSpecific = /^(customrecord|customtransaction)/i.test(pRecordType || '');
    const sBrowserRoot = `${pOrigin}/help/helpcenter/en_US/srbrowser/${FEX_RECORDS_BROWSER_VERSION}/script/record`;

    return {
        sBrowser: bAccountSpecific ? '' : `${sBrowserRoot}/${sType}.html`,
        sCatalog: `${pOrigin}/app/recordscatalog/rcbrowser.nl?whence=#/record_ss/${sType}`
    };
};

/* ──── Compare ──── */

/**
 * Diffs two flat field maps, skipping internals.
 *
 * @param {Object} pPinned - pinned fields
 * @param {Object} pCurrent - current fields
 * @param {Object} pExtra - properties copied onto every row
 * @returns {Array<Object>} rows of { sCol, sPinned, sCurrent, sKind, ...pExtra }
 */
const diffFieldMaps = (pPinned, pCurrent, pExtra) => {

    const aRows = [];

    new Set([...Object.keys(pPinned), ...Object.keys(pCurrent)]).forEach((pCol) => {

        if (isInternalFieldId(pCol)) return;

        const sPinned = stringifyFieldValue(pPinned[pCol]);
        const sCurrent = stringifyFieldValue(pCurrent[pCol]);

        /* Missing and empty stringify alike, so they count as equal */
        if (sPinned === sCurrent) return;

        const sKind = sPinned ? (sCurrent ? 'changed' : 'removed') : 'added';

        aRows.push({ sCol: pCol, sPinned: sPinned, sCurrent: sCurrent, sKind: sKind, ...pExtra });
    });

    return aRows;
};

/**
 * Compares a pinned snapshot with the current record. Lines align by position.
 *
 * @param {Object} pPinned - snapshot with oBodyFields, oSublists, oFieldLabels
 * @param {Object} pCurrent - same shape, for the loaded record
 * @returns {{aBody: Array, oBodyLabels: Object, aSublists: Array, nTotal: number}} nTotal counts every
 * row, unfiltered
 */
const diffRecords = (pPinned, pCurrent) => {

    const aBody = diffFieldMaps(pPinned.oBodyFields || {}, pCurrent.oBodyFields || {}, {});
    const aSublists = [];
    const oPinnedSublists = pPinned.oSublists || {};
    const oCurrentSublists = pCurrent.oSublists || {};
    const oPinnedLabels = pPinned.oFieldLabels?.sublists || {};
    const oCurrentLabels = pCurrent.oFieldLabels?.sublists || {};
    let nTotal = aBody.length;

    new Set([...Object.keys(oPinnedSublists), ...Object.keys(oCurrentSublists)]).forEach((pName) => {

        const aPinned = oPinnedSublists[pName] || [];
        const aCurrent = oCurrentSublists[pName] || [];
        const nLines = Math.max(aPinned.length, aCurrent.length);
        const aRows = [];

        for (let nIndex = 0; nIndex < nLines; nIndex++) {

            const nLine = nIndex + 1;

            if (nIndex < aPinned.length && nIndex < aCurrent.length) {
                aRows.push(...diffFieldMaps(aPinned[nIndex], aCurrent[nIndex], { nLine: nLine }));
                continue;
            }

            const bAdded = nIndex >= aPinned.length;
            const oLine = bAdded ? aCurrent[nIndex] : aPinned[nIndex];
            const nFields = Object.entries(oLine).filter(([pCol, pValue]) => {

                return !isInternalFieldId(pCol) && stringifyFieldValue(pValue) !== '';
            }).length;

            aRows.push({
                nLine: nLine,
                sCol: bAdded ? '(line added)' : '(line removed)',
                sPinned: bAdded ? '' : `${nFields} fields`,
                sCurrent: bAdded ? `${nFields} fields` : '',
                sKind: bAdded ? 'added' : 'removed',
                oWholeLine: oLine
            });
        }

        if (aRows.length > 0) {

            nTotal += aRows.length;
            aSublists.push({
                sName: pName,
                aRows: aRows,
                oLabels: { ...(oPinnedLabels[pName] || {}), ...(oCurrentLabels[pName] || {}) }
            });
        }
    });

    return {
        aBody: aBody,
        oBodyLabels: { ...(pPinned.oFieldLabels?.body || {}), ...(pCurrent.oFieldLabels?.body || {}) },
        aSublists: aSublists,
        nTotal: nTotal
    };
};

/**
 * Narrows diff rows to the current filter and search. A cell row needs its column to survive the
 * filter and its id, label or either value to match. A whole-line row needs one populated,
 * non-internal column on that line to pass both.
 *
 * @param {Array<Object>} pRows - diff rows
 * @param {Object} pLabels - field id to label
 * @param {string} pTerm - lowercase search term, '' for none
 * @param {string} pFilter - field filter value
 * @returns {Array<Object>} rows kept
 */
const filterDiffRows = (pRows, pLabels, pTerm, pFilter) => {

    if (!pTerm && (!pFilter || pFilter === 'all')) return pRows;

    return pRows.filter((pRow) => {

        if (!pRow.oWholeLine) {

            return passesFieldFilter(pRow.sCol, pFilter)
                && (!pTerm || fieldTextHit(pTerm, pRow.sCol, pLabels[pRow.sCol], pRow.sPinned, pRow.sCurrent));
        }

        return Object.entries(pRow.oWholeLine).some(([pCol, pValue]) => {

            const sValue = stringifyFieldValue(pValue);

            return sValue !== ''
                && !isInternalFieldId(pCol)
                && passesFieldFilter(pCol, pFilter)
                && (!pTerm || fieldTextHit(pTerm, pCol, pLabels[pCol], sValue));
        });
    });
};

/* ──── Nav Rules ──── */

/**
 * Finds the rule that applies to a menu item: by id, then label, then a rule whose stored label
 * equals the item's. The last step is what keeps a rule from an older build, keyed on an
 * automation id the menu no longer carries, attached to its item.
 *
 * @param {Map<string, {id: string, label: string}>} pRules - rules by key
 * @param {Object} pItem - menu item { id, label }
 * @returns {string} rule key, or '' when no rule applies
 */
const resolveNavRuleKey = (pRules, pItem) => {

    if (pItem.id && pRules.has(pItem.id)) return pItem.id;
    if (!pItem.label) return '';
    if (pRules.has(pItem.label)) return pItem.label;

    for (const [sKey, oRule] of pRules) {

        if (oRule.label === pItem.label) return sKey;
    }

    return '';
};

/**
 * Indexes the ids and labels of a scanned menu tree.
 *
 * @param {Array<Object>} pItems - menu tree
 * @param {{oIds: Set, oLabels: Set}} [pIndex] - accumulator
 * @returns {{oIds: Set, oLabels: Set}}
 */
const collectNavTreeIndex = (pItems, pIndex) => {

    const oIndex = pIndex || { oIds: new Set(), oLabels: new Set() };

    pItems.forEach((pItem) => {

        if (pItem.id) oIndex.oIds.add(pItem.id);
        if (pItem.label) oIndex.oLabels.add(pItem.label);
        if (pItem.children?.length) collectNavTreeIndex(pItem.children, oIndex);
    });

    return oIndex;
};

/**
 * Tells whether any item of the scanned tree resolves to a rule. See resolveNavRuleKey.
 *
 * @param {string} pKey - rule key
 * @param {{id: string, label: string}} pRule - stored rule
 * @param {{oIds: Set, oLabels: Set}} pIndex - collectNavTreeIndex result
 * @returns {boolean}
 */
const isNavRuleInTree = (pKey, pRule, pIndex) => {

    return pIndex.oIds.has(pKey) || pIndex.oLabels.has(pKey) || (!!pRule.label && pIndex.oLabels.has(pRule.label));
};

/**
 * Tests a menu item's own label and id against a lowercase term.
 *
 * @param {Object} pItem - menu item
 * @param {string} pTerm - lowercase search term
 * @returns {boolean}
 */
const navItemMatchesOwn = (pItem, pTerm) => fieldTextHit(pTerm, pItem.label, pItem.id);

/**
 * Tests a menu item or anything below it against a lowercase term.
 *
 * @param {Object} pItem - menu item
 * @param {string} pTerm - lowercase search term
 * @returns {boolean}
 */
const navItemHasMatch = (pItem, pTerm) => {

    return navItemMatchesOwn(pItem, pTerm)
        || (pItem.children || []).some((pChild) => navItemHasMatch(pChild, pTerm));
};
