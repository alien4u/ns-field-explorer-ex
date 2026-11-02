import {describe, expect, test} from 'bun:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {loadScripts, plain} from './fakes.js';

const {read} = loadScripts(['js/shared.js', 'js/core.js']);

describe('isCustomField', () => {

    const fnCustom = read('isCustomField');

    test('exact namespaces are custom', () => {

        ['custbody_a', 'custcol_a', 'custentity_a', 'custevent_a', 'custitemnumber_a', 'custitem_a', 'custrecord_a',
            'custpage_x', 'cseg_x', 'CUSTBODY_UPPER'].forEach((pId) => expect(fnCustom(pId)).toBe(true));
    });

    test('customform and customer stay standard, so does a bare cust prefix', () => {

        ['customform', 'customer', 'custom', 'cust', 'entity', '', null].forEach((pId) => {

            expect(fnCustom(pId)).toBe(false);
        });
    });
});

describe('isInternalFieldId', () => {

    const fnInternal = read('isInternalFieldId');

    test('plumbing names are internal', () => {

        ['_csrf', '_multibtnstate_', 'nsapiCT', 'nlapiCC', 'wfFC', 'wfPI', 'nsbrowserenv', 'selectedtab']
            .forEach((pId) => expect(fnInternal(pId)).toBe(true));
    });

    test('names merely resembling them are not', () => {

        ['wfstate', 'wf', 'nldept', 'nluser', 'pp_e', 'entryformquerystring', 'memo', 'custbody_x']
            .forEach((pId) => expect(fnInternal(pId)).toBe(false));
    });
});

describe('passesFieldFilter', () => {

    const fnFilter = read('passesFieldFilter');

    test('all, custom, standard', () => {

        expect(fnFilter('memo', 'all')).toBe(true);
        expect(fnFilter('memo', 'custom')).toBe(false);
        expect(fnFilter('memo', 'standard')).toBe(true);
        expect(fnFilter('custpage_x', 'custom')).toBe(true);
        expect(fnFilter('custpage_x', 'standard')).toBe(false);
        expect(fnFilter('memo', undefined)).toBe(true);
    });
});

describe('type detection', () => {

    const fnDetect = read('detectFieldType');
    const fnResolve = read('resolveFieldType');
    const fnIcon = read('getTypeIcon');

    test('id only for id or *_id', () => {

        expect(fnDetect('id', 'abc')).toBe('id');
        expect(fnDetect('_id', 'abc')).toBe('id');
        expect(fnDetect('record_id', 'abc')).toBe('id');
        expect(fnDetect('RECORD_ID', 'abc')).toBe('id');
        expect(fnDetect('paid', 'abc')).toBe('text');
        expect(fnDetect('entityid', 'abc')).toBe('text');
    });

    test('a currency-looking value on a name ending in id is currency, not number', () => {

        expect(fnDetect('paid', '12.00')).toBe('currency');
        expect(fnDetect('record_id', '12.00')).toBe('number');
    });

    test('date forms and separator variants', () => {

        ['3/15/2026', '3-15-2026', '15.3.2026', '12/31/2026 10:00 am', '2026-03-15', '2026/3/15', '2026.03.15',
            '5-Jan-2026', '05 Jan 2026', '5/Jan/2026', '5.jan.2026', '15-September-2026']
            .forEach((pValue) => expect(fnDetect('anyfield', pValue)).toBe('date'));
    });

    test('things that only resemble dates stay out', () => {

        expect(fnDetect('anyfield', '2026-03-15T10:00:00Z')).toBe('datetime');
        expect(fnDetect('anyfield', '1/2/345678')).toBe('text');
        expect(fnDetect('anyfield', '5-Foo-2026')).toBe('text');
        expect(fnDetect('anyfield', '20260315')).toBe('number');
    });

    test('the rest of the heuristic', () => {

        expect(fnDetect('a', 'T')).toBe('checkbox');
        expect(fnDetect('a', 'F')).toBe('checkbox');
        expect(fnDetect('a', '42')).toBe('number');
        expect(fnDetect('a', 'x@y.example')).toBe('email');
        expect(fnDetect('a', 'https://example.com')).toBe('url');
        expect(fnDetect('a', {_value: '1', _text: 'One'})).toBe('select');
        expect(fnDetect('a', {_value: '1'})).toBe('object');
        expect(fnDetect('a', '')).toBe('text');
    });

    test('a known type wins over the heuristic', () => {

        expect(fnResolve('amount', '5.00', 'select')).toBe('select');
        expect(fnResolve('amount', '5.00', '')).toBe('currency');
        expect(fnResolve('amount', '5.00', undefined)).toBe('currency');
    });

    test('every type seen on live pages has an icon, unknown types keep Aa', () => {

        const aPageTypes = ['select', 'date', 'currency', 'currency2', 'textarea', 'checkbox', 'rate', 'address',
            'integer', 'emails', 'phone', 'email', 'float', 'datetimetz', 'inlinehtml'];

        aPageTypes.forEach((pType) => expect(fnIcon(pType)).not.toBe('Aa'));

        expect(fnIcon('text')).toBe('Aa');
        expect(fnIcon('somethingnew')).toBe('Aa');
    });
});

describe('isRecordCandidatePage', () => {

    const fnGate = read('isRecordCandidatePage');
    const sHost = 'https://1234567.app.netsuite.com';

    test('record and create pages pass', () => {

        [
            '/app/accounting/transactions/salesord.nl?id=5&whence=',
            '/app/accounting/transactions/custinvc.nl?whence=',
            '/app/common/entity/custjob.nl?id=9',
            '/app/common/custom/custrecordentry.nl?rectype=12&id=3',
            '/app/common/item/item.nl?id=4&e=T'
        ].forEach((pPath) => expect(fnGate(sHost + pPath)).toBe(true));
    });

    test('suitelets, centers, login, reports, searches and lists do not', () => {

        [
            '/app/site/hosting/scriptlet.nl?script=1&deploy=1&id=5',
            '/app/center/card.nl?sc=-29',
            '/app/login/secure/enterpriselogin.nl',
            '/app/reporting/reportrunner.nl?cr=1',
            '/app/common/search/searchresults.nl?searchid=1',
            '/app/accounting/transactions/transactionlist.nl?Transaction_TYPE=SalesOrd',
            '/app/common/entity/custjoblist.nl?id=9'
        ].forEach((pPath) => expect(fnGate(sHost + pPath)).toBe(false));
    });

    test('anything that is not a NetSuite .nl page does not', () => {

        expect(fnGate(`${sHost}/app/help/helpcenter.jsp`)).toBe(false);
        expect(fnGate('https://example.com/app/accounting/transactions/salesord.nl?id=5')).toBe(false);
        expect(fnGate('not a url')).toBe(false);
    });
});

describe('mapFetchOutcome', () => {

    const fnMap = read('mapFetchOutcome');
    const oResponse = (pOverrides) => ({sKind: 'response', bOk: true, nStatus: 200, bXml: true, sFinalPath: '/x.nl', ...pOverrides});

    test('record', () => {

        expect(fnMap(oResponse(), {oRecord: {}, oError: null}).sKind).toBe('record');
    });

    test('NetSuite error, with and without a code', () => {

        const oParsed = {oRecord: null, oError: {sDetail: 'That record does not exist.', sCode: 'RCRD_DSNT_EXIST'}};
        const oOutcome = fnMap(oResponse({bOk: false, nStatus: 500}), oParsed);

        expect(plain(oOutcome)).toEqual({
            sKind: 'netsuite-error',
            sMessage: 'That record does not exist. (RCRD_DSNT_EXIST)',
            sClass: 'error-msg'
        });
        expect(fnMap(oResponse(), {oRecord: null, oError: {sDetail: 'Nope', sCode: ''}}).sMessage).toBe('Nope');
    });

    test('other HTTP error, XML or not', () => {

        const sMessage = 'Failed to fetch record: HTTP 503';

        expect(fnMap(oResponse({bOk: false, nStatus: 503, bXml: false}), null).sMessage).toBe(sMessage);
        expect(fnMap(oResponse({bOk: false, nStatus: 503}), {oRecord: null, oError: null}).sMessage).toBe(sMessage);
        expect(fnMap(oResponse({bOk: false, nStatus: 503}), null).sClass).toBe('error-msg');
    });

    test('not a record is the non-error message', () => {

        const oOutcome = fnMap(oResponse({bXml: false}), null);

        expect(oOutcome.sKind).toBe('not-record');
        expect(oOutcome.sClass).toBe('empty-msg');
        expect(oOutcome.sMessage).toStartWith('No record detected on this page');
    });

    test('session: login page landing or fetch failure', () => {

        const sMessage = 'Could not reach NetSuite. Your session may have expired - log in and reopen.';

        expect(fnMap(oResponse({bXml: false, sFinalPath: '/app/login/secure/x.nl'}), null).sMessage).toBe(sMessage);
        expect(fnMap(oResponse({bXml: false, bOk: false, nStatus: 403, sFinalPath: '/app/login/x'}), null).sMessage)
            .toBe(sMessage);
        expect(fnMap({sKind: 'network'}, null).sMessage).toBe(sMessage);
        expect(fnMap({sKind: 'network'}, null).sClass).toBe('error-msg');
    });

    test('timeout', () => {

        const oOutcome = fnMap({sKind: 'timeout'}, null);

        expect(oOutcome.sMessage).toBe('NetSuite took too long to respond. Try again.');
        expect(oOutcome.sClass).toBe('error-msg');
    });

    test('unparseable, including nothing returned at all', () => {

        const sMessage = 'Could not parse record data. Are you on a record page?';

        expect(fnMap(oResponse(), {oRecord: null, oError: null}).sMessage).toBe(sMessage);
        expect(fnMap(oResponse(), {oRecord: null, oError: null}).sClass).toBe('error-msg');
        expect(fnMap(undefined, null).sMessage).toBe(sMessage);
    });
});

describe('fexFetchRecordXml', () => {

    /**
     * Runs the injected function with a fake fetch in the vm context.
     *
     * @param {Function} pFetch
     * @param {number} [pTimeout]
     * @returns {Promise<Object>}
     */
    const run = (pFetch, pTimeout = 1000) => {

        const oContext = loadScripts(['js/shared.js', 'js/core.js'], {fetch: pFetch});

        return oContext.read('fexFetchRecordXml')('https://a.app.netsuite.com/x.nl?id=1&xml=T', pTimeout);
    };

    /**
     * Builds a Response whose body read is observable.
     *
     * @param {string} pBody
     * @param {Object} pInit
     * @param {string} [pUrl] - final URL after redirects
     * @returns {{oResp: Response, nReads: Function}}
     */
    const makeResponse = (pBody, pInit, pUrl) => {

        const oResp = new Response(pBody, pInit);
        const fnText = oResp.text.bind(oResp);
        let nReads = 0;

        oResp.text = () => {

            nReads++;
            return fnText();
        };

        if (pUrl) Object.defineProperty(oResp, 'url', {value: pUrl});

        return {oResp: oResp, nReads: () => nReads};
    };

    test('sends the session cookies and an abort signal, reads an XML body', async () => {

        const oMade = makeResponse('<x/>', {headers: {'content-type': 'text/xml; charset=UTF-8'}});
        let oInit = null;
        const oResult = await run((pUrl, pInit) => {

            oInit = pInit;
            return Promise.resolve(oMade.oResp);
        });

        expect(oInit.credentials).toBe('include');
        expect(oInit.signal).toBeDefined();
        expect(oMade.nReads()).toBe(1);
        expect(plain(oResult)).toEqual({
            sKind: 'response',
            bOk: true,
            nStatus: 200,
            bXml: true,
            sFinalPath: '/x.nl',
            sBody: '<x/>'
        });
    });

    test('does not read a non-XML body, and reports where a redirect landed', async () => {

        const sFinal = 'https://a.app.netsuite.com/app/login/secure/enterpriselogin.nl';
        const oMade = makeResponse('<html></html>', {headers: {'content-type': 'text/html'}}, sFinal);
        const oResult = await run(() => Promise.resolve(oMade.oResp));

        expect(oMade.nReads()).toBe(0);
        expect(oResult.bXml).toBe(false);
        expect(oResult.sBody).toBe('');
        expect(oResult.sFinalPath).toBe('/app/login/secure/enterpriselogin.nl');
    });

    test('a thrown fetch is network', async () => {

        expect(plain(await run(() => Promise.reject(new TypeError('Failed to fetch'))))).toEqual({sKind: 'network'});
    });

    test('the deadline aborts a stalled request', async () => {

        const oResult = await run((pUrl, pInit) => new Promise((pResolve, pReject) => {

            pInit.signal.addEventListener('abort', () => pReject(new DOMException('Aborted', 'AbortError')));
        }), 20);

        expect(plain(oResult)).toEqual({sKind: 'timeout'});
    });

    test('the deadline also covers a stalled body read', async () => {

        const oResult = await run((pUrl, pInit) => Promise.resolve({
            ok: true,
            status: 200,
            url: pUrl,
            headers: {get: () => 'text/xml'},
            text: () => new Promise((pResolve, pReject) => {

                pInit.signal.addEventListener('abort', () => pReject(new DOMException('Aborted', 'AbortError')));
            })
        }), 20);

        expect(plain(oResult)).toEqual({sKind: 'timeout'});
    });

    test('the production deadline is 60 s', () => {

        expect(read('FEX_FETCH_TIMEOUT_MS')).toBe(60000);
    });
});

describe('injected functions are self-contained', () => {

    /**
     * Compiles an injected function the way executeScript delivers it: from its source text, in a
     * context holding only what a real page has. Anything else from core.js or shared.js is then a
     * ReferenceError. fexFetchRecordXml catches inside its try, so the tests below assert the exact
     * result of every path rather than only that nothing threw.
     *
     * @param {string} pName - function name
     * @param {Object} pGlobals - page globals beyond the language built-ins
     * @returns {{fnInjected: Function, oPage: Object}}
     */
    const compileForPage = (pName, pGlobals) => {

        const oPage = vm.createContext({console: console, ...pGlobals});

        return {fnInjected: vm.runInContext(`(${read(`${pName}.toString()`)})`, oPage), oPage: oPage};
    };

    const oFetchGlobals = {AbortController: AbortController, URL: URL, setTimeout: setTimeout, clearTimeout: clearTimeout};
    const sUrl = 'https://a.app.netsuite.com/app/x.nl?id=1&xml=T';

    test('the page context really lacks the extension globals', () => {

        const {oPage} = compileForPage('fexReadPageMetadata', {document: {querySelectorAll: () => []}});

        ['FEX_LOGIN_PATH', 'FEX_FETCH_TIMEOUT_MS', 'splitFieldList', 'normalizePageLabel', 'browserAPI', 'chrome']
            .forEach((pName) => expect(vm.runInContext(`typeof ${pName}`, oPage)).toBe('undefined'));
    });

    test('fexFetchRecordXml, XML response', async () => {

        const {fnInjected} = compileForPage('fexFetchRecordXml', {
            ...oFetchGlobals,
            fetch: async () => new Response('<x/>', {headers: {'content-type': 'text/xml'}})
        });

        expect(plain(await fnInjected(sUrl, 1000))).toEqual({
            sKind: 'response',
            bOk: true,
            nStatus: 200,
            bXml: true,
            sFinalPath: '/app/x.nl',
            sBody: '<x/>'
        });
    });

    test('fexFetchRecordXml, non-XML response', async () => {

        const {fnInjected} = compileForPage('fexFetchRecordXml', {
            ...oFetchGlobals,
            fetch: async () => new Response('<html/>', {status: 404, headers: {'content-type': 'text/html'}})
        });

        expect(plain(await fnInjected(sUrl, 1000))).toEqual({
            sKind: 'response',
            bOk: false,
            nStatus: 404,
            bXml: false,
            sFinalPath: '/app/x.nl',
            sBody: ''
        });
    });

    test('fexFetchRecordXml, network failure', async () => {

        const {fnInjected} = compileForPage('fexFetchRecordXml', {
            ...oFetchGlobals,
            fetch: async () => {

                throw new TypeError('Failed to fetch');
            }
        });

        expect(plain(await fnInjected(sUrl, 1000))).toEqual({sKind: 'network'});
    });

    test('fexFetchRecordXml, deadline', async () => {

        const {fnInjected} = compileForPage('fexFetchRecordXml', {
            ...oFetchGlobals,
            fetch: (pTarget, pInit) => new Promise((pResolve, pReject) => {

                pInit.signal.addEventListener('abort', () => pReject(new DOMException('Aborted', 'AbortError')));
            })
        });

        expect(plain(await fnInjected(sUrl, 10))).toEqual({sKind: 'timeout'});
    });

    test('fexReadPageMetadata reaches every branch', () => {

        /**
         * Page element double: attributes, plus what querySelectorAll finds inside it.
         *
         * @param {Object} pSpec - id, textContent, aAttrs, oInside
         * @returns {Object}
         */
        const makeElement = (pSpec) => ({
            id: pSpec.id || '',
            textContent: pSpec.textContent || '',
            getAttribute: (pName) => (pSpec.oAttrs || {})[pName] ?? null,
            querySelectorAll: (pSelector) => (pSpec.oInside || {})[pSelector] || []
        });

        const oDocument = makeElement({
            oInside: {
                '.uir-field-wrapper[data-field-name]': [
                    makeElement({oAttrs: {'data-field-name': 'memo', 'data-field-type': 'textarea'}})
                ],
                '[id$="_fs_lbl"]': [makeElement({id: 'memo_fs_lbl', textContent: 'Memo'})],
                '[id$="_splits"]': [makeElement({
                    id: 'item_splits',
                    oInside: {
                        'tr.uir-machine-row td[data-field-name]': [
                            makeElement({oAttrs: {'data-field-name': 'qty', 'data-ns-tooltip': 'Quantity'}}),
                            makeElement({oAttrs: {'data-field-name': 'qty', 'data-ns-tooltip': 'Second row'}})
                        ]
                    }
                })],
                '[id$="_headerrow"]': [makeElement({
                    id: 'item_headerrow',
                    oInside: {
                        'td[data-label][data-column-type]': [
                            makeElement({oAttrs: {'data-label': 'Quantity', 'data-column-type': 'float'}})
                        ]
                    }
                })]
            }
        });

        const {fnInjected} = compileForPage('fexReadPageMetadata', {document: oDocument});

        expect(plain(fnInjected())).toEqual({
            oFieldTypes: {memo: 'textarea'},
            oLabels: {memo: 'Memo'},
            oCells: {item: {qty: 'Quantity'}},
            oHeaderTypes: {item: {Quantity: 'float'}}
        });
    });
});

describe('normalizePageLabel', () => {

    const fnNormalize = read('normalizePageLabel');

    test('strips the mandatory marker and records it', () => {

        expect(plain(fnNormalize('Date\n*'))).toEqual({sLabel: 'Date', bMandatory: true});
        expect(plain(fnNormalize('  Item \n * '))).toEqual({sLabel: 'Item', bMandatory: true});
        expect(plain(fnNormalize('Memo'))).toEqual({sLabel: 'Memo', bMandatory: false});
    });

    test('tolerates nothing', () => {

        expect(plain(fnNormalize(undefined))).toEqual({sLabel: '', bMandatory: false});
    });

    test('a marker alone is mandatory with no label', () => {

        expect(plain(fnNormalize('\n*'))).toEqual({sLabel: '', bMandatory: true});
    });
});

describe('buildFieldMeta', () => {

    const fnMeta = read('buildFieldMeta');
    const oRecord = {
        sRecordType: 'invoice',
        oBodyFields: {both: 'x', pageonly: 'x', refonly: 'x', neither: 'x'},
        aEmptyFields: ['emptyref'],
        oSublists: {item: []},
        oSublistInfo: {item: {sType: 'edit', aCols: ['view', 'edit', 'refcol'], aEmptyCols: ['blank']}}
    };
    const oPage = {
        oFieldTypes: {both: 'textarea', pageonly: 'select'},
        oLabels: {both: 'Page Both\n*', pageonly: 'Page Only', item_edit: 'Edit Label\n*', item_blank: 'Blank'},
        oCells: {item: {view: 'View Label'}},
        oHeaderTypes: {item: {'Edit Label': 'float', 'View Label': 'text'}}
    };
    const oReference = {
        invoice: {
            f: {both: ['Ref Both', 'text', 0], refonly: ['Ref Only', 'currency', 1], emptyref: ['Ref Empty', 'date', 0]},
            s: {item: {refcol: ['Ref Col', 'select'], edit: ['Ref Edit', 'text']}}
        }
    };

    test('page label and type beat the reference, mandatory shows when either says so', () => {

        const oMeta = fnMeta(oRecord, oPage, oReference);

        expect(plain(oMeta.oBody.both)).toEqual({sLabel: 'Page Both', sType: 'textarea', bMandatory: true});
        expect(plain(oMeta.oBody.pageonly)).toEqual({sLabel: 'Page Only', sType: 'select', bMandatory: false});
        expect(plain(oMeta.oBody.refonly)).toEqual({sLabel: 'Ref Only', sType: 'currency', bMandatory: true});
        expect(plain(oMeta.oBody.neither)).toEqual({sLabel: '', sType: '', bMandatory: false});
        expect(oMeta.oBody.emptyref.sLabel).toBe('Ref Empty');
    });

    test('sublist labels: tooltip, then the edit-mode span, then the reference', () => {

        const oCols = fnMeta(oRecord, oPage, oReference).oSublists.item;

        expect(oCols.view.sLabel).toBe('View Label');
        expect(oCols.edit.sLabel).toBe('Edit Label');
        expect(oCols.edit.bMandatory).toBe(true);
        expect(oCols.refcol.sLabel).toBe('Ref Col');
        expect(oCols.blank.sLabel).toBe('Blank');
    });

    test('sublist types: the header cell, then the reference, never a guess', () => {

        const oCols = fnMeta(oRecord, oPage, oReference).oSublists.item;

        expect(oCols.edit.sType).toBe('float');
        expect(oCols.refcol.sType).toBe('select');
        expect(oCols.blank.sType).toBe('');
    });

    test('a header with a blank label joins to no column', () => {

        const oBlank = {...oPage, oHeaderTypes: {item: {'': 'currency', 'Edit Label': 'float'}}};
        const oCols = fnMeta(oRecord, oBlank, oReference).oSublists.item;

        expect(oCols.refcol.sType).toBe('select');
        expect(oCols.blank.sType).toBe('');
        expect(oCols.edit.sType).toBe('float');
    });

    test('a reference entry with a blank label still carries mandatory', () => {

        const oBlankRef = {invoice: {f: {neither: ['', '', 1]}}};

        expect(plain(fnMeta(oRecord, {}, oBlankRef).oBody.neither)).toEqual({sLabel: '', sType: '', bMandatory: true});
    });

    test('each source failing leaves the other working', () => {

        expect(fnMeta(oRecord, {}, oReference).oBody.both.sLabel).toBe('Ref Both');
        expect(fnMeta(oRecord, oPage, {}).oBody.both.sLabel).toBe('Page Both');
        expect(fnMeta(oRecord, undefined, undefined).oBody.both.sLabel).toBe('');
    });

    test('a record type the reference does not know is fine', () => {

        expect(fnMeta({...oRecord, sRecordType: 'customrecord_x'}, {}, oReference).oBody.refonly.sLabel).toBe('');
    });
});

describe('buildFieldLabels', () => {

    const fnLabels = read('buildFieldLabels');
    const oMeta = {
        oBody: {a: {sLabel: 'A label'}, b: {sLabel: ''}, blank: {sLabel: 'Blank label'}},
        oSublists: {item: {x: {sLabel: 'X label'}, y: {sLabel: ''}, blankcol: {sLabel: 'Blank col'}}}
    };

    test('known labels of the fields and lines handed in, nothing else', () => {

        const oResult = fnLabels({a: '1', b: '2'}, {item: [{x: '1', y: '2'}], other: []}, oMeta);

        expect(plain(oResult)).toEqual({body: {a: 'A label'}, sublists: {item: {x: 'X label'}}});
    });

    test('a filtered projection gets filtered labels', () => {

        expect(plain(fnLabels({}, {}, oMeta))).toEqual({body: {}, sublists: {}});
    });
});

describe('buildBodyRows', () => {

    const fnRows = read('buildBodyRows');
    const oRecord = {
        oBodyFields: {memo: 'Hello', custbody_a: 'World', trandate: '3/15/2026'},
        aEmptyFields: ['department', 'custbody_blank']
    };
    const oMeta = {
        oBody: {
            memo: {sLabel: 'Note', sType: 'textarea', bMandatory: true},
            department: {sLabel: 'Division', sType: 'select', bMandatory: false}
        }
    };
    const fnIds = (pRows) => plain(pRows).map((pRow) => pRow.sId);

    test('off hides empties, on shows them after the populated rows', () => {

        expect(fnIds(fnRows(oRecord, oMeta, '', 'all', false))).toEqual(['memo', 'custbody_a', 'trandate']);
        expect(fnIds(fnRows(oRecord, oMeta, '', 'all', true)))
            .toEqual(['memo', 'custbody_a', 'trandate', 'department', 'custbody_blank']);
    });

    test('a term finds empties by id or label, with the checkbox off', () => {

        expect(fnIds(fnRows(oRecord, oMeta, 'division', 'all', false))).toEqual(['department']);
        expect(fnIds(fnRows(oRecord, oMeta, 'custbody_bl', 'all', false))).toEqual(['custbody_blank']);
        expect(fnIds(fnRows(oRecord, oMeta, 'zzz', 'all', true))).toEqual([]);
    });

    test('a term matches id, label and value', () => {

        expect(fnIds(fnRows(oRecord, oMeta, 'note', 'all', false))).toEqual(['memo']);
        expect(fnIds(fnRows(oRecord, oMeta, 'world', 'all', false))).toEqual(['custbody_a']);
        expect(fnIds(fnRows(oRecord, oMeta, 'trand', 'all', false))).toEqual(['trandate']);
    });

    test('the field filter applies to empties too', () => {

        expect(fnIds(fnRows(oRecord, oMeta, '', 'custom', true))).toEqual(['custbody_a', 'custbody_blank']);
        expect(fnIds(fnRows(oRecord, oMeta, '', 'standard', true))).toEqual(['memo', 'trandate', 'department']);
    });

    test('rows carry the resolved type, label and flags', () => {

        const aRows = plain(fnRows(oRecord, oMeta, '', 'all', true));

        expect(aRows[0]).toEqual({
            sId: 'memo', vValue: 'Hello', sLabel: 'Note', sType: 'textarea', bMandatory: true, bEmpty: false
        });
        expect(aRows[2].sType).toBe('date');
        expect(aRows[3].bEmpty).toBe(true);
        expect(aRows[3].sType).toBe('select');
        expect(aRows[4].sType).toBe('text');
    });
});

describe('searchSublist', () => {

    const fnIndex = read('buildSublistIndex');
    const fnSearch = read('searchSublist');
    const aLines = [
        {item: '77', item_display: 'Widget A', custcol_note: 'alpha'},
        {item: '78', item_display: 'Widget B', custcol_note: 'beta'},
        {item: '79', item_display: 'Gadget C'}
    ];
    const oInfo = {aCols: ['item', 'item_display', 'custcol_note'], aEmptyCols: ['quantity', 'custcol_blank']};
    const oMeta = {custcol_note: {sLabel: 'Line Note'}, quantity: {sLabel: 'How Many'}};
    const oIndex = fnIndex(aLines);
    const fnRun = (pTerm, pFilter = 'all', pShowEmpty = false) => {

        return plain(fnSearch(aLines, oInfo, oMeta, pTerm ? oIndex : null, pTerm, pFilter, pShowEmpty));
    };

    test('no term: every line, populated columns, empties only when on', () => {

        expect(fnRun('')).toEqual({aCols: ['item', 'item_display', 'custcol_note'], aLineIndexes: [0, 1, 2]});
        expect(fnRun('', 'all', true).aCols)
            .toEqual(['item', 'item_display', 'custcol_note', 'quantity', 'custcol_blank']);
    });

    test('a value hit keeps only hit lines and hit columns', () => {

        expect(fnRun('widget')).toEqual({aCols: ['item_display'], aLineIndexes: [0, 1]});
        expect(fnRun('GADGET'.toLowerCase())).toEqual({aCols: ['item_display'], aLineIndexes: [2]});
    });

    test('a column id or label hit keeps every line', () => {

        expect(fnRun('display')).toEqual({aCols: ['item_display'], aLineIndexes: [0, 1, 2]});
        expect(fnRun('line note')).toEqual({aCols: ['custcol_note'], aLineIndexes: [0, 1, 2]});
    });

    test('an empty column matching by id or label appears with the checkbox off', () => {

        expect(fnRun('how many')).toEqual({aCols: ['quantity'], aLineIndexes: [0, 1, 2]});
        expect(fnRun('custcol_bl')).toEqual({aCols: ['custcol_blank'], aLineIndexes: [0, 1, 2]});
    });

    test('with a term the checkbox changes nothing', () => {

        expect(fnRun('widget', 'all', true)).toEqual(fnRun('widget', 'all', false));
    });

    test('the field filter narrows columns and which values count', () => {

        expect(fnRun('', 'custom').aCols).toEqual(['custcol_note']);
        expect(fnRun('widget', 'custom')).toEqual({aCols: [], aLineIndexes: []});
        expect(fnRun('alpha', 'standard')).toEqual({aCols: [], aLineIndexes: []});
        expect(fnRun('alpha', 'custom')).toEqual({aCols: ['custcol_note'], aLineIndexes: [0]});
    });

    test('a term cannot match across two values', () => {

        expect(fnRun('77widget')).toEqual({aCols: [], aLineIndexes: []});
    });

    test('no match at all', () => {

        expect(fnRun('zzz')).toEqual({aCols: [], aLineIndexes: []});
    });

    test('no lines: only empties can show', () => {

        const oNoLines = {aCols: [], aEmptyCols: ['id', 'linktype']};
        const fnNone = (pTerm, pShowEmpty) => plain(fnSearch([], oNoLines, {}, fnIndex([]), pTerm, 'all', pShowEmpty));

        expect(fnNone('', false)).toEqual({aCols: [], aLineIndexes: []});
        expect(fnNone('', true)).toEqual({aCols: ['id', 'linktype'], aLineIndexes: []});
        expect(fnNone('linktype', false)).toEqual({aCols: ['linktype'], aLineIndexes: []});
    });
});

describe('deepFilterObject', () => {

    const fnFilter = read('deepFilterObject');

    test('keeps matching keys and values, drops the rest, recurses', () => {

        const oInput = {a: 'Alpha', b: 'other', keep: 'x', nested: {c: 'alpha2', d: 'no'}, gone: {e: 'no'}, list: [{f: 'ALPHA'}]};

        expect(plain(fnFilter(oInput, 'ALPHA'))).toEqual({a: 'Alpha', nested: {c: 'alpha2'}, list: [{f: 'ALPHA'}]});
    });
});

describe('CSV safety', () => {

    const fnCell = read('toCsvCell');
    const fnCsv = read('buildCsv');

    test('starts with a BOM, a single U+FEFF', () => {

        const sCsv = fnCsv([['a']]);

        expect(sCsv.charCodeAt(0)).toBe(0xFEFF);
        expect(sCsv.charCodeAt(1)).not.toBe(0xFEFF);
        expect(Array.from(new TextEncoder().encode(sCsv)).slice(0, 3)).toEqual([0xEF, 0xBB, 0xBF]);
    });

    test('guards formula leaders, half and full width', () => {

        expect(fnCell('=SUM(A1)')).toBe('"\'=SUM(A1)"');

        ['+1', '-1', '@x', '\tx', '\rx', '\nx', '＝1', '＋1', '－1', '＠x'].forEach((pValue) => {

            expect(fnCell(pValue)).toBe(`"'${pValue}"`);
        });
    });

    test('quotes doubled, commas and newlines stay inside, null is empty', () => {

        expect(fnCell('a"b')).toBe('"a""b"');
        expect(fnCell('a,b\nc')).toBe('"a,b\nc"');
        expect(fnCell('plain')).toBe('"plain"');
        expect(fnCell(null)).toBe('""');
        expect(fnCell(undefined)).toBe('""');
    });

    test('row and header order preserved', () => {

        expect(fnCsv([['h1', 'h2'], ['a', 'b']]).slice(1)).toBe('"h1","h2"\n"a","b"');
    });
});

describe('buildDocLinks', () => {

    const fnLinks = read('buildDocLinks');
    const sOrigin = 'https://1234567.app.netsuite.com';

    test('both use the tab origin and the verified browser version', () => {

        expect(plain(fnLinks(sOrigin, 'salesorder'))).toEqual({
            sBrowser: `${sOrigin}/help/helpcenter/en_US/srbrowser/Browser2026_1/script/record/salesorder.html`,
            sCatalog: `${sOrigin}/app/recordscatalog/rcbrowser.nl?whence=#/record_ss/salesorder`
        });
    });

    test('custom types have no Records Browser link', () => {

        expect(fnLinks(sOrigin, 'customrecord_x').sBrowser).toBe('');
        expect(fnLinks(sOrigin, 'customtransaction_x').sBrowser).toBe('');
        expect(fnLinks(sOrigin, 'customrecord_x').sCatalog).toContain('record_ss/customrecord_x');
    });

    test('customer and customform-like types keep it', () => {

        expect(fnLinks(sOrigin, 'customer').sBrowser).toContain('customer.html');
    });
});

describe('compare', () => {

    const fnDiff = read('diffRecords');
    const fnFilter = read('filterDiffRows');
    const oPinned = {
        oBodyFields: {memo: 'Old', keep: 'same', removed: 'x', blank: '', nsapiCT: '1', _perm: '4', custbody_c: 'c1'},
        oSublists: {
            item: [{item: '1', qty: '1', nsapiLC: 'a'}, {item: '2', qty: '5'}],
            expense: [{account: '10', custcol_exp: 'travel', _hidden: 'x'}],
            links: []
        },
        oFieldLabels: {body: {memo: 'Pinned Memo', removed: 'Pinned Removed'}, sublists: {item: {qty: 'Quantity'}}}
    };
    const oCurrent = {
        oBodyFields: {memo: 'New', keep: 'same', added: 'y', nsapiCT: '2', _perm: '5', custbody_c: 'c2'},
        oSublists: {
            item: [{item: '1', qty: '2', nsapiLC: 'b'}, {item: '2', qty: '5'}, {item: '3', qty: '9', custcol_t: 't'}],
            expense: []
        },
        oFieldLabels: {body: {memo: 'Current Memo', added: 'Current Added'}, sublists: {}}
    };
    const oDiff = plain(fnDiff(oPinned, oCurrent));

    test('body rows classify added, removed and changed; internals and equal empties stay out', () => {

        const oByCol = Object.fromEntries(oDiff.aBody.map((pRow) => [pRow.sCol, pRow]));

        expect(Object.keys(oByCol).sort()).toEqual(['added', 'custbody_c', 'memo', 'removed']);
        expect(oByCol.memo).toEqual({sCol: 'memo', sPinned: 'Old', sCurrent: 'New', sKind: 'changed'});
        expect(oByCol.added.sKind).toBe('added');
        expect(oByCol.added.sPinned).toBe('');
        expect(oByCol.removed.sKind).toBe('removed');
        expect(oByCol.removed.sCurrent).toBe('');
    });

    test('labels merge, current over pinned', () => {

        expect(oDiff.oBodyLabels).toEqual({
            memo: 'Current Memo',
            removed: 'Pinned Removed',
            added: 'Current Added'
        });
    });

    test('lines align by position, and cells carry their line number', () => {

        const oItem = oDiff.aSublists.find((pSublist) => pSublist.sName === 'item');
        const oCell = oItem.aRows[0];

        expect(oCell).toEqual({sCol: 'qty', sPinned: '1', sCurrent: '2', sKind: 'changed', nLine: 1});
        expect(oItem.aRows.filter((pRow) => pRow.nLine === 2)).toEqual([]);
    });

    test('a line on one side is one row counting its fields', () => {

        const oItem = oDiff.aSublists.find((pSublist) => pSublist.sName === 'item');
        const oExpense = oDiff.aSublists.find((pSublist) => pSublist.sName === 'expense');
        const oAdded = oItem.aRows[1];
        const oRemoved = oExpense.aRows[0];

        expect(oAdded.sCol).toBe('(line added)');
        expect(oAdded.nLine).toBe(3);
        expect(oAdded.sPinned).toBe('');
        expect(oAdded.sCurrent).toBe('3 fields');
        expect(oAdded.sKind).toBe('added');

        expect(oRemoved.sCol).toBe('(line removed)');
        expect(oRemoved.sPinned).toBe('2 fields');
        expect(oRemoved.sCurrent).toBe('');
        expect(oRemoved.sKind).toBe('removed');
    });

    test('a sublist without differences is absent, and the total counts every row', () => {

        expect(oDiff.aSublists.map((pSublist) => pSublist.sName)).toEqual(['item', 'expense']);
        expect(oDiff.nTotal).toBe(4 + 2 + 1);
    });

    test('identical snapshots have no differences', () => {

        const oSame = plain(fnDiff(oCurrent, oCurrent));

        expect(oSame.nTotal).toBe(0);
        expect(oSame.aSublists).toEqual([]);
    });

    test('cell rows narrow by column filter and by id, label or either value', () => {

        const fnCols = (pRows, pLabels, pTerm, pFilter) => plain(fnFilter(pRows, pLabels, pTerm, pFilter))
            .map((pRow) => pRow.sCol).sort();

        expect(fnCols(oDiff.aBody, oDiff.oBodyLabels, '', 'custom')).toEqual(['custbody_c']);
        expect(fnCols(oDiff.aBody, oDiff.oBodyLabels, '', 'standard')).toEqual(['added', 'memo', 'removed']);
        expect(fnCols(oDiff.aBody, oDiff.oBodyLabels, 'old', 'all')).toEqual(['memo']);
        expect(fnCols(oDiff.aBody, oDiff.oBodyLabels, 'new', 'all')).toEqual(['memo']);
        expect(fnCols(oDiff.aBody, oDiff.oBodyLabels, 'current added', 'all')).toEqual(['added']);
        expect(fnCols(oDiff.aBody, oDiff.oBodyLabels, 'custbody', 'all')).toEqual(['custbody_c']);
        expect(fnCols(oDiff.aBody, oDiff.oBodyLabels, 'memo', 'custom')).toEqual([]);
    });

    test('a whole-line row stays when any column on that line passes both', () => {

        const oItem = oDiff.aSublists.find((pSublist) => pSublist.sName === 'item');
        const aAdded = [oItem.aRows[1]];

        expect(plain(fnFilter(aAdded, oItem.oLabels, '', 'custom')).length).toBe(1);
        expect(plain(fnFilter(aAdded, oItem.oLabels, 't', 'custom')).length).toBe(1);
        expect(plain(fnFilter(aAdded, oItem.oLabels, 'qty', 'custom')).length).toBe(0);
        expect(plain(fnFilter(aAdded, oItem.oLabels, 'quantity', 'standard')).length).toBe(1);
        expect(plain(fnFilter(aAdded, oItem.oLabels, 'zzz', 'all')).length).toBe(0);
    });
});

describe('nav rules', () => {

    const fnResolve = read('resolveNavRuleKey');
    const fnIndex = read('collectNavTreeIndex');
    const fnInTree = read('isNavRuleInTree');
    const fnOwn = read('navItemMatchesOwn');
    const fnAny = read('navItemHasMatch');

    test('resolves by id, then label, then stored label', () => {

        const oRules = new Map([
            ['X', {id: 'X', label: 'Old Label'}],
            ['Plain', {id: '', label: 'Plain'}],
            ['dead-automation-id', {id: 'dead-automation-id', label: 'Recent Records'}]
        ]);

        expect(fnResolve(oRules, {id: 'X', label: 'Plain'})).toBe('X');
        expect(fnResolve(oRules, {id: '', label: 'Plain'})).toBe('Plain');
        expect(fnResolve(oRules, {id: '', label: 'Recent Records'})).toBe('dead-automation-id');
        expect(fnResolve(oRules, {id: 'other', label: 'Recent Records'})).toBe('dead-automation-id');
        expect(fnResolve(oRules, {id: '', label: 'Nothing'})).toBe('');
        expect(fnResolve(oRules, {id: '', label: ''})).toBe('');
    });

    test('a rule is in the tree when any item resolves to it, nested included', () => {

        const oIndex = fnIndex([{id: '', label: 'Top', children: [{id: 'deep-id', label: 'Deep', children: []}]}]);

        expect(fnInTree('Top', {id: '', label: 'Top'}, oIndex)).toBe(true);
        expect(fnInTree('deep-id', {id: 'deep-id', label: ''}, oIndex)).toBe(true);
        expect(fnInTree('dead', {id: 'dead', label: 'Deep'}, oIndex)).toBe(true);
        expect(fnInTree('dead', {id: 'dead', label: 'Gone'}, oIndex)).toBe(false);
        expect(fnInTree('dead', {id: 'dead', label: ''}, oIndex)).toBe(false);
    });

    test('own match versus a match anywhere below', () => {

        const oItem = {id: 'p-id', label: 'Parent', children: [{id: '', label: 'Child', children: [{id: '', label: 'Grand'}]}]};

        expect(fnOwn(oItem, 'parent')).toBe(true);
        expect(fnOwn(oItem, 'p-id')).toBe(true);
        expect(fnOwn(oItem, 'grand')).toBe(false);
        expect(fnAny(oItem, 'grand')).toBe(true);
        expect(fnAny(oItem, 'zzz')).toBe(false);
    });
});

describe('generated reference', () => {

    const oReference = JSON.parse(readFileSync(new URL('../data/records-reference.json', import.meta.url), 'utf8'));

    test('placeholder keys are out', () => {

        expect(Object.keys(oReference).filter((pKey) => pKey.startsWith('<'))).toEqual([]);
    });

    test('carries the fields and shapes the popup reads', () => {

        expect(oReference.invoice.f.entity).toEqual(['Customer', 'select', 1]);
        expect(oReference.invoice.f.trandate[0]).toBe('Date');
        expect(oReference.invoice.f.billaddress.slice(0, 2)).toEqual(['Bill To', 'address']);
        expect(oReference.salesorder.s.item.item).toEqual(['Item', 'select']);
    });

    test('patchy on purpose: no entry beats an empty one', () => {

        expect(oReference.task).toBeUndefined();
        expect(oReference.inventoryitem).toBeUndefined();
        expect(oReference.invoice.s).toBeUndefined();
    });
});
