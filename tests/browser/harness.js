/**
 * Popup harness. Renders the real popup.html, css/main.css and js/*.js in a normal page against a
 * fake `chrome` API, scripted NetSuite responses and fixture DOM, then asserts on the DOM.
 *
 * Query params: ?scenario=<name>, or ?scenario=__list__ to enumerate them.
 * Results: window.__HARNESS__ = {done, scenario, passed, failed, results: [{name, pass, detail}], info}
 * tests/browser/run.js drives this headless. All data is synthetic.
 */

(() => {

    const oParams = new URLSearchParams(window.location.search);
    const sScenario = oParams.get('scenario') || '__list__';
    const oHarness = {done: false, scenario: sScenario, passed: 0, failed: 0, results: [], info: {}, scenarios: []};

    window.__HARNESS__ = oHarness;

    const ORIGIN = 'https://1234567.app.netsuite.com';
    const RECORD_URL = `${ORIGIN}/app/accounting/transactions/custinvc.nl?id=1001&whence=`;
    const SALES_ORDER_URL = `${ORIGIN}/app/accounting/transactions/salesord.nl?id=2002&e=T`;
    const CREATE_URL = `${ORIGIN}/app/accounting/transactions/custinvc.nl?whence=`;
    const SESSION_MESSAGE = 'Could not reach NetSuite. Your session may have expired - log in and reopen.';
    const NO_RECORD_START = 'No record detected on this page';
    const FETCH_TIMEOUT_MS = 60000;

    const fnNativeFetch = window.fetch.bind(window);
    const fnNativeCreateObjectUrl = URL.createObjectURL.bind(URL);
    const aPageErrors = [];
    const aCspViolations = [];
    const oLog = {
        executed: [],
        recordFetches: [],
        referenceFetches: 0,
        bodyReads: 0,
        clipboard: [],
        downloads: [],
        storageWrites: {local: [], sync: [], session: []}
    };

    /* What the fake world does, set per boot and readable by the fakes */
    const oWorld = {
        tabUrl: RECORD_URL,
        respond: null,
        timeoutOverride: 0,
        pageMetaFails: false,
        reference: 'fixture',
        hostGranted: true,
        clipboardFails: false,
        registerFails: false,
        systemDark: false,
        queryListeners: []
    };

    const oFixtureCache = {};

    window.addEventListener('error', (pEvent) => aPageErrors.push(pEvent.message));
    window.addEventListener('unhandledrejection', (pEvent) => aPageErrors.push(String(pEvent.reason)));
    document.addEventListener('securitypolicyviolation', (pEvent) => {

        aCspViolations.push(`${pEvent.effectiveDirective}: ${pEvent.sample || pEvent.blockedURI}`);
    }, true);

    /* ──────────── Assertions ──────────── */

    const check = (pName, pPass, pDetail) => {

        oHarness.results.push({name: pName, pass: !!pPass, detail: pPass ? '' : (pDetail || '')});

        if (pPass) {
            oHarness.passed++;
        } else {
            oHarness.failed++;
        }
    };

    const checkEqual = (pName, pActual, pExpected) => {

        const sActual = JSON.stringify(pActual);
        const sExpected = JSON.stringify(pExpected);

        check(pName, sActual === sExpected, `expected ${sExpected}, got ${sActual}`);
    };

    const delay = (pMs) => new Promise((pResolve) => setTimeout(pResolve, pMs));

    const waitFor = async (pCondition, pTimeoutMs, pLabel) => {

        const nStart = performance.now();

        while (!pCondition()) {

            if (performance.now() - nStart > pTimeoutMs) throw new Error(`Timed out waiting for ${pLabel}`);

            await delay(10);
        }
    };

    /* ──────────── DOM Readers ──────────── */

    const qs = (pSelector) => document.querySelector(pSelector);
    const qsa = (pSelector) => Array.from(document.querySelectorAll(pSelector));

    /* A row's field id: the copy span, without the label line under it */
    const idOf = (pRow) => pRow.querySelector('.col-id .clickable')?.textContent || '';
    const bodyRows = () => qsa('#bodyFieldsTable tr').filter((pRow) => pRow.querySelector('.col-id'));
    const bodyIds = () => bodyRows().map(idOf);
    const bodyRow = (pId) => bodyRows().find((pRow) => idOf(pRow) === pId) || null;
    const labelOf = (pRow) => pRow?.querySelector('.fe-field-label')?.childNodes[0]?.textContent || '';
    const typeOf = (pRow) => pRow?.querySelector('.type-badge')?.title || '';
    const message = () => qs('#container .empty-msg, #container .error-msg, #legacyTree .empty-msg, #legacyTree .error-msg');
    const sublistHeaders = () => qsa('#sublistTable .sublist-header th').slice(1);
    const sublistCols = () => sublistHeaders().map((pTh) => pTh.querySelector('.clickable').textContent);
    const sublistLineRows = () => qsa('#sublistTable tr').filter((pRow) => pRow.querySelector('.line-num'));
    const lineNumbers = () => sublistLineRows().map((pRow) => pRow.querySelector('.line-num').textContent);
    const headerFor = (pCol) => sublistHeaders().find((pTh) => pTh.querySelector('.clickable').textContent === pCol) || null;
    const optionTexts = () => qsa('#sublistSelect option').map((pOption) => pOption.textContent);
    const tabText = (pId) => qs(`#${pId}`).textContent;
    const rawJson = () => JSON.parse(qs('#rawJsonContainer .raw-json').textContent);

    const openTab = async (pId) => {

        qs(`#${pId}`).click();
        await delay(0);
    };

    const setSearch = (pTerm) => {

        qs('#searchBox').value = pTerm;
        window.fex.applySearch();
    };

    const setFilter = (pValue) => {

        const oSelect = qs('#fieldFilterSelect');

        oSelect.value = pValue;
        oSelect.dispatchEvent(new Event('change'));
    };

    const setViewMode = (pValue) => {

        const oSelect = qs('#viewModeSelect');

        oSelect.value = pValue;
        oSelect.dispatchEvent(new Event('change'));
    };

    const setShowEmpty = (pChecked) => {

        const oToggle = qs('#showEmptyToggle');

        oToggle.checked = pChecked;
        oToggle.dispatchEvent(new Event('change'));
    };

    const selectSublist = (pName) => {

        const oSelect = qs('#sublistSelect');

        oSelect.value = pName;
        oSelect.dispatchEvent(new Event('change'));
    };

    const pressKey = (pElement, pKey) => {

        const oEvent = new KeyboardEvent('keydown', {key: pKey, bubbles: true, cancelable: true});

        pElement.dispatchEvent(oEvent);

        return oEvent;
    };

    const lastDownload = async () => {

        const oDownload = oLog.downloads[oLog.downloads.length - 1];

        /* Blob.text() strips a BOM, and the BOM is part of what is under test */
        const sText = new TextDecoder('utf-8', {ignoreBOM: true}).decode(await oDownload.oBlob.arrayBuffer());

        return {sName: oDownload.sName, sText: sText};
    };

    /* ──────────── Fixtures ──────────── */

    const fixture = async (pName) => {

        if (oFixtureCache[pName] === undefined) {

            const oResponse = await fnNativeFetch(`tests/browser/fixtures/${pName}`);

            if (!oResponse.ok) throw new Error(`fixture ${pName}: HTTP ${oResponse.status}`);

            oFixtureCache[pName] = await oResponse.text();
        }

        return oFixtureCache[pName];
    };

    const fixtureResponse = (pBody, pInit = {}) => {

        const oResponse = new Response(pBody, {
            status: pInit.nStatus || 200,
            headers: {'content-type': pInit.sContentType || 'text/xml; charset=UTF-8'}
        });
        const fnText = oResponse.text.bind(oResponse);

        oResponse.text = () => {

            oLog.bodyReads++;
            return fnText();
        };

        if (pInit.sFinalUrl) Object.defineProperty(oResponse, 'url', {value: pInit.sFinalUrl});

        return oResponse;
    };

    /* Stands in for the rendered NetSuite page: the injected functions read this document */
    const mountPageDom = async (pName) => {

        qs('#ns-page')?.remove();

        const oHost = document.createElement('div');

        oHost.id = 'ns-page';
        oHost.style.display = 'none';

        if (pName) {

            const oParsed = new DOMParser().parseFromString(await fixture(pName), 'text/html');

            Array.from(oParsed.body.childNodes).forEach((pNode) => oHost.appendChild(document.importNode(pNode, true)));
        }

        document.documentElement.appendChild(oHost);
    };

    /* ──────────── Fake Chrome ──────────── */

    const createArea = (pName) => {

        const oArea = {
            data: {},
            failSet: null,
            failGet: null,
            failSetKeys: null,
            get: async (pKeys) => {

                if (oArea.failGet) throw oArea.failGet;
                if (pKeys === null || pKeys === undefined) return {...oArea.data};

                const oResult = {};

                [].concat(pKeys).forEach((pKey) => {

                    if (oArea.data[pKey] !== undefined) oResult[pKey] = oArea.data[pKey];
                });

                return structuredClone(oResult);
            },
            set: async (pValues) => {

                oLog.storageWrites[pName].push(pValues);

                if (oArea.failSet) throw oArea.failSet;
                if (oArea.failSetKeys && Object.keys(pValues).some((pKey) => oArea.failSetKeys.test(pKey))) {
                    throw new Error('write rejected');
                }

                Object.assign(oArea.data, structuredClone(pValues));
            },
            remove: async (pKeys) => {

                if (oArea.failSet) throw oArea.failSet;

                [].concat(pKeys).forEach((pKey) => delete oArea.data[pKey]);
            }
        };

        return oArea;
    };

    const oStorage = {local: createArea('local'), sync: createArea('sync'), session: createArea('session')};
    const oRegistry = new Map();
    let oManifest = {};

    const installFakes = () => {

        window.chrome = {
            runtime: {
                getManifest: () => oManifest,
                getURL: (pPath) => new URL(pPath, document.baseURI).href
            },
            tabs: {
                query: async () => [{id: 7, url: oWorld.tabUrl}]
            },
            storage: {
                local: oStorage.local,
                sync: oStorage.sync,
                session: oStorage.session,
                onChanged: {addListener: () => {}}
            },
            permissions: {
                contains: async () => oWorld.hostGranted,
                request: async () => {

                    oWorld.hostGranted = true;
                    return true;
                }
            },
            scripting: {
                executeScript: async (pDetails) => {

                    oLog.executed.push({sName: pDetails.func.name, aArgs: pDetails.args || []});

                    if (pDetails.func.name === 'fexReadPageMetadata' && oWorld.pageMetaFails) {
                        throw new Error('Cannot access contents of the page');
                    }

                    const aArgs = (pDetails.args || []).slice();

                    if (pDetails.func.name === 'fexFetchRecordXml' && oWorld.timeoutOverride) {
                        aArgs[1] = oWorld.timeoutOverride;
                    }

                    /* The structured clone is what the real API does to a result */
                    return [{result: structuredClone(await pDetails.func(...aArgs))}];
                },
                getRegisteredContentScripts: async (pFilter) => {

                    return Array.from(oRegistry.values()).filter((pEntry) => pFilter.ids.includes(pEntry.id));
                },
                registerContentScripts: async (pEntries) => {

                    if (oWorld.registerFails) throw new Error('registration refused');

                    pEntries.forEach((pEntry) => oRegistry.set(pEntry.id, {...pEntry}));
                },
                updateContentScripts: async (pEntries) => {

                    pEntries.forEach((pEntry) => oRegistry.set(pEntry.id, {...pEntry}));
                },
                unregisterContentScripts: async (pFilter) => {

                    pFilter.ids.forEach((pId) => oRegistry.delete(pId));
                }
            }
        };

        window.fetch = async (pInput, pInit) => {

            const sUrl = String(pInput?.url || pInput);

            if (sUrl.includes('netsuite.com')) {

                oLog.recordFetches.push({sUrl: sUrl, oInit: pInit});

                return oWorld.respond(sUrl, pInit);
            }

            if (sUrl.includes('data/records-reference.json')) {

                oLog.referenceFetches++;

                if (oWorld.reference === 'reject') throw new TypeError('reference unavailable');
                if (oWorld.reference === '404') return new Response('nope', {status: 404});
                if (oWorld.reference === 'corrupt') return new Response('{not json', {status: 200});
                if (oWorld.reference === 'fixture') return new Response(await fixture('reference.json'));

                return fnNativeFetch(sUrl);
            }

            return fnNativeFetch(pInput, pInit);
        };

        window.matchMedia = () => {

            const oQuery = {
                get matches() {

                    return oWorld.systemDark;
                },
                addEventListener: (pType, pListener) => oWorld.queryListeners.push(pListener)
            };

            return oQuery;
        };

        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText: async (pText) => {

                    if (oWorld.clipboardFails) throw new Error('clipboard denied');

                    oLog.clipboard.push(pText);
                }
            }
        });

        URL.createObjectURL = (pBlob) => {

            oLog.lastBlob = pBlob;

            return fnNativeCreateObjectUrl(pBlob);
        };

        const fnNativeClick = HTMLAnchorElement.prototype.click;

        HTMLAnchorElement.prototype.click = function clickWithoutNavigating() {

            if (this.download) {
                oLog.downloads.push({sName: this.download, oBlob: oLog.lastBlob});
                return;
            }

            fnNativeClick.call(this);
        };
    };

    const flipSystemTheme = (pDark) => {

        oWorld.systemDark = pDark;
        oWorld.queryListeners.forEach((pListener) => pListener());
    };

    /* ──────────── Popup Lifecycle ──────────── */

    let sPopupHtml = '';
    let oPopupDoc = null;
    let bScriptsLoaded = false;

    const loadScript = (pSrc) => new Promise((pResolve, pReject) => {

        const oScript = document.createElement('script');

        oScript.src = pSrc;
        oScript.onload = pResolve;
        oScript.onerror = () => pReject(new Error(`${pSrc} failed to load`));
        document.head.appendChild(oScript);
    });

    const mountPopupBody = () => {

        document.body.replaceChildren();

        Array.from(oPopupDoc.body.childNodes).forEach((pNode) => {

            if (pNode.nodeName === 'SCRIPT') return;

            document.body.appendChild(document.importNode(pNode, true));
        });
    };

    const isSettled = () => !!qs('#recordInfo .info-value') || !!message() || !!qs('#container .error-msg');

    const prepare = async () => {

        if (sPopupHtml) return;

        sPopupHtml = await (await fnNativeFetch('popup.html')).text();
        oManifest = await (await fnNativeFetch('manifest.json')).json();
        oPopupDoc = new DOMParser().parseFromString(sPopupHtml, 'text/html');

        installFakes();

        Array.from(oPopupDoc.head.querySelectorAll('link[rel="stylesheet"]')).forEach((pLink) => {

            document.head.appendChild(document.importNode(pLink, true));
        });

        await Promise.all(qsa('link[rel="stylesheet"]').map((pLink) => new Promise((pResolve) => {

            if (pLink.sheet) {
                pResolve();
                return;
            }

            pLink.addEventListener('load', pResolve, {once: true});
            pLink.addEventListener('error', pResolve, {once: true});
        })));
    };

    /**
     * Starts or restarts the popup: fresh popup.html body, same fake storage, like closing and
     * reopening it. Options are merged into the fake world.
     */
    const boot = async (pOptions = {}) => {

        await prepare();

        const {sPageDom, bWait = true, ...oOverrides} = pOptions;

        Object.assign(oWorld, oOverrides);

        await mountPageDom(sPageDom === undefined ? null : sPageDom);
        mountPopupBody();

        if (!bScriptsLoaded) {

            /* The order popup.html itself declares, boot.js from <head> first */
            const aHead = Array.from(oPopupDoc.head.querySelectorAll('script[src]')).map((pScript) => pScript.getAttribute('src'));
            const aBody = Array.from(oPopupDoc.body.querySelectorAll('script[src]')).map((pScript) => pScript.getAttribute('src'));

            for (const sSrc of [...aHead, ...aBody]) {
                await loadScript(sSrc);
            }

            bScriptsLoaded = true;
        }

        oWorld.queryListeners = [];
        document.dispatchEvent(new Event('DOMContentLoaded'));

        if (!bWait) return;

        await waitFor(isSettled, 15000, 'popup to settle');
        await delay(10);
    };

    const xmlResponder = (pFixture, pInit) => async () => fixtureResponse(await fixture(pFixture), pInit);

    /* ──────────── Scenarios ──────────── */

    const SCENARIOS = {};

    /* ──── Footer and sponsor ──── */

    SCENARIOS['footer-on-any-page'] = async () => {

        await boot({tabUrl: 'https://www.example.com/'});

        checkEqual('non-NetSuite message', message().textContent, 'Not on a NetSuite page.');
        checkEqual('footer shows the manifest version', qs('#footerVersion').textContent, `Field Explorer EX v${oManifest.version}`);
        check('popup.html footer text has no version of its own', !/\d+\.\d+/.test(oPopupDoc.querySelector('#footerVersion').textContent));

        const oLink = qs('#footerBrandLink');

        checkEqual('brand link target', oLink.getAttribute('href'), 'https://www.alientechnologyllc.com');
        checkEqual('brand link opens a new tab', oLink.target, '_blank');
        checkEqual('brand link rel', oLink.rel, 'noopener noreferrer');
        checkEqual('brand text', oLink.textContent.trim(), 'by Alien Technology LLC');
        checkEqual('brand link not underlined at rest', getComputedStyle(oLink).textDecorationLine, 'none');

        const sMutedLight = getComputedStyle(qs('.fe-footer-text')).color;

        checkEqual('brand link muted in light', getComputedStyle(oLink).color, sMutedLight);

        document.documentElement.classList.add('theme-dark');

        /* Links animate their color */
        await delay(250);

        checkEqual('brand link muted in dark', getComputedStyle(oLink).color, getComputedStyle(qs('.fe-footer-text')).color);
        document.documentElement.classList.remove('theme-dark');

        check('no sponsor text in the DOM', !/sponsor/i.test(document.body.textContent));
        check('no sponsor markup', !qs('.fe-footer-sponsor, .fe-sponsor-text, .fe-sponsor-img, img[src*="spon"], a[href*="utm_"]'));

        const aFooterRows = qsa('.fe-footer .fe-footer-row');

        checkEqual('footer is the links row and the brand row', aFooterRows.length, 2);
        check('footer brand image loads', qs('.fe-footer-logo').getAttribute('src') === 'img/alien-tech.svg');
    };

    SCENARIOS['footer-before-storage-failure'] = async () => {

        oStorage.local.failGet = new Error('storage broken');

        await boot({tabUrl: RECORD_URL, respond: xmlResponder('invoice.xml')});

        check('startup error painted', qs('#container .error-msg').textContent.startsWith('Field Explorer failed to start'));
        checkEqual('version still shown', qs('#footerVersion').textContent, `Field Explorer EX v${oManifest.version}`);

        oStorage.local.failGet = null;
    };

    SCENARIOS['layout-hotfix-1'] = async () => {

        await boot({respond: xmlResponder('invoice.xml')});

        const oHtml = document.documentElement;

        oHtml.style.setProperty('--fe-width', '470px');
        oHtml.style.setProperty('--fe-height', '400px');

        checkEqual('html width tracks --fe-width', getComputedStyle(oHtml).width, '470px');
        checkEqual('html height tracks --fe-height', getComputedStyle(oHtml).height, '400px');
        checkEqual('body fills html', document.body.offsetWidth, 470);
        check('html background is the theme background', getComputedStyle(oHtml).backgroundColor === getComputedStyle(document.body).backgroundColor);
        checkEqual('copy bar keeps intrinsic button height', getComputedStyle(qs('.fe-copy-bar')).alignItems, 'flex-start');
    };

    /* ──── 2.1 / 2.2 Sensitive names and record attributes ──── */

    SCENARIOS['sensitive-names'] = async () => {

        await boot({respond: xmlResponder('invoice.xml')});

        const fnNoSecret = (pText) => !/SYNTHETIC-CSRF|SYNTHETIC-EML|_csrf|_eml_nkey_/.test(pText);

        check('body table clean', fnNoSecret(qs('#bodyFieldsTable').textContent));
        check('count excludes them', qs('#fieldCount').textContent.startsWith('17 fields'), qs('#fieldCount').textContent);
        check('_fields is not a row', !bodyRow('_fields'));
        check('_perm stays', !!bodyRow('_perm'));

        await openTab('tabBtnSublists');
        selectSublist('item');

        check('a sublist line cannot show them', !sublistCols().includes('_csrf') && !sublistCols().includes('_eml_nkey_'));
        check('sublist table clean', fnNoSecret(qs('#sublistTable').textContent));

        qs('#exportSublistCsvBtn').click();
        check('sublist CSV clean', fnNoSecret((await lastDownload()).sText));

        setSearch('ON-A-LINE');
        checkEqual('search cannot find a line value', [tabText('tabBtnSublists'), sublistCols()], ['Sublists (0)', []]);
        setSearch('');

        await openTab('tabBtnBody');

        setSearch('csrf');
        checkEqual('search cannot find _csrf', bodyIds(), []);
        setSearch('SYNTHETIC-CSRF');
        checkEqual('search cannot find its value', bodyIds(), []);
        setSearch('');

        await openTab('tabBtnRaw');

        const sRaw = qs('#rawJsonContainer .raw-json').textContent;

        check('Raw JSON clean', fnNoSecret(sRaw));
        check('Raw JSON has no _fields', !sRaw.includes('"_fields"'));
        check('Raw JSON lines are clean too', !('_csrf' in rawJson().oSublists.item[0]) && !('_eml_nkey_' in rawJson().oSublists.item[0]));

        qs('#copyRawJsonBtn').click();
        await delay(10);
        check('Raw copy clean', fnNoSecret(oLog.clipboard[oLog.clipboard.length - 1]));

        qs('#exportJsonBtn').click();
        check('JSON export clean', fnNoSecret((await lastDownload()).sText));

        qs('#exportCsvBtn').click();
        check('CSV export clean', fnNoSecret((await lastDownload()).sText));

        setViewMode('legacy');
        await delay(0);
        check('Legacy tree clean', fnNoSecret(qs('#legacyTree').textContent));
        qs('#copyLegacyJsonBtn').click();
        await delay(10);
        check('Legacy copy clean', fnNoSecret(oLog.clipboard[oLog.clipboard.length - 1]));

        setViewMode('new');
    };

    /* ──── 2.3 Page gate ──── */

    SCENARIOS['gate-non-record-pages'] = async () => {

        const aPaths = [
            '/app/site/hosting/scriptlet.nl?script=1&deploy=1&id=5',
            '/app/center/card.nl?sc=-29',
            '/app/login/secure/enterpriselogin.nl',
            '/app/reporting/reportrunner.nl?cr=1&id=2',
            '/app/common/search/searchresults.nl?searchid=1&id=2',
            '/app/accounting/transactions/transactionlist.nl?id=2',
            '/app/common/entity/custjoblist.nl'
        ];

        for (const sPath of aPaths) {

            oLog.executed.length = 0;
            oLog.recordFetches.length = 0;

            await boot({tabUrl: ORIGIN + sPath, respond: xmlResponder('invoice.xml')});

            check(`${sPath} shows the non-error message`, message()?.classList.contains('empty-msg')
                && message().textContent.startsWith(NO_RECORD_START), message()?.textContent);
            checkEqual(`${sPath} is never fetched or read`, [oLog.recordFetches.length, oLog.executed.length], [0, 0]);
        }
    };

    SCENARIOS['gate-record-without-id-param-is-tried'] = async () => {

        await boot({tabUrl: `${ORIGIN}/app/common/custom/custrecordentry.nl?rectype=12`, respond: xmlResponder('custom-record.xml')});

        checkEqual('fetched once', oLog.recordFetches.length, 1);
        check('rendered', !!bodyRow('custrecord_synth_value'));
    };

    SCENARIOS['gate-create-mode'] = async () => {

        await boot({tabUrl: CREATE_URL, respond: xmlResponder('create.xml')});

        check('xml=T was requested', oLog.recordFetches[0].sUrl.includes('xml=T'));
        check('record renders', !!bodyRow('trandate'));
        checkEqual('header shows (new)', qsa('#recordInfo .info-value').map((pValue) => pValue.textContent), ['invoice', '(new)']);

        const oNew = qsa('#recordInfo .info-value')[1];
        const nCopies = oLog.clipboard.length;

        oNew.click();
        pressKey(oNew, 'Enter');
        await delay(10);

        check('(new) is not a copy target', !oNew.classList.contains('clickable') && !oNew.hasAttribute('role') && oNew.tabIndex < 0);
        checkEqual('clicking (new) copies nothing', oLog.clipboard.length, nCopies);
        check('the record type still copies', qsa('#recordInfo .info-value')[0].classList.contains('clickable'));

        qs('#exportJsonBtn').click();
        checkEqual('JSON filename', (await lastDownload()).sName, 'invoice_new.json');

        qs('#exportCsvBtn').click();
        checkEqual('CSV filename', (await lastDownload()).sName, 'invoice_new_fields.csv');
    };

    /* ──── 2.4 Fetch outcomes ──── */

    SCENARIOS['outcome-record'] = async () => {

        await boot({respond: xmlResponder('invoice.xml')});

        const oFetch = oLog.recordFetches[0];
        const oExec = oLog.executed.find((pEntry) => pEntry.sName === 'fexFetchRecordXml');

        check('requests xml=T', new URL(oFetch.sUrl).searchParams.get('xml') === 'T');
        check('keeps the original parameters', new URL(oFetch.sUrl).searchParams.get('id') === '1001');
        checkEqual('sends the session', oFetch.oInit.credentials, 'include');
        check('carries an abort signal', oFetch.oInit.signal instanceof AbortSignal);
        checkEqual('deadline handed to the injected fetch', oExec.aArgs[1], FETCH_TIMEOUT_MS);
        checkEqual('body read once', oLog.bodyReads, 1);
        check('no message', !message());
        check('rows rendered', bodyRows().length > 0);
        checkEqual('record info', qsa('#recordInfo .info-value').map((pValue) => pValue.textContent), ['invoice', '1001']);
    };

    SCENARIOS['outcome-netsuite-error'] = async () => {

        await boot({respond: xmlResponder('error.xml', {nStatus: 500})});

        checkEqual('detail and code', message().textContent, 'That record does not exist. (RCRD_DSNT_EXIST)');
        check('error style', message().classList.contains('error-msg'));
        check('tab bar hidden', qs('#tabBar').style.display === 'none');
    };

    SCENARIOS['outcome-http-error'] = async () => {

        await boot({respond: async () => fixtureResponse('<html/>', {nStatus: 503, sContentType: 'text/html'})});

        checkEqual('status in the message', message().textContent, 'Failed to fetch record: HTTP 503');
        check('error style', message().classList.contains('error-msg'));
        checkEqual('HTML body not read', oLog.bodyReads, 0);

        await boot({respond: async () => fixtureResponse('<nsResponse/>', {nStatus: 500})});

        checkEqual('XML without onlineError is the same outcome', message().textContent, 'Failed to fetch record: HTTP 500');
    };

    SCENARIOS['outcome-not-record'] = async () => {

        await boot({respond: async () => fixtureResponse(await fixture('dashboard.html'), {sContentType: 'text/html;charset=UTF-8'})});

        check('non-error message', message().classList.contains('empty-msg') && message().textContent.startsWith(NO_RECORD_START));
        checkEqual('HTML body not read', oLog.bodyReads, 0);
    };

    SCENARIOS['outcome-session-login'] = async () => {

        await boot({
            respond: async () => fixtureResponse('<html/>', {
                sContentType: 'text/html',
                sFinalUrl: `${ORIGIN}/app/login/secure/enterpriselogin.nl?redirect=x`
            })
        });

        checkEqual('session message', message().textContent, SESSION_MESSAGE);
        check('error style', message().classList.contains('error-msg'));
    };

    SCENARIOS['outcome-session-typeerror'] = async () => {

        await boot({
            respond: async () => {

                throw new TypeError('Failed to fetch');
            }
        });

        checkEqual('session message', message().textContent, SESSION_MESSAGE);
        check('error style', message().classList.contains('error-msg'));
    };

    SCENARIOS['outcome-timeout'] = async () => {

        await boot({
            timeoutOverride: 40,
            respond: (pUrl, pInit) => new Promise((pResolve, pReject) => {

                pInit.signal.addEventListener('abort', () => pReject(new DOMException('Aborted', 'AbortError')));
            })
        });

        checkEqual('timeout message', message().textContent, 'NetSuite took too long to respond. Try again.');
        check('error style', message().classList.contains('error-msg'));
        checkEqual('production deadline still 60 s', oLog.executed.find((pEntry) => pEntry.sName === 'fexFetchRecordXml').aArgs[1], FETCH_TIMEOUT_MS);
    };

    SCENARIOS['outcome-unparseable'] = async () => {

        await boot({respond: xmlResponder('unparseable.xml')});

        checkEqual('neither element', message().textContent, 'Could not parse record data. Are you on a record page?');
        check('error style', message().classList.contains('error-msg'));

        await boot({respond: async () => fixtureResponse('this is <<< not xml')});

        checkEqual('broken XML', message().textContent, 'Could not parse record data. Are you on a record page?');
    };

    SCENARIOS['outcome-in-legacy-view'] = async () => {

        oStorage.local.data.fex_viewMode = 'legacy';

        await boot({respond: xmlResponder('error.xml', {nStatus: 500})});

        checkEqual('message lands in the legacy container', qs('#legacyTree .error-msg').textContent, 'That record does not exist. (RCRD_DSNT_EXIST)');

        delete oStorage.local.data.fex_viewMode;
    };

    /* ──── 2.5 / 2.6 Classification and types in the DOM ──── */

    SCENARIOS['classification-filter'] = async () => {

        await boot({respond: xmlResponder('invoice.xml')});

        setFilter('custom');
        checkEqual('Custom shows the custom namespaces', bodyIds().sort(), ['cseg_area', 'custbody_region', 'custpage_note']);

        setFilter('standard');
        check('Standard keeps customform', bodyIds().includes('customform'));
        check('Standard drops cseg', !bodyIds().includes('cseg_area'));

        setFilter('all');
    };

    SCENARIOS['type-heuristic'] = async () => {

        await boot({respond: xmlResponder('invoice.xml'), reference: '404'});

        checkEqual('paid is not type id', typeOf(bodyRow('paid')), 'text');
        checkEqual('date heuristic', typeOf(bodyRow('trandate')), 'date');
        checkEqual('currency heuristic', typeOf(bodyRow('amountpaid')), 'currency');
        checkEqual('checkbox heuristic', typeOf(bodyRow('nsapiFC')), 'checkbox');
        checkEqual('badge shows the Aa icon on text', bodyRow('paid').querySelector('.type-badge').textContent, 'Aa');
    };

    /* ──── 2.7 Legacy theme ──── */

    SCENARIOS['legacy-theme'] = async () => {

        oStorage.local.data.fex_viewMode = 'legacy';
        oStorage.local.data.fex_darkMode = 'auto';

        await boot({respond: xmlResponder('invoice.xml'), systemDark: false});
        await delay(0);

        const fnTree = () => qs('#legacyTree .json-formatter-row');
        const fnDark = () => fnTree().classList.contains('json-formatter-dark');

        check('light OS: root and tree light', !document.documentElement.classList.contains('theme-dark') && !fnDark());
        check('light tree on a light background', getComputedStyle(qs('#legacyContainer')).backgroundColor !== 'rgb(0, 0, 0)');

        const oFirstTree = fnTree();

        flipSystemTheme(true);

        check('OS flip in auto: root dark', document.documentElement.classList.contains('theme-dark'));
        check('OS flip in auto: tree dark', fnDark());
        check('tree was rebuilt', fnTree() !== oFirstTree);
        checkEqual('dark tree keeps the black background', getComputedStyle(qs('#legacyContainer')).backgroundColor, 'rgb(0, 0, 0)');

        qs('#darkModeToggle').click();
        check('toggle to light: tree light', !document.documentElement.classList.contains('theme-dark') && !fnDark());

        qs('#darkModeToggle').click();
        check('toggle to dark: tree dark', document.documentElement.classList.contains('theme-dark') && fnDark());

        qs('#darkModeToggle').click();
        check('explicit light', !document.documentElement.classList.contains('theme-dark'));

        const oTree = fnTree();

        flipSystemTheme(false);
        flipSystemTheme(true);

        check('explicit mode ignores the OS', !fnDark() && fnTree() === oTree);

        delete oStorage.local.data.fex_viewMode;
        delete oStorage.local.data.fex_darkMode;
    };

    SCENARIOS['legacy-theme-hidden-tree-not-rebuilt'] = async () => {

        oStorage.local.data.fex_darkMode = 'auto';

        await boot({respond: xmlResponder('invoice.xml'), systemDark: false});

        const oBefore = qs('#legacyTree').firstChild;

        flipSystemTheme(true);

        check('new view: the hidden tree is left alone', qs('#legacyTree').firstChild === oBefore);

        setViewMode('legacy');
        await delay(0);
        check('and picks up the theme when shown', qs('#legacyTree .json-formatter-row').classList.contains('json-formatter-dark'));

        setViewMode('new');
        delete oStorage.local.data.fex_darkMode;
    };

    /* ──── 2.8 Doc links ──── */

    SCENARIOS['doc-links'] = async () => {

        await boot({respond: xmlResponder('invoice.xml')});

        const oBrowser = qs('#recordsBrowserLink');
        const oCatalog = qs('#recordsCatalogLink');

        checkEqual('Records Browser on the tab origin and 2026.1', oBrowser.href, `${ORIGIN}/help/helpcenter/en_US/srbrowser/Browser2026_1/script/record/invoice.html`);
        checkEqual('Records Catalog on the tab origin', oCatalog.href, `${ORIGIN}/app/recordscatalog/rcbrowser.nl?whence=#/record_ss/invoice`);
        check('both visible', oBrowser.style.display !== 'none' && oCatalog.style.display !== 'none');
    };

    SCENARIOS['doc-links-custom-types'] = async () => {

        await boot({
            tabUrl: `${ORIGIN}/app/common/custom/custrecordentry.nl?rectype=12&id=55`,
            respond: xmlResponder('custom-record.xml')
        });

        checkEqual('custom record: no Records Browser', qs('#recordsBrowserLink').style.display, 'none');
        check('custom record: Catalog stays', qs('#recordsCatalogLink').style.display !== 'none');

        await boot({
            tabUrl: `${ORIGIN}/app/accounting/transactions/custom.nl?id=56`,
            respond: xmlResponder('custom-transaction.xml')
        });

        checkEqual('custom transaction: no Records Browser', qs('#recordsBrowserLink').style.display, 'none');
    };

    /* ──── Labels and types (AC9) ──── */

    SCENARIOS['labels-view-mode'] = async () => {

        await boot({respond: xmlResponder('invoice.xml'), sPageDom: 'invoice-view-dom.html'});

        checkEqual('both sources: page label wins', labelOf(bodyRow('memo')), 'Page Memo Label');
        checkEqual('both sources: page type wins', typeOf(bodyRow('memo')), 'textarea');
        checkEqual('reference only: label', labelOf(bodyRow('amountpaid')), 'Amount Paid');
        checkEqual('reference only: type', typeOf(bodyRow('amountpaid')), 'currency');
        checkEqual('neither: no label line', bodyRow('paid').querySelector('.fe-field-label'), null);
        checkEqual('neither: heuristic type', typeOf(bodyRow('paid')), 'text');
        checkEqual('page type without a label', typeOf(bodyRow('custpage_note')), 'inlinehtml');
        check('mandatory from the reference shows', !!bodyRow('entity').querySelector('.fe-mandatory'));
        check('not mandatory shows nothing', !bodyRow('memo').querySelector('.fe-mandatory'));
        checkEqual('mandatory with no label still shows, on its own', bodyRow('nldept').querySelector('.fe-field-label')?.textContent, '*');
        check('as the marker', !!bodyRow('nldept').querySelector('.fe-mandatory'));
        checkEqual('type icon for a page type', bodyRow('memo').querySelector('.type-badge').textContent, '¶');

        bodyRow('memo').querySelector('.col-id .clickable').click();
        await delay(10);
        checkEqual('click still copies the id', oLog.clipboard[oLog.clipboard.length - 1], 'memo');

        await openTab('tabBtnSublists');

        checkEqual('sublist: page tooltip beats the reference', headerFor('item').querySelector('.fe-field-label').textContent, 'Item');
        checkEqual('sublist: reference type in the title', headerFor('item').title, 'select');
        checkEqual('sublist: reference label when the page has none', headerFor('amount').querySelector('.fe-field-label').textContent, 'Amount');
        checkEqual('sublist: page label, reference type', [headerFor('custcol_note').querySelector('.fe-field-label').textContent, headerFor('custcol_note').title], ['Line Note', 'textarea']);
        check('sublist: unknown column has no label', !headerFor('description').querySelector('.fe-field-label'));
        checkEqual('sublist: unknown column has no title', headerFor('description').title, '');
        check('sublist: no type badges', !qs('#sublistTable .type-badge'));

        headerFor('quantity').querySelector('.clickable').click();
        await delay(10);
        checkEqual('sublist header click copies the id', oLog.clipboard[oLog.clipboard.length - 1], 'quantity');
    };

    SCENARIOS['labels-edit-mode'] = async () => {

        await boot({tabUrl: SALES_ORDER_URL, respond: xmlResponder('salesorder-edit.xml'), sPageDom: 'salesorder-edit-dom.html'});

        checkEqual('marker stripped from the label', labelOf(bodyRow('trandate')), 'Date');
        check('mandatory from the page marker', !!bodyRow('trandate').querySelector('.fe-mandatory'));
        check('not marked, reference says no', !bodyRow('memo').querySelector('.fe-mandatory'));

        await openTab('tabBtnSublists');

        checkEqual('column label from <name>_<col>_fs_lbl', headerFor('item').querySelector('.fe-field-label').childNodes[0].textContent, 'Item');
        check('column mandatory marker', !!headerFor('item').querySelector('.fe-mandatory'));
        checkEqual('data-column-type wins', headerFor('quantity').title, 'float');
        checkEqual('reference type when the header has none', headerFor('rate').title, 'rate');
        checkEqual('column without a type has no title', headerFor('item_display').title, '');
        checkEqual('mandatory column with no label still shows, on its own', headerFor('item_display').querySelector('.fe-field-label')?.textContent, '*');
        check('as the marker', !!headerFor('item_display').querySelector('.fe-mandatory'));
        checkEqual('a header with a blank data-label joins to nothing', [headerFor('item_display').title, headerFor('rate').title], ['', 'rate']);
    };

    SCENARIOS['labels-page-read-fails'] = async () => {

        await boot({respond: xmlResponder('invoice.xml'), sPageDom: 'invoice-view-dom.html', pageMetaFails: true});

        check('no error shown', !message());
        check('record renders', bodyRows().length > 0);
        checkEqual('reference label instead', labelOf(bodyRow('memo')), 'Reference Memo');
        checkEqual('reference type instead', typeOf(bodyRow('memo')), 'text');
        checkEqual('page-only label gone', bodyRow('custbody_region').querySelector('.fe-field-label'), null);

        await openTab('tabBtnSublists');
        checkEqual('sublists use the reference', headerFor('item').querySelector('.fe-field-label').textContent, 'Reference Item');

        oWorld.pageMetaFails = false;
    };

    SCENARIOS['labels-reference-fails'] = async () => {

        for (const sFailure of ['reject', '404', 'corrupt']) {

            await boot({respond: xmlResponder('invoice.xml'), sPageDom: 'invoice-view-dom.html', reference: sFailure});

            check(`${sFailure}: no error shown`, !message());
            checkEqual(`${sFailure}: page label stays`, labelOf(bodyRow('memo')), 'Page Memo Label');
            checkEqual(`${sFailure}: page type stays`, typeOf(bodyRow('memo')), 'textarea');
            checkEqual(`${sFailure}: reference-only label gone`, bodyRow('amountpaid').querySelector('.fe-field-label'), null);
            checkEqual(`${sFailure}: heuristic type`, typeOf(bodyRow('amountpaid')), 'currency');
        }
    };

    SCENARIOS['labels-both-fail'] = async () => {

        await boot({respond: xmlResponder('invoice.xml'), pageMetaFails: true, reference: 'reject'});

        check('no error shown', !message());
        check('heuristics carry on', typeOf(bodyRow('trandate')) === 'date');
        checkEqual('no label lines', qsa('#bodyFieldsTable .fe-field-label').length, 0);

        oWorld.pageMetaFails = false;
    };

    SCENARIOS['labels-real-reference-file'] = async () => {

        await boot({respond: xmlResponder('invoice.xml'), reference: 'real'});

        checkEqual('real file fetched once', oLog.referenceFetches, 1);
        checkEqual('entity label from the packaged file', labelOf(bodyRow('entity')), 'Customer');
        checkEqual('entity type from the packaged file', typeOf(bodyRow('entity')), 'select');
        checkEqual('trandate from the packaged file', labelOf(bodyRow('trandate')), 'Date');
    };

    SCENARIOS['labels-search'] = async () => {

        await boot({respond: xmlResponder('invoice.xml'), sPageDom: 'invoice-view-dom.html'});

        setSearch('page memo');
        checkEqual('body: finds a field by label', bodyIds(), ['memo']);
        check('body: highlights the label', bodyRow('memo').querySelector('.fe-field-label mark')?.textContent.toLowerCase() === 'page memo');

        setSearch('amount paid');
        checkEqual('body: reference labels count too', bodyIds(), ['amountpaid']);

        setSearch('line note');
        await openTab('tabBtnSublists');
        checkEqual('sublist: finds a column by label', sublistCols(), ['custcol_note']);
        checkEqual('sublist: a label hit keeps every line', lineNumbers(), ['1', '2', '3']);
        check('sublist: highlights the label', !!headerFor('custcol_note').querySelector('.fe-field-label mark'));
    };

    SCENARIOS['labels-csv'] = async () => {

        await boot({respond: xmlResponder('invoice.xml'), sPageDom: 'invoice-view-dom.html'});

        qs('#exportCsvBtn').click();

        const {sText: sBody} = await lastDownload();
        const aLines = sBody.slice(1).split('\n');

        checkEqual('Label after Field ID', aLines[0], '"Field ID","Label","Value","Type"');
        check('row carries the label and the resolved type', aLines.includes('"memo","Page Memo Label","Synthetic memo text","textarea"'), aLines.join(' | '));
        check('row without a label has a blank cell', aLines.includes('"paid","","Partially","text"'), aLines.join(' | '));

        await openTab('tabBtnSublists');
        selectSublist('item');
        qs('#exportSublistCsvBtn').click();

        const {sText: sSublist} = await lastDownload();

        check('sublist CSV keeps ids as headers', sSublist.slice(1).split('\n')[0].startsWith('"#","item","item_display","quantity"'));
        check('sublist CSV has no labels', !sSublist.includes('Line Note'));
    };

    SCENARIOS['labels-projection'] = async () => {

        await boot({respond: xmlResponder('invoice.xml'), sPageDom: 'invoice-view-dom.html'});

        await openTab('tabBtnRaw');

        const oAll = rawJson();

        checkEqual('body labels', oAll.oFieldLabels.body.memo, 'Page Memo Label');
        check('a field with no label is absent', !('paid' in oAll.oFieldLabels.body));
        check('empties never contribute: body', !('custbody_blank' in oAll.oFieldLabels.body) && !('billaddress' in oAll.oFieldLabels.body));
        checkEqual('sublist labels', oAll.oFieldLabels.sublists.item.custcol_note, 'Line Note');
        check('empties never contribute: columns', !('custcol_blank' in oAll.oFieldLabels.sublists.item));
        check('a 0-line sublist contributes nothing', !('links' in oAll.oFieldLabels.sublists));

        setFilter('custom');

        const oCustom = rawJson();

        checkEqual('custom filter: labels follow the filter', Object.keys(oCustom.oFieldLabels.body), ['custbody_region']);
        checkEqual('custom filter: only surviving columns', Object.keys(oCustom.oFieldLabels.sublists.item), ['custcol_note']);

        setFilter('standard');

        const oStandard = rawJson();

        check('standard filter: body', 'memo' in oStandard.oFieldLabels.body && !('custbody_region' in oStandard.oFieldLabels.body));
        check('standard filter: columns', !('custcol_note' in oStandard.oFieldLabels.sublists.item));

        setFilter('all');

        qs('#exportJsonBtn').click();

        const oExport = JSON.parse((await lastDownload()).sText);

        checkEqual('JSON export carries the same projection', oExport.oFieldLabels, oAll.oFieldLabels);
    };

    /* ──── Empty fields (AC10) ──── */

    SCENARIOS['empty-toggle'] = async () => {

        await boot({respond: xmlResponder('invoice.xml'), sPageDom: 'invoice-view-dom.html'});

        const aEmpties = ['custbody_blank', 'custbody_blank2', 'otherrefnum', 'billaddress', 'department'];

        check('checkbox defaults off', !qs('#showEmptyToggle').checked);
        check('off hides them', aEmpties.every((pId) => !bodyRow(pId)));
        check('badge counts them anyway', qs('#fieldCount').textContent.endsWith('5 empty'), qs('#fieldCount').textContent);

        setShowEmpty(true);

        check('on shows them', aEmpties.every((pId) => !!bodyRow(pId)));
        checkEqual('muted (empty) value', bodyRow('department').querySelector('.col-value .fe-empty-value').textContent, '(empty)');
        checkEqual('label still shown', labelOf(bodyRow('custbody_blank')), 'Blank Flag');
        checkEqual('page type shown', typeOf(bodyRow('custbody_blank')), 'checkbox');

        bodyRow('department').querySelector('.col-value .clickable').click();
        await delay(10);
        checkEqual('copy gives the id', oLog.clipboard[oLog.clipboard.length - 1], 'department');

        check('internals from fields never appear', ['_multibtnstate_', 'selectedtab', 'nsbrowserenv'].every((pId) => !bodyRow(pId)));
        check('sublist names are not empties', !bodyRow('item') && !bodyRow('links'));
        check('sensitive names are not empties', !bodyRow('_csrf') && !bodyRow('_eml_nkey_'));

        checkEqual('persisted locally', oStorage.local.data.fex_showEmpty, true);
        checkEqual('persisted to sync (roaming)', oStorage.sync.data.fex_showEmpty, true);

        setFilter('custom');
        check('filter applies to empties', !!bodyRow('custbody_blank') && !bodyRow('department'));
        check('badge follows the filter', qs('#fieldCount').textContent.endsWith('2 empty'), qs('#fieldCount').textContent);
        setFilter('all');

        qs('#exportCsvBtn').click();

        const aLines = (await lastDownload()).sText.slice(1).split('\n');

        check('CSV includes empties with a blank value', aLines.includes('"department","","","text"'), aLines.join(' | '));

        await openTab('tabBtnRaw');

        const sRaw = qs('#rawJsonContainer .raw-json').textContent;

        check('Raw JSON has no empties', !sRaw.includes('department') && !sRaw.includes('custbody_blank'));

        qs('#exportJsonBtn').click();

        const sJson = (await lastDownload()).sText;

        check('JSON export has no empties', !sJson.includes('department') && !sJson.includes('custbody_blank'));

        setShowEmpty(false);
        await openTab('tabBtnBody');
        check('off again hides them', aEmpties.every((pId) => !bodyRow(pId)));

        qs('#exportCsvBtn').click();
        check('CSV off has none', !(await lastDownload()).sText.includes('department'));

        await boot({respond: xmlResponder('invoice.xml')});
        check('reopen keeps the stored off', !qs('#showEmptyToggle').checked);

        delete oStorage.local.data.fex_showEmpty;
        delete oStorage.sync.data.fex_showEmpty;
    };

    SCENARIOS['empty-restored-on'] = async () => {

        oStorage.sync.data.fex_showEmpty = true;

        await boot({respond: xmlResponder('invoice.xml')});

        check('roamed value restores the checkbox', qs('#showEmptyToggle').checked);
        check('rows show on first paint', !!bodyRow('department'));

        delete oStorage.sync.data.fex_showEmpty;
        delete oStorage.local.data.fex_showEmpty;
    };

    SCENARIOS['empty-found-by-search'] = async () => {

        await boot({respond: xmlResponder('invoice.xml'), sPageDom: 'invoice-view-dom.html'});

        setSearch('departm');
        checkEqual('off: finds an empty by id', bodyIds(), ['department']);

        setSearch('blank flag');
        checkEqual('off: finds an empty by label', bodyIds(), ['custbody_blank']);

        setSearch('(empty)');
        checkEqual('the placeholder is not searchable', bodyIds(), []);

        setSearch('departm');
        setShowEmpty(true);
        checkEqual('on: same result', bodyIds(), ['department']);

        setSearch('zzz-no-such');
        checkEqual('on with a term: non-matching empties stay out', bodyIds(), []);
        setSearch('');
        setShowEmpty(false);

        await openTab('tabBtnSublists');
        selectSublist('item');
        setSearch('custcol_bl');
        checkEqual('off: finds an empty column by id', sublistCols(), ['custcol_blank']);

        setSearch('blank column');
        checkEqual('off: finds an empty column by label', sublistCols(), ['custcol_blank']);

        delete oStorage.local.data.fex_showEmpty;
        delete oStorage.sync.data.fex_showEmpty;
    };

    SCENARIOS['empty-sublists'] = async () => {

        await boot({respond: xmlResponder('invoice.xml'), sPageDom: 'invoice-view-dom.html'});

        await openTab('tabBtnSublists');
        selectSublist('item');

        check('off: blank column hidden', !sublistCols().includes('custcol_blank'));

        selectSublist('links');
        checkEqual('off: 0-line sublist has the old message', qs('#sublistTable').textContent, 'No lines in this sublist.');
        checkEqual('off: 0-line sublist has no header', sublistHeaders().length, 0);

        setShowEmpty(true);
        checkEqual('on: 0-line sublist shows its columns', sublistCols(), ['id', 'linktype', 'linkdate', 'custcol_linkflag']);
        check('on: 0-line sublist says so', qs('#sublistTable').textContent.includes('No lines in this sublist.'));
        checkEqual('on: no line rows', sublistLineRows().length, 0);

        setFilter('custom');
        checkEqual('on + custom: only custom columns', sublistCols(), ['custcol_linkflag']);
        setFilter('all');

        selectSublist('item');
        check('on: blank columns appended', sublistCols().includes('custcol_blank'));
        check('on: internals stay out', !sublistCols().includes('_line_hidden') && !sublistCols().includes('nsapiLC'));

        const nBlank = sublistCols().indexOf('custcol_blank') + 1;
        const aCells = sublistLineRows().map((pRow) => pRow.cells[nBlank].textContent);

        checkEqual('on: blank cells', aCells, ['', '', '']);

        setShowEmpty(false);
        delete oStorage.local.data.fex_showEmpty;
        delete oStorage.sync.data.fex_showEmpty;
    };

    /* ──── Search everything (AC11) ──── */

    SCENARIOS['search-tab-counts'] = async () => {

        await boot({respond: xmlResponder('invoice.xml'), sPageDom: 'invoice-view-dom.html'});

        checkEqual('no term: plain labels', [tabText('tabBtnBody'), tabText('tabBtnSublists')], ['Body Fields', 'Sublists']);
        check('no term: plain options', optionTexts().every((pText) => !pText.includes('matches')), optionTexts().join());

        setSearch('widget');

        checkEqual('body count equals rendered rows', tabText('tabBtnBody'), `Body Fields (${bodyRows().length})`);
        checkEqual('sublist count sums visible lines', tabText('tabBtnSublists'), 'Sublists (2)');

        await openTab('tabBtnSublists');

        checkEqual('dropdown counts', optionTexts(), ['item (3 lines) - 2 matches', 'links (0 lines) - 0 matches', 'salesteam (1 lines) - 0 matches']);
        checkEqual('table matches the dropdown', sublistLineRows().length, 2);

        setSearch('Synthetic');
        checkEqual('selection moves to the first sublist with matches', qs('#sublistSelect').value, 'salesteam');
        checkEqual('tab count across sublists', tabText('tabBtnSublists'), `Sublists (${sublistLineRows().length})`);
        checkEqual('body matches rendered', tabText('tabBtnBody').match(/\d+/)[0], '1');

        setSearch('');
        checkEqual('clearing keeps the selection', qs('#sublistSelect').value, 'salesteam');
        checkEqual('labels back to plain', [tabText('tabBtnBody'), tabText('tabBtnSublists')], ['Body Fields', 'Sublists']);
        check('options back to plain', optionTexts().every((pText) => !pText.includes('matches')));

        setSearch('zzz-nothing');
        checkEqual('no matches anywhere: selection stays', qs('#sublistSelect').value, 'salesteam');
        checkEqual('zero counts', [tabText('tabBtnBody'), tabText('tabBtnSublists')], ['Body Fields (0)', 'Sublists (0)']);
    };

    SCENARIOS['search-counts-agree-for-every-sublist'] = async () => {

        await boot({respond: xmlResponder('invoice.xml'), sPageDom: 'invoice-view-dom.html'});

        await openTab('tabBtnSublists');

        for (const sTerm of ['note', 'widget', 'list', 'line note', 'gadget', 'synthetic', '100', 'quantity']) {

            setSearch(sTerm);

            const nTabCount = Number(tabText('tabBtnSublists').match(/\d+/)[0]);
            const aOptionCounts = optionTexts().map((pText) => Number(pText.match(/- (\d+) matches/)[1]));
            let nRendered = 0;

            for (const sName of ['item', 'links', 'salesteam']) {

                selectSublist(sName);
                nRendered += sublistLineRows().length;
                checkEqual(`"${sTerm}" ${sName}: option equals rendered`, aOptionCounts[['item', 'links', 'salesteam'].indexOf(sName)], sublistLineRows().length);
            }

            checkEqual(`"${sTerm}": tab equals the sum of rendered`, nTabCount, nRendered);
        }
    };

    SCENARIOS['search-manual-selection-stands'] = async () => {

        await boot({respond: xmlResponder('invoice.xml')});

        await openTab('tabBtnSublists');
        setSearch('widget');
        checkEqual('moved to item', qs('#sublistSelect').value, 'item');

        selectSublist('salesteam');
        checkEqual('a hand-picked sublist with no matches stays', qs('#sublistSelect').value, 'salesteam');
        check('and says why', qs('#sublistTable').textContent.includes('No fields match your search.'));
    };

    SCENARIOS['search-selection-only-on-sublists-tab'] = async () => {

        await boot({respond: xmlResponder('invoice.xml')});

        await openTab('tabBtnSublists');
        selectSublist('salesteam');
        await openTab('tabBtnBody');

        setSearch('widget');
        checkEqual('on another tab the selection waits', qs('#sublistSelect').value, 'salesteam');

        await openTab('tabBtnSublists');
        checkEqual('and moves on arrival', qs('#sublistSelect').value, 'item');
        check('with counts on the options', optionTexts()[0].endsWith('- 2 matches'));
    };

    SCENARIOS['search-raw-json'] = async () => {

        await boot({respond: xmlResponder('invoice.xml')});

        await openTab('tabBtnRaw');
        setSearch('widget');

        const oFiltered = rawJson();

        check('panel narrowed', !oFiltered.oBodyFields);
        checkEqual('deep filter reached the lines', oFiltered.oSublists.item.map((pLine) => pLine.item_display), ['Widget A', 'Widget B']);

        qs('#copyRawJsonBtn').click();
        await delay(10);

        const oCopied = JSON.parse(oLog.clipboard[oLog.clipboard.length - 1]);

        check('Copy stays unfiltered', !!oCopied.oBodyFields.memo && oCopied.oSublists.item.length === 3);

        qs('#exportJsonBtn').click();

        const oExport = JSON.parse((await lastDownload()).sText);

        check('Export stays unfiltered', !!oExport.oBodyFields.memo && oExport.oSublists.item.length === 3);

        setSearch('');
        check('clearing restores the panel', !!rawJson().oBodyFields.memo);
    };

    SCENARIOS['search-through-the-debounced-input'] = async () => {

        await boot({respond: xmlResponder('invoice.xml')});

        const oBox = qs('#searchBox');

        oBox.value = 'memo';
        oBox.dispatchEvent(new Event('input'));

        checkEqual('nothing yet inside the debounce', tabText('tabBtnBody'), 'Body Fields');

        await waitFor(() => tabText('tabBtnBody') !== 'Body Fields', 2000, 'debounced search');

        checkEqual('applied after the debounce', bodyIds(), ['memo']);
    };

    /**
     * Builds the 5,000 lines x 85 columns record.
     *
     * @returns {string} xml=T body
     */
    const buildLargeRecord = () => {

        const aCols = [];

        for (let nCol = 0; nCol < 85; nCol++) {
            aCols.push(nCol % 10 === 0 ? `custcol_c${nCol}` : `col${nCol}`);
        }

        const aLines = ['<line>'];

        for (let nLine = 1; nLine <= 5000; nLine++) {

            const aCells = [];

            for (let nCol = 0; nCol < 85; nCol++) {
                aCells.push(`<${aCols[nCol]}>line ${nLine} value ${nCol} synthetic${nLine % 50 === 0 ? ' needle' : ''}</${aCols[nCol]}>`);
            }

            aLines.push(`<line>${aCells.join('')}</line>`);
        }

        aLines.shift();

        return `<?xml version="1.0"?><nsResponse><record recordType="salesorder" id="9" fields="memo"><memo>Large</memo>
            <machine name="item" type="edit" fields="${aCols.join(',')}">${aLines.join('')}</machine>
            </record></nsResponse>`;
    };

    /**
     * Times applying a term, handler entry to DOM updated, debounce excluded.
     *
     * @param {string} pTerm
     * @param {number} pRuns - measured runs, after one warm-up
     * @returns {{nMedian: number, aSamples: Array<number>, nWarmUp: number}}
     */
    const timeSearch = (pTerm, pRuns) => {

        const aSamples = [];
        let nWarmUp = 0;

        for (let nRun = 0; nRun <= pRuns; nRun++) {

            setSearch('');

            const oBox = qs('#searchBox');
            const nStart = performance.now();

            oBox.value = pTerm;
            window.fex.applySearch();

            const nElapsed = performance.now() - nStart;

            if (nRun > 0) {
                aSamples.push(nElapsed);
            } else {
                nWarmUp = nElapsed;
            }
        }

        const aSorted = aSamples.slice().sort((pA, pB) => pA - pB);

        return {nMedian: aSorted[Math.floor(aSorted.length / 2)], aSamples: aSamples, nWarmUp: nWarmUp};
    };

    SCENARIOS['search-timing-5000x85'] = async () => {

        const sXml = buildLargeRecord();

        await boot({respond: async () => fixtureResponse(sXml)});
        await openTab('tabBtnSublists');

        checkEqual('fixture is 5,000 lines', qs('#sublistSelect option').textContent, 'item (5000 lines)');
        checkEqual('fixture is 85 columns', sublistCols().length, 85);

        const aCases = [
            ['every line, every column (500 x 85 rendered)', 'synthetic'],
            ['2% of the lines, every column', 'needle'],
            ['one line', 'line 2500 value 42'],
            ['no match', 'zzz-no-such-value']
        ];

        for (const [sCase, sTerm] of aCases) {

            const oTiming = timeSearch(sTerm, 5);
            const sSamples = oTiming.aSamples.map((pSample) => pSample.toFixed(1)).join(', ');

            oHarness.info[sCase] = `median ${oTiming.nMedian.toFixed(1)} ms [${sSamples}], warm-up ${oTiming.nWarmUp.toFixed(1)} ms`;

            check(`median under 100 ms: ${sCase}`, oTiming.nMedian < 100, `median ${oTiming.nMedian.toFixed(1)} ms`);
        }

        setSearch('needle');
        checkEqual('tab count', tabText('tabBtnSublists'), 'Sublists (100)');
        checkEqual('option count', qs('#sublistSelect option').textContent, 'item (5000 lines) - 100 matches');
        checkEqual('rendered', sublistLineRows().length, 100);

        setSearch('synthetic');
        checkEqual('cap still applies', sublistLineRows().length, 500);
        check('with its notice', qs('#sublistTable').textContent.includes('Showing first 500 of 5000 lines'));

        setSearch('');
    };

    /* ──── Large sublist (matrix 11) ──── */

    SCENARIOS['large-sublist-cap'] = async () => {

        const aLines = [];

        for (let nLine = 1; nLine <= 620; nLine++) {
            aLines.push(`<line><item>${nLine}</item><memo>${nLine === 612 ? 'needle' : 'hay'}</memo></line>`);
        }

        const sXml = `<nsResponse><record recordType="invoice" id="1"><machine name="item" type="edit">${aLines.join('')}</machine></record></nsResponse>`;

        await boot({respond: async () => fixtureResponse(sXml)});
        await openTab('tabBtnSublists');

        checkEqual('capped at 500 rows', sublistLineRows().length, 500);
        check('with a notice', qs('#sublistTable').textContent.includes('Showing first 500 of 620 lines - use search to narrow.'));

        qs('#exportSublistCsvBtn').click();
        checkEqual('CSV carries every line', (await lastDownload()).sText.split('\n').length, 621);

        setSearch('needle');
        checkEqual('line numbers stay absolute', lineNumbers(), ['612']);

        qs('#exportSublistCsvBtn').click();
        checkEqual('CSV ignores the search', (await lastDownload()).sText.split('\n').length, 621);

        setSearch('');
        setFilter('custom');
        checkEqual('no columns survive: filter message', qs('#sublistTable').textContent, 'No custom fields in this sublist.');
        setSearch('nothing-at-all');
        checkEqual('with a term: search message', qs('#sublistTable').textContent, 'No fields match your search.');
        setSearch('');
        setFilter('all');
    };

    /* ──── Compare (AC12) ──── */

    /**
     * Pins record A, then reopens the popup on record B.
     */
    const pinThenOpenB = async () => {

        await boot({
            tabUrl: `${ORIGIN}/app/accounting/transactions/salesord.nl?id=3001`,
            respond: xmlResponder('compare-a.xml'),
            sPageDom: null
        });

        qs('#pinBtn').click();
        await delay(10);

        await boot({
            tabUrl: `${ORIGIN}/app/accounting/transactions/salesord.nl?id=3002`,
            respond: xmlResponder('compare-b.xml')
        });
    };

    const compareRows = () => qsa('#compareBody tbody tr').filter((pRow) => pRow.cells.length > 1);

    /* A cell's own text, without the label line: a highlight can split it into several nodes */
    const compareText = (pCell) => Array.from(pCell.childNodes)
        .filter((pNode) => !pNode.classList?.contains('fe-field-label'))
        .map((pNode) => pNode.textContent)
        .join('');
    const compareCells = (pRow) => Array.from(pRow.cells).map(compareText);
    const compareFor = (pCol) => compareRows().find((pRow) => compareText(pRow.querySelector('.cmp-field')) === pCol) || null;

    SCENARIOS['compare-flow'] = async () => {

        await boot({
            tabUrl: `${ORIGIN}/app/accounting/transactions/salesord.nl?id=3001`,
            respond: xmlResponder('compare-a.xml'),
            sPageDom: null
        });

        check('pin button visible with a record', qs('#pinBtn').style.display !== 'none');
        checkEqual('no tab before pinning', qs('#tabBtnCompare').style.display, 'none');

        qs('#pinBtn').click();
        await delay(10);

        const oSnapshot = oStorage.session.data.fex_pinned;

        checkEqual('snapshot shape', Object.keys(oSnapshot), ['sAccount', 'sRecordType', 'sId', 'oBodyFields', 'oSublists', 'oFieldLabels', 'nPinnedAt']);
        checkEqual('snapshot identity', [oSnapshot.sAccount, oSnapshot.sRecordType, oSnapshot.sId], ['1234567', 'salesorder', '3001']);
        check('snapshot has no sensitive names', !JSON.stringify(oSnapshot).includes('SYNTHETIC-CSRF'));
        check('snapshot has no empties', !('custbody_blank' in oSnapshot.oBodyFields));
        check('pinning shows the tab right away', qs('#tabBtnCompare').style.display !== 'none');
        checkEqual('and it reads no differences yet', tabText('tabBtnCompare'), 'Compare (0)');

        await openTab('tabBtnCompare');
        checkEqual('No differences.', qs('#compareBody').textContent, 'No differences.');

        await boot({
            tabUrl: `${ORIGIN}/app/accounting/transactions/salesord.nl?id=3002`,
            respond: xmlResponder('compare-b.xml')
        });

        checkEqual('tab count', tabText('tabBtnCompare'), 'Compare (8)');

        await openTab('tabBtnCompare');

        checkEqual('identities', qsa('.cmp-identity .info-value').map((pValue) => pValue.textContent), [
            '1234567 / salesorder / 3001',
            '1234567 / salesorder / 3002'
        ]);
        check('same type: no notice', !qs('.cmp-notice'));

        checkEqual('changed body row', compareCells(compareFor('memo')), ['memo', 'Old memo', 'New memo']);
        check('changed class', compareFor('memo').classList.contains('cmp-changed'));
        checkEqual('added body row', compareCells(compareFor('addedfield')), ['addedfield', '', 'brand new']);
        check('added class', compareFor('addedfield').classList.contains('cmp-added'));
        checkEqual('removed body row', compareCells(compareFor('removedfield')), ['removedfield', 'going away', '']);
        check('removed class', compareFor('removedfield').classList.contains('cmp-removed'));
        check('unchanged field absent', !compareFor('custbody_keep'));
        check('missing and empty are equal', !compareFor('blankpinned'));
        check('internals excluded', !compareFor('nsapiCT') && !compareFor('wfFC') && !compareFor('_perm'));

        const aItem = compareRows().filter((pRow) => pRow.cells.length === 4 && pRow.closest('table').previousElementSibling.textContent === 'Sublist: item');
        const aExpense = compareRows().filter((pRow) => pRow.cells.length === 4 && pRow.closest('table').previousElementSibling.textContent === 'Sublist: expense');

        checkEqual('line rows', aItem.map(compareCells), [
            ['1', 'quantity', '1', '2'],
            ['1', 'custcol_tag', 'red', 'green'],
            ['3', '(line added)', '', '3 fields']
        ]);
        check('added line class', aItem[2].classList.contains('cmp-added'));
        checkEqual('removed whole line', aExpense.map(compareCells), [['1', '(line removed)', '2 fields', '']]);
        check('removed line class', aExpense[0].classList.contains('cmp-removed'));
        check('a sublist with no differences is absent', !qsa('.cmp-section-title').some((pTitle) => pTitle.textContent.includes('links')));
        check('internal line column excluded', !compareFor('nsapiLC'));

        setFilter('custom');
        checkEqual('custom filter: fields', compareRows().map((pRow) => compareText(pRow.querySelector('.cmp-field'))), [
            'custbody_gone',
            'custcol_tag',
            '(line added)',
            '(line removed)'
        ]);
        checkEqual('count does not move with the filter', tabText('tabBtnCompare'), 'Compare (8)');
        setFilter('standard');
        check('standard filter drops custom cells', !compareFor('custbody_gone') && !compareFor('custcol_tag'));
        check('standard filter keeps a whole line with a standard column', !!compareFor('(line added)'));
        setFilter('all');

        setSearch('going away');
        checkEqual('search by pinned value', compareRows().map((pRow) => compareText(pRow.querySelector('.cmp-field'))), ['removedfield', 'custbody_gone']);
        checkEqual('count does not move with the search', tabText('tabBtnCompare'), 'Compare (8)');

        setSearch('brand new');
        checkEqual('search by current value', compareRows().length, 1);

        setSearch('addedf');
        checkEqual('search by id', compareRows().length, 1);

        setSearch('yellow');
        checkEqual('a whole-line row matches on a value on that line', compareRows().map(compareCells), [['3', '(line added)', '', '3 fields']]);

        setSearch('travel');
        checkEqual('a removed line matches on its values', compareRows().map(compareCells), [['1', '(line removed)', '2 fields', '']]);

        setSearch('zzz');
        check('nothing left says so', qs('#compareBody').textContent.includes('No differences match'));
        setSearch('');

        check('never written to local', oLog.storageWrites.local.every((pWrite) => !('fex_pinned' in pWrite)));
        check('never written to sync', oLog.storageWrites.sync.every((pWrite) => !('fex_pinned' in pWrite)));
        checkEqual('only one key in session', Object.keys(oStorage.session.data), ['fex_pinned']);

        qs('#unpinBtn').click();
        await delay(10);

        checkEqual('unpin removes the snapshot', oStorage.session.data.fex_pinned, undefined);
        checkEqual('unpin removes the tab', qs('#tabBtnCompare').style.display, 'none');
        check('Body Fields activates', qs('#tabBtnBody').classList.contains('active') && qs('#panelBody').classList.contains('active'));
        checkEqual('focus moves to the tab that became active', document.activeElement.id, 'tabBtnBody');
        check('panel renders', bodyRows().length > 0);
    };

    SCENARIOS['compare-labels'] = async () => {

        await boot({
            tabUrl: `${ORIGIN}/app/accounting/transactions/salesord.nl?id=3001`,
            respond: xmlResponder('compare-a.xml'),
            sPageDom: 'salesorder-edit-dom.html'
        });

        qs('#pinBtn').click();
        await delay(10);

        checkEqual('snapshot stores labels of populated fields, unfiltered', oStorage.session.data.fex_pinned.oFieldLabels.body.memo, 'Memo');

        await boot({
            tabUrl: `${ORIGIN}/app/accounting/transactions/salesord.nl?id=3002`,
            respond: xmlResponder('compare-b.xml'),
            sPageDom: 'salesorder-edit-dom.html'
        });

        await openTab('tabBtnCompare');

        checkEqual('field cell has the label line', compareFor('memo').querySelector('.fe-field-label').textContent, 'Memo');

        checkEqual('line cell has the column label', compareFor('custcol_tag').querySelector('.fe-field-label').textContent, 'Line Tag');

        setSearch('line tag');
        check('search matches a column label', !!compareFor('custcol_tag'));
        checkEqual('its line cell and the added line that has the column', compareRows().map((pRow) => compareCells(pRow)[1]), ['custcol_tag', '(line added)']);
    };

    SCENARIOS['compare-types-differ'] = async () => {

        await pinThenOpenB();

        await boot({respond: xmlResponder('invoice.xml')});
        await openTab('tabBtnCompare');

        checkEqual('notice names both types', qs('.cmp-notice').textContent, 'Record types differ: salesorder and invoice.');
        check('still compares', compareRows().length > 0);
    };

    SCENARIOS['compare-pin-replaces-and-fails-safely'] = async () => {

        await pinThenOpenB();

        const nFirstPin = oStorage.session.data.fex_pinned.sId;

        checkEqual('first pin was record A', nFirstPin, '3001');

        oStorage.session.failSet = new Error('quota exceeded');
        qs('#pinBtn').click();
        await delay(10);
        oStorage.session.failSet = null;

        checkEqual('failure message', qs('#pinStatus').textContent, 'Could not pin this record');
        check('error style', qs('#pinStatus').classList.contains('error'));
        checkEqual('old snapshot stands', oStorage.session.data.fex_pinned.sId, '3001');
        checkEqual('compare still against the old one', tabText('tabBtnCompare'), 'Compare (8)');

        await openTab('tabBtnCompare');
        qs('#pinBtn').click();
        await delay(10);

        checkEqual('a good pin replaces it', oStorage.session.data.fex_pinned.sId, '3002');
        checkEqual('tab recounts', tabText('tabBtnCompare'), 'Compare (0)');
        checkEqual('the open panel repaints', qs('#compareBody').textContent, 'No differences.');
        check('status clears the error', !qs('#pinStatus').classList.contains('error'));
    };

    SCENARIOS['compare-repin-while-away'] = async () => {

        await pinThenOpenB();
        await openTab('tabBtnCompare');
        await openTab('tabBtnBody');

        qs('#pinBtn').click();
        await delay(10);

        await openTab('tabBtnCompare');
        checkEqual('returning to the tab shows the new diff', qs('#compareBody').textContent, 'No differences.');
    };

    SCENARIOS['compare-keyboard-skips-hidden-tab'] = async () => {

        await boot({respond: xmlResponder('invoice.xml')});

        const oRaw = qs('#tabBtnRaw');

        await openTab('tabBtnRaw');
        oRaw.focus();
        pressKey(oRaw, 'ArrowRight');
        checkEqual('hidden Compare tab is skipped', document.activeElement.id, 'tabBtnBody');

        pressKey(document.activeElement, 'ArrowLeft');
        checkEqual('and in reverse', document.activeElement.id, 'tabBtnRaw');
    };

    SCENARIOS['compare-legacy-view'] = async () => {

        oStorage.local.data.fex_viewMode = 'legacy';

        await boot({
            tabUrl: `${ORIGIN}/app/accounting/transactions/salesord.nl?id=3001`,
            respond: xmlResponder('compare-a.xml')
        });

        check('pin button available in legacy', qs('#pinBtn').style.display !== 'none');

        qs('#pinBtn').click();
        await delay(10);

        checkEqual('pin works', oStorage.session.data.fex_pinned.sId, '3001');
        check('tab bar hidden, so no Compare tab shows', qs('#tabBar').style.display === 'none');

        setViewMode('new');
        check('new view shows it', qs('#tabBtnCompare').style.display !== 'none');

        delete oStorage.local.data.fex_viewMode;
        delete oStorage.sync.data.fex_viewMode;
    };

    SCENARIOS['compare-no-record'] = async () => {

        oStorage.session.data.fex_pinned = {sAccount: 'x', sRecordType: 'invoice', sId: '1', oBodyFields: {a: '1'}, oSublists: {}, oFieldLabels: {body: {}, sublists: {}}, nPinnedAt: 1};

        await boot({tabUrl: `${ORIGIN}/app/center/card.nl`, respond: xmlResponder('invoice.xml')});

        checkEqual('no record: no tab', qs('#tabBtnCompare').style.display, 'none');
        checkEqual('no record: no pin button', qs('#pinBtn').style.display, 'none');

        delete oStorage.session.data.fex_pinned;
    };

    SCENARIOS['compare-no-session-api'] = async () => {

        await prepare();

        const oSaved = window.chrome.storage.session;

        delete window.chrome.storage.session;

        await boot({respond: xmlResponder('invoice.xml')});

        checkEqual('no storage.session: no pin button', qs('#pinBtn').style.display, 'none');
        check('the record still renders', bodyRows().length > 0);

        window.chrome.storage.session = oSaved;
    };

    SCENARIOS['compare-session-read-fails'] = async () => {

        oStorage.session.failGet = new Error('session gone');

        await boot({respond: xmlResponder('invoice.xml')});

        check('record renders', bodyRows().length > 0);
        checkEqual('no tab', qs('#tabBtnCompare').style.display, 'none');

        oStorage.session.failGet = null;
    };

    SCENARIOS['compare-unpin-failure'] = async () => {

        await pinThenOpenB();
        await openTab('tabBtnCompare');

        oStorage.session.failSet = new Error('session write refused');
        qs('#unpinBtn').click();
        await delay(10);
        oStorage.session.failSet = null;

        checkEqual('says so', qs('#pinStatus').textContent, 'Could not unpin this record');
        check('tab stays', qs('#tabBtnCompare').style.display !== 'none');
        check('focus does not jump on a failure', document.activeElement.id !== 'tabBtnBody');
    };

    SCENARIOS['compare-large-diff-capped'] = async () => {

        const fnXml = (pValue) => {

            const aLines = [];

            for (let nLine = 0; nLine < 620; nLine++) aLines.push(`<line><qty>${pValue}${nLine}</qty></line>`);

            return `<nsResponse><record recordType="invoice" id="1"><machine name="item" type="edit">${aLines.join('')}</machine></record></nsResponse>`;
        };

        await boot({respond: async () => fixtureResponse(fnXml('a'))});
        qs('#pinBtn').click();
        await delay(10);

        await boot({respond: async () => fixtureResponse(fnXml('b'))});
        await openTab('tabBtnCompare');

        checkEqual('count is complete', tabText('tabBtnCompare'), 'Compare (620)');
        checkEqual('render is capped', compareRows().length, 500);
        check('with a notice', qs('#compareBody').textContent.includes('Showing first 500 of 620 rows'));
    };

    /* ──── Settings (matrix 7, 15, MJ-001) ──── */

    const resetSettings = () => {

        oStorage.local.data = {};
        oStorage.sync.data = {};
        oLog.storageWrites.local.length = 0;
        oLog.storageWrites.sync.length = 0;
        localStorage.clear();
    };

    const settle = () => delay(20);

    SCENARIOS['settings-update-from-1.1.1'] = async () => {

        resetSettings();
        oStorage.local.data = {fex_darkMode: true, fex_compactMode: true, fex_viewMode: 'new', fex_popupWidth: 470, fex_popupHeight: 600};

        await boot({tabUrl: 'https://www.example.com/'});
        await settle();

        checkEqual('boolean theme migrated', oStorage.local.data.fex_darkMode, 'on');
        checkEqual('roaming keys copied to sync', [oStorage.sync.data.fex_darkMode, oStorage.sync.data.fex_compactMode, oStorage.sync.data.fex_viewMode], ['on', true, 'new']);
        check('size keys never enter sync', !('fex_popupWidth' in oStorage.sync.data) && !('fex_popupHeight' in oStorage.sync.data));
        checkEqual('marker set after the sync write', oStorage.local.data.fex_settingsMigrated, true);
        checkEqual('mirror refreshed for boot.js', [localStorage.getItem('fex_darkMode'), localStorage.getItem('fex_compactMode'), localStorage.getItem('fex_popupWidth')], ['on', 'true', '470']);
        checkEqual('stored size clamped in the UI', document.documentElement.style.getPropertyValue('--fe-height'), '592px');
    };

    SCENARIOS['settings-merge-sync-over-local'] = async () => {

        resetSettings();
        oStorage.local.data = {fex_viewMode: 'legacy', fex_fieldFilter: 'custom', fex_settingsMigrated: true};
        oStorage.sync.data = {fex_viewMode: 'new'};

        await boot({tabUrl: 'https://www.example.com/'});
        await settle();

        checkEqual('sync key wins where present', qs('#viewModeSelect').value, 'new');
        checkEqual('local survives where sync is silent', qs('#fieldFilterSelect').value, 'custom');
        checkEqual('sync reconciled back into local', oStorage.local.data.fex_viewMode, 'new');
    };

    SCENARIOS['settings-sync-read-rejected'] = async () => {

        resetSettings();
        oStorage.local.data = {fex_fieldFilter: 'standard', fex_settingsMigrated: true};
        oStorage.sync.failGet = new Error('sync down');

        await boot({tabUrl: 'https://www.example.com/'});
        await settle();

        oStorage.sync.failGet = null;

        checkEqual('local values in effect', qs('#fieldFilterSelect').value, 'standard');
        checkEqual('init completed', message().textContent, 'Not on a NetSuite page.');
    };

    SCENARIOS['settings-copy-forward-rejected'] = async () => {

        resetSettings();
        oStorage.local.data = {fex_fieldFilter: 'custom'};
        oStorage.sync.failSet = new Error('quota');

        await boot({tabUrl: 'https://www.example.com/'});
        await settle();

        check('marker not set', !oStorage.local.data.fex_settingsMigrated);

        oStorage.sync.failSet = null;

        await boot({tabUrl: 'https://www.example.com/'});
        await settle();

        checkEqual('next open retries', oStorage.sync.data.fex_fieldFilter, 'custom');
        checkEqual('and sets the marker', oStorage.local.data.fex_settingsMigrated, true);
    };

    SCENARIOS['settings-copy-forward-gate'] = async () => {

        resetSettings();

        await boot({tabUrl: 'https://www.example.com/'});
        await settle();

        checkEqual('fresh device publishes nothing', Object.keys(oStorage.sync.data), []);
        check('fresh device writes no theme locally', !('fex_darkMode' in oStorage.local.data));
        checkEqual('fresh device still resolves auto', qs('#darkModeToggle').title, 'Theme: Auto');
        checkEqual('marker still set', oStorage.local.data.fex_settingsMigrated, true);

        resetSettings();
        oStorage.local.data = {fex_compactMode: true};

        await boot({tabUrl: 'https://www.example.com/'});
        await settle();

        checkEqual('only the locally held key is published', Object.keys(oStorage.sync.data), ['fex_compactMode']);

        resetSettings();
        oStorage.local.data = {fex_settingsMigrated: true};
        oStorage.sync.data = {fex_darkMode: 'on'};

        await boot({tabUrl: 'https://www.example.com/'});
        await settle();

        checkEqual('another device keeps its explicit dark', oStorage.sync.data.fex_darkMode, 'on');
        checkEqual('and this device picks it up', oStorage.local.data.fex_darkMode, 'on');
    };

    SCENARIOS['settings-sync-write-rejected-outranks-stale-sync'] = async () => {

        resetSettings();
        oStorage.local.data = {fex_settingsMigrated: true};
        oStorage.sync.data = {fex_fieldFilter: 'all'};

        await boot({tabUrl: 'https://www.example.com/'});
        await settle();

        oStorage.sync.failSet = new Error('quota');
        setFilter('custom');
        await settle();

        checkEqual('sync still holds the old value', oStorage.sync.data.fex_fieldFilter, 'all');
        checkEqual('the intent is recorded', oStorage.local.data.fex_syncPending.fex_fieldFilter, 'custom');

        await boot({tabUrl: 'https://www.example.com/'});
        await settle();

        checkEqual('the pending value wins on reopen', qs('#fieldFilterSelect').value, 'custom');

        oStorage.sync.failSet = null;

        await boot({tabUrl: 'https://www.example.com/'});
        await settle();

        checkEqual('the retry reaches sync', oStorage.sync.data.fex_fieldFilter, 'custom');
        check('and the pending set clears', !('fex_syncPending' in oStorage.local.data));
    };

    SCENARIOS['settings-roaming-write-through'] = async () => {

        resetSettings();
        oStorage.local.data = {fex_settingsMigrated: true};

        await boot({tabUrl: 'https://www.example.com/'});
        await settle();

        setFilter('standard');
        setViewMode('legacy');
        qs('#compactModeToggle').click();
        await settle();

        checkEqual('filter in both', [oStorage.local.data.fex_fieldFilter, oStorage.sync.data.fex_fieldFilter], ['standard', 'standard']);
        checkEqual('view in both', [oStorage.local.data.fex_viewMode, oStorage.sync.data.fex_viewMode], ['legacy', 'legacy']);
        checkEqual('compact in both', [oStorage.local.data.fex_compactMode, oStorage.sync.data.fex_compactMode], [true, true]);
        checkEqual('compact mirrored', localStorage.getItem('fex_compactMode'), 'true');
    };

    SCENARIOS['settings-size-is-device-local'] = async () => {

        resetSettings();
        oStorage.local.data = {fex_settingsMigrated: true};

        await boot({tabUrl: 'https://www.example.com/'});
        await settle();

        const oHandle = qs('#resizeHandle');

        oHandle.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, screenX: 100, screenY: 100}));
        document.dispatchEvent(new MouseEvent('mousemove', {bubbles: true, screenX: 50, screenY: 80}));
        document.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
        await settle();

        check('size reaches local', oStorage.local.data.fex_popupWidth > 0 && oStorage.local.data.fex_popupHeight > 0);
        check('and never sync', !('fex_popupWidth' in oStorage.sync.data) && !('fex_popupHeight' in oStorage.sync.data));
        checkEqual('and the pre-paint mirror', localStorage.getItem('fex_popupWidth'), String(oStorage.local.data.fex_popupWidth));
    };

    SCENARIOS['settings-localstorage-throws'] = async () => {

        resetSettings();

        const fnGet = Storage.prototype.getItem;
        const fnSet = Storage.prototype.setItem;

        Storage.prototype.getItem = () => {

            throw new Error('private window');
        };
        Storage.prototype.setItem = () => {

            throw new Error('private window');
        };

        await boot({respond: xmlResponder('invoice.xml')});
        await settle();

        check('init completes and renders', bodyRows().length > 0);
        check('no startup error', !qs('#container .error-msg'));

        qs('#compactModeToggle').click();
        await settle();

        checkEqual('setting still lands in local', oStorage.local.data.fex_compactMode, true);
        checkEqual('setting still lands in sync', oStorage.sync.data.fex_compactMode, true);

        Storage.prototype.getItem = fnGet;
        Storage.prototype.setItem = fnSet;
    };

    /* ──── Theme table (hotfix 2) ──── */

    SCENARIOS['theme-table-dark-os'] = async () => {

        resetSettings();

        await boot({tabUrl: 'https://www.example.com/', systemDark: true});

        const oToggle = qs('#darkModeToggle');
        const fnIsDark = () => document.documentElement.classList.contains('theme-dark');

        check('auto under a dark OS paints dark', fnIsDark());
        checkEqual('tooltip', oToggle.title, 'Theme: Auto');

        oToggle.click();
        check('first click flips to light', !fnIsDark());
        checkEqual('tooltip names light', oToggle.title, 'Theme: Light');
        checkEqual('stored', oStorage.local.data.fex_darkMode, 'off');

        oToggle.click();
        check('second click flips to dark', fnIsDark());
        checkEqual('via auto, explicit on is the unreachable one', oToggle.title, 'Theme: Auto');

        oToggle.click();
        check('third click flips again', !fnIsDark());
    };

    SCENARIOS['theme-table-light-os'] = async () => {

        resetSettings();

        await boot({tabUrl: 'https://www.example.com/', systemDark: false});

        const oToggle = qs('#darkModeToggle');
        const fnIsDark = () => document.documentElement.classList.contains('theme-dark');

        check('auto under a light OS paints light', !fnIsDark());

        oToggle.click();
        check('first click flips to dark', fnIsDark());
        checkEqual('explicit dark', oToggle.title, 'Theme: Dark');

        oToggle.click();
        check('second click flips to light', !fnIsDark());
        checkEqual('explicit light', oToggle.title, 'Theme: Light');

        oToggle.click();
        check('third click flips back', fnIsDark());
        checkEqual('settled into on and off', oToggle.title, 'Theme: Dark');

        flipSystemTheme(true);
        check('an explicit mode ignores the OS', fnIsDark());
    };

    SCENARIOS['theme-auto-follows-os'] = async () => {

        resetSettings();

        await boot({tabUrl: 'https://www.example.com/', systemDark: false});

        flipSystemTheme(true);
        check('flip to dark in auto', document.documentElement.classList.contains('theme-dark'));

        flipSystemTheme(false);
        check('flip to light in auto', !document.documentElement.classList.contains('theme-dark'));
    };

    /* ──── CSV and copy (matrix 14, MN-003) ──── */

    SCENARIOS['csv-safety-in-the-export'] = async () => {

        const sXml = `<nsResponse><record recordType="invoice" id="1">
            <formula>=SUM(A1)</formula><plus>+1</plus><at>@cmd</at><quoted>say "hi"</quoted><comma>a,b</comma>
            <machine name="item" type="edit"><line><note>=HYPERLINK("x")</note></line></machine>
            </record></nsResponse>`;

        await boot({respond: async () => fixtureResponse(sXml)});

        qs('#exportCsvBtn').click();

        const {sText, sName} = await lastDownload();

        checkEqual('filename', sName, 'invoice_1_fields.csv');
        checkEqual('starts with one BOM', [sText.charCodeAt(0), sText.charCodeAt(1)], [0xFEFF, 34]);
        check('formula guarded', sText.includes('"\'=SUM(A1)"'));
        check('plus guarded', sText.includes('"\'+1"'));
        check('at guarded', sText.includes('"\'@cmd"'));
        check('quotes doubled', sText.includes('"say ""hi"""'));
        check('comma stays inside', sText.includes('"a,b"'));

        await openTab('tabBtnSublists');
        qs('#exportSublistCsvBtn').click();

        const oSublist = await lastDownload();

        checkEqual('sublist filename', oSublist.sName, 'invoice_1_item.csv');
        check('sublist cell guarded', oSublist.sText.includes('"\'=HYPERLINK(""x"")"'));
    };

    SCENARIOS['copy-feedback'] = async () => {

        await boot({respond: xmlResponder('invoice.xml')});

        setSearch('memo');

        const oSpan = bodyRow('memo').querySelector('.col-id .clickable');
        const oMark = oSpan.querySelector('mark');

        check('rendered with a highlight', !!oMark);

        oSpan.click();
        await delay(10);

        checkEqual('copied the id, not the flash', oLog.clipboard[oLog.clipboard.length - 1], 'memo');
        checkEqual('flash replaces the content', oSpan.textContent, '✓ Copied');
        check('copied class', oSpan.classList.contains('copied'));

        oSpan.click();
        await delay(10);
        check('second copy inside the window still flashes', oSpan.classList.contains('copied'));

        await waitFor(() => !oSpan.classList.contains('copied'), 3000, 'flash to clear');

        check('highlight restored by identity', oSpan.querySelector('mark') === oMark);
        checkEqual('text restored', oSpan.textContent, 'memo');

        oWorld.clipboardFails = true;
        oSpan.click();
        await delay(10);

        checkEqual('failure shows it', oSpan.textContent, 'Copy failed');
        check('error class', oSpan.classList.contains('copy-error'));

        await waitFor(() => !oSpan.classList.contains('copy-error'), 3000, 'failure flash to clear');

        check('failure restores the highlight', oSpan.querySelector('mark') === oMark);
        oWorld.clipboardFails = false;
    };

    SCENARIOS['keyboard-explorer'] = async () => {

        await boot({respond: xmlResponder('invoice.xml')});

        const oBody = qs('#tabBtnBody');

        oBody.focus();
        pressKey(oBody, 'ArrowRight');
        checkEqual('arrow moves focus', document.activeElement.id, 'tabBtnSublists');
        check('and activates', qs('#panelSublists').classList.contains('active'));
        checkEqual('roving tabindex', [oBody.tabIndex, document.activeElement.tabIndex], [-1, 0]);

        pressKey(document.activeElement, 'ArrowLeft');
        checkEqual('back', document.activeElement.id, 'tabBtnBody');

        const oTh = qs('#bodyFieldsTableOuter thead th');
        const oSpace = pressKey(oTh, ' ');

        checkEqual('Space sorts', oTh.getAttribute('aria-sort'), 'ascending');
        check('Space does not scroll', oSpace.defaultPrevented);

        pressKey(oTh, 'Enter');
        checkEqual('Enter sorts', oTh.getAttribute('aria-sort'), 'descending');

        const aIds = bodyIds();

        check('sorted descending', aIds[0] > aIds[aIds.length - 1], aIds.join());

        const oSpan = bodyRow('memo').querySelector('.col-id .clickable');

        pressKey(oSpan, 'Enter');
        await delay(10);
        checkEqual('Enter copies', oLog.clipboard[oLog.clipboard.length - 1], 'memo');

        await openTab('tabBtnSublists');
        pressKey(qs('#sublistTable .clickable'), ' ');
        await delay(10);
        checkEqual('Space copies a sublist target through the delegate', oLog.clipboard[oLog.clipboard.length - 1], 'item');

        const oCell = sublistLineRows()[1].cells[1].querySelector('.clickable');

        oCell.click();
        await delay(10);
        checkEqual('a cell copies its value', oLog.clipboard[oLog.clipboard.length - 1], '78');
    };

    SCENARIOS['legacy-search-and-anchors'] = async () => {

        const sXml = '<nsResponse><record recordType="invoice" id="1"><link>https://example.com/x</link><memo>findme here</memo></record></nsResponse>';

        oStorage.local.data.fex_viewMode = 'legacy';

        await boot({respond: async () => fixtureResponse(sXml)});
        await delay(0);

        const oAnchor = qs('#legacyTree a[href^="https://example.com"]');

        check('value anchors open a new tab', oAnchor?.target === '_blank' && oAnchor?.rel === 'noopener noreferrer');

        setSearch('findme');
        check('search narrows the tree', !qs('#legacyTree').textContent.includes('example.com'));
        check('and highlights', !!qs('#legacyTree .searchresult'));

        delete oStorage.local.data.fex_viewMode;
    };

    /* ──── Nav Manager (AC7, AC8, matrix 10, 12b) ──── */

    const openNav = async (pOptions = {}) => {

        await boot({tabUrl: RECORD_URL, respond: xmlResponder('invoice.xml'), sPageDom: pOptions.sPageDom || 'nav-flat.html', ...pOptions.oWorld});

        qs('#navManagerBtn').click();

        await waitFor(() => !!qs('#navTreeAll .nav-tree-item') || !!qs('#navTreeAll .nav-empty') || qs('#navPermissionGate').classList.contains('visible'), 3000, 'nav panel');
        await delay(10);
    };

    const navRow = (pTree, pLabel) => {

        return qsa(`#${pTree} .nav-tree-row`).find((pRow) => pRow.querySelector('.nav-tree-label').textContent === pLabel) || null;
    };

    const navCheckbox = (pTree, pLabel) => navRow(pTree, pLabel)?.querySelector('.nav-tree-cb') || null;

    const toggleCheckbox = async (pCheckbox) => {

        pCheckbox.click();
        await delay(10);
    };

    const resetNav = () => {

        delete oStorage.local.data.navHide_all;
        delete oStorage.local.data.navHide_1234567;
        oRegistry.clear();
        oWorld.hostGranted = true;
    };

    SCENARIOS['nav-dead-automation-id'] = async () => {

        resetNav();
        oStorage.local.data.navHide_all = [{key: 'dead-auto-id', id: 'dead-auto-id', label: 'Recent Records'}];

        await openNav();

        check('resolved rule shows checked', navCheckbox('navTreeAll', 'Recent Records').checked);
        check('not listed as an orphan', !qs('#navTreeAll .nav-orphans'));
        check('an unrelated item stays unchecked', !navCheckbox('navTreeAll', 'Lists').checked);

        const oAccountCb = navCheckbox('navTreeAccount', 'Recent Records');

        check('account tree shows it hidden globally', oAccountCb.checked && oAccountCb.disabled);

        await toggleCheckbox(navCheckbox('navTreeAll', 'Recent Records'));

        checkEqual('unchecking removes that rule', oStorage.local.data.navHide_all, []);
        check('stays unchecked after the repaint', !navCheckbox('navTreeAll', 'Recent Records').checked);
        check('no orphan after unchecking', !qs('#navTreeAll .nav-orphans'));
    };

    SCENARIOS['nav-dead-id-with-a-newer-duplicate'] = async () => {

        resetNav();
        oStorage.local.data.navHide_all = [
            {key: 'dead-auto-id', id: 'dead-auto-id', label: 'Lists'},
            {key: 'Lists', id: '', label: 'Lists'}
        ];

        await openNav();
        await toggleCheckbox(navCheckbox('navTreeAll', 'Lists'));

        checkEqual('one uncheck removes both', oStorage.local.data.navHide_all, []);
        check('and it stays unchecked', !navCheckbox('navTreeAll', 'Lists').checked);
    };

    SCENARIOS['nav-hider-real-selector'] = async () => {

        resetNav();
        oStorage.local.data.navHide_all = [{key: 'dead-auto-id', id: 'dead-auto-id', label: 'Recent Records'}];

        await boot({tabUrl: RECORD_URL, respond: xmlResponder('invoice.xml'), sPageDom: 'nav-flat.html'});
        await loadScript('js/navhider.js');
        await waitFor(() => !!qs('#fex-navhider-style'), 2000, 'navhider style');

        const fnDisplay = (pLabel) => getComputedStyle(qs(`#ns-page [role="menuitem"]:has(> a[aria-label="${pLabel}"])`)).display;

        checkEqual('hides the item with that label and no automation id', fnDisplay('Recent Records'), 'none');
        check('leaves the others', fnDisplay('Lists') !== 'none');

        const sCss = qs('#fex-navhider-style').textContent;

        check('emits both selectors', sCss.includes('data-automation-id="dead-auto-id"') && sCss.includes('aria-label="Recent\\ Records"'), sCss);
    };

    SCENARIOS['nav-orphans-still-listed'] = async () => {

        resetNav();
        oStorage.local.data.navHide_all = [{key: 'gone-id', id: 'gone-id', label: 'Gone Item'}];

        await openNav();

        check('truly absent rule is an orphan', qs('#navTreeAll .nav-orphans-header').textContent.includes('Not in current menu (1)'));

        const oHeader = qs('#navTreeAll .nav-orphans-header');

        checkEqual('orphan header starts collapsed', oHeader.getAttribute('aria-expanded'), 'false');
        check('role and tabindex', oHeader.getAttribute('role') === 'button' && oHeader.tabIndex === 0);

        pressKey(oHeader, 'Enter');
        checkEqual('Enter expands', oHeader.getAttribute('aria-expanded'), 'true');
        check('list visible', !qs('#navTreeAll .nav-orphans').classList.contains('collapsed'));

        const oSpace = pressKey(oHeader, ' ');

        checkEqual('Space collapses', oHeader.getAttribute('aria-expanded'), 'false');
        check('Space does not scroll', oSpace.defaultPrevented);

        qs('#navTreeAll .nav-orphan-btn').click();
        await delay(10);

        checkEqual('Unhide removes it', oStorage.local.data.navHide_all, []);
    };

    SCENARIOS['nav-new-rule-and-global-cleanup'] = async () => {

        resetNav();
        oStorage.local.data.navHide_1234567 = [{key: 'old-id', id: 'old-id', label: 'Lists'}];

        await openNav();

        check('account rule shows checked', navCheckbox('navTreeAccount', 'Lists').checked);

        await toggleCheckbox(navCheckbox('navTreeAll', 'Lists'));

        checkEqual('global rule written by label', oStorage.local.data.navHide_all, [{key: 'Lists', id: '', label: 'Lists'}]);
        checkEqual('duplicate account rule dropped', oStorage.local.data.navHide_1234567, []);
        check('account tree locked', navCheckbox('navTreeAccount', 'Lists').disabled);
        checkEqual('status line', qs('#navManagerStatus').textContent, 'Hiding 1 global menu items');
    };

    SCENARIOS['nav-search-nested'] = async () => {

        resetNav();

        await openNav({sPageDom: 'nav-nested.html'});

        const fnItem = (pTree, pLabel) => navRow(pTree, pLabel)?.closest('.nav-tree-item') || null;
        const fnIsOpen = (pLabel) => fnItem('navTreeAll', pLabel)?.classList.contains('expanded');
        const oSearch = qs('#navManagerSearch');
        const fnSearch = async (pTerm) => {

            oSearch.value = pTerm;
            oSearch.dispatchEvent(new Event('input'));
            await delay(200);
        };

        check('starts collapsed', !fnIsOpen('Reports'));

        await fnSearch('sales detail');

        check('search reveals the descendant', !!navRow('navTreeAll', 'Sales Detail'));
        check('parent renders expanded', fnIsOpen('Reports'));
        check('grandparent chain renders expanded', fnIsOpen('Sales Reports'));
        check('non-matching sibling hidden', !navRow('navTreeAll', 'Sales Summary') && !navRow('navTreeAll', 'Finance Reports'));
        checkEqual('toggle reflects forced state', fnItem('navTreeAll', 'Reports').querySelector('.nav-tree-toggle').getAttribute('aria-expanded'), 'true');

        await fnSearch('');

        check('saved expansion unchanged: closed again', !fnIsOpen('Reports'));

        await fnSearch('reports');

        check('matching parent stays', !!navRow('navTreeAll', 'Reports'));
        check('matching parent keeps all children', !!navRow('navTreeAll', 'Finance Reports') && !!navRow('navTreeAll', 'Sales Reports'));
        check('and grandchildren', !!navRow('navTreeAll', 'Sales Detail') && !!navRow('navTreeAll', 'Sales Summary'));
        check('unrelated top item filtered', !navRow('navTreeAll', 'Recent Records'));

        await fnSearch('setup-node');

        check('own match by automation id', !!navRow('navTreeAll', 'Setup Menu'));

        await fnSearch('');

        const oToggle = fnItem('navTreeAll', 'Reports').querySelector('.nav-tree-toggle');

        oToggle.click();
        check('user expansion works', fnIsOpen('Reports'));

        await fnSearch('recent');
        await fnSearch('');

        check('user expansion survives a search', fnIsOpen('Reports'));

        await fnSearch('sales detail');

        const oForcedToggle = fnItem('navTreeAll', 'Sales Reports').querySelector('.nav-tree-toggle');

        oForcedToggle.click();
        check('a forced branch can be closed by hand', !fnIsOpen('Sales Reports'));

        await fnSearch('');

        check('which leaves the saved set alone', !fnIsOpen('Sales Reports'));
    };

    SCENARIOS['nav-keyboard'] = async () => {

        resetNav();

        await openNav({sPageDom: 'nav-nested.html'});

        const oToggle = navRow('navTreeAll', 'Reports').querySelector('.nav-tree-toggle');

        checkEqual('toggle role', oToggle.getAttribute('role'), 'button');
        checkEqual('toggle tabindex', oToggle.tabIndex, 0);
        checkEqual('toggle aria-expanded', oToggle.getAttribute('aria-expanded'), 'false');

        pressKey(oToggle, 'Enter');
        checkEqual('Enter opens', oToggle.getAttribute('aria-expanded'), 'true');
        check('branch open', navRow('navTreeAll', 'Reports').closest('.nav-tree-item').classList.contains('expanded'));

        const oSpace = pressKey(oToggle, ' ');

        checkEqual('Space closes', oToggle.getAttribute('aria-expanded'), 'false');
        check('Space does not scroll', oSpace.defaultPrevented);

        const oSectionHeader = qs('.nav-section-header');

        checkEqual('section header role', oSectionHeader.getAttribute('role'), 'button');
        checkEqual('section header tabindex', oSectionHeader.tabIndex, 0);
        checkEqual('section header aria-expanded', oSectionHeader.getAttribute('aria-expanded'), 'true');

        pressKey(oSectionHeader, 'Enter');
        checkEqual('Enter collapses the section', oSectionHeader.getAttribute('aria-expanded'), 'false');
        check('section collapsed', oSectionHeader.closest('.nav-section').classList.contains('collapsed'));

        pressKey(oSectionHeader, ' ');
        checkEqual('Space expands it', oSectionHeader.getAttribute('aria-expanded'), 'true');

        pressKey(oSectionHeader, 'a');
        checkEqual('other keys do nothing', oSectionHeader.getAttribute('aria-expanded'), 'true');

        oSectionHeader.click();
        checkEqual('a click keeps aria-expanded in step', oSectionHeader.getAttribute('aria-expanded'), 'false');
        oSectionHeader.click();
    };

    SCENARIOS['nav-focus-retained-across-repaint'] = async () => {

        resetNav();

        await openNav();

        const oCheckbox = navCheckbox('navTreeAll', 'Lists');

        oCheckbox.focus();
        await toggleCheckbox(oCheckbox);

        const oReplacement = navCheckbox('navTreeAll', 'Lists');

        check('the node was replaced', oReplacement !== oCheckbox);
        check('focus moved to the replacement', document.activeElement === oReplacement);
        check('it reflects the save', oReplacement.checked);
    };

    SCENARIOS['nav-transaction-rollback'] = async () => {

        resetNav();

        await openNav();

        oStorage.local.failSetKeys = /^navHide_/;

        await toggleCheckbox(navCheckbox('navTreeAll', 'Lists'));

        oStorage.local.failSetKeys = null;

        check('rule rolled back', !navCheckbox('navTreeAll', 'Lists').checked);
        checkEqual('says so', qs('#navSaveError span').textContent, 'Could not save changes - try again.');
        checkEqual('nothing stored', oStorage.local.data.navHide_all, undefined);

        qs('#navSaveError button').click();
        check('dismissible', !qs('#navSaveError'));
    };

    SCENARIOS['nav-transaction-queue-order'] = async () => {

        resetNav();

        await openNav();

        const oFirst = navCheckbox('navTreeAll', 'Lists');
        const oSecond = navCheckbox('navTreeAll', 'Transactions');

        oFirst.click();
        oSecond.click();
        await delay(30);

        checkEqual('both rules land, in order', oStorage.local.data.navHide_all.map((pRule) => pRule.key), ['Lists', 'Transactions']);
        check('both show checked', navCheckbox('navTreeAll', 'Lists').checked && navCheckbox('navTreeAll', 'Transactions').checked);
    };

    SCENARIOS['nav-clear-all-two-step'] = async () => {

        resetNav();
        oStorage.local.data.navHide_all = [{key: 'Lists', id: '', label: 'Lists'}, {key: 'Transactions', id: '', label: 'Transactions'}];

        await openNav();

        const oClear = qs('#navTreeAll .nav-clear-btn');

        checkEqual('idle label', oClear.textContent, 'Clear all (2)');

        oClear.click();
        checkEqual('armed label', oClear.textContent, 'Confirm clear 2?');
        checkEqual('first click clears nothing', oStorage.local.data.navHide_all.length, 2);

        oClear.click();
        await delay(10);

        checkEqual('second click clears', oStorage.local.data.navHide_all, []);
    };

    SCENARIOS['nav-permission-gate'] = async () => {

        resetNav();

        await openNav({oWorld: {hostGranted: false}});

        check('gate shown', qs('#navPermissionGate').classList.contains('visible'));

        /* The menu scrape is the one inline function, named by its property */
        check('no menu scrape', !oLog.executed.some((pEntry) => pEntry.sName === 'func'));

        qs('#navGrantAccessBtn').click();
        await waitFor(() => !!qs('#navTreeAll .nav-tree-item'), 3000, 'panel after the grant');

        check('registered after the grant', oRegistry.has('fex-navhider'));
        check('the grant then scrapes the menu', oLog.executed.some((pEntry) => pEntry.sName === 'func'));
        check('panel replaces the gate', !qs('#navPermissionGate').classList.contains('visible'));
    };

    SCENARIOS['nav-registration-warning'] = async () => {

        resetNav();

        await openNav({oWorld: {registerFails: true}});

        checkEqual('warning strip', qs('#navRegWarning span').textContent, 'Automatic menu hiding may not be active.');
        check('rule editing still works', !!navCheckbox('navTreeAll', 'Lists'));

        oWorld.registerFails = false;
        qsa('#navRegWarning button')[0].click();
        await waitFor(() => !qs('#navRegWarning'), 2000, 'warning to clear');

        check('retry clears it', oRegistry.has('fex-navhider'));
    };

    SCENARIOS['nav-non-netsuite-tab'] = async () => {

        resetNav();

        await prepare();

        const nBefore = oLog.executed.length;

        await boot({tabUrl: 'https://www.example.com/', sPageDom: 'nav-flat.html'});

        qs('#navManagerBtn').click();
        await waitFor(() => !!qs('#navTreeAll .nav-empty'), 3000, 'empty tree');

        checkEqual('no scrape on a foreign page', oLog.executed.length, nBefore);
        checkEqual('account hint', qs('#navTreeAccount .nav-empty').textContent, 'Open a NetSuite account page to manage per-account rules');

        qs('#navManagerBack').click();
        checkEqual('the non-record message comes back', message().textContent, 'Not on a NetSuite page.');
    };

    SCENARIOS['nav-open-during-load-defers-render'] = async () => {

        resetNav();

        let fnRelease = null;

        await boot({
            sPageDom: 'nav-flat.html',
            bWait: false,
            respond: () => new Promise((pResolve) => {

                fnRelease = () => xmlResponder('invoice.xml')().then(pResolve);
            })
        });

        await waitFor(() => !!fnRelease, 2000, 'fetch to start');

        qs('#navManagerBtn').click();
        await waitFor(() => !!qs('#navTreeAll .nav-tree-item'), 2000, 'nav panel');

        await fnRelease();
        await delay(30);

        check('record panels stay hidden under the Nav Manager', qs('#container').style.display === 'none');

        qs('#navManagerBack').click();
        await delay(10);

        check('closing paints the record', bodyRows().length > 0);
        check('the record info is there', !!qs('#recordInfo .info-value'));
    };

    SCENARIOS['nav-open-during-load-defers-message'] = async () => {

        const aOutcomes = [
            ['non-record page', 'empty-msg', NO_RECORD_START, async () => fixtureResponse('<html/>', {sContentType: 'text/html'})],
            ['NetSuite error', 'error-msg', 'That record does not exist. (RCRD_DSNT_EXIST)', xmlResponder('error.xml', {nStatus: 500})],
            ['session failure', 'error-msg', SESSION_MESSAGE, async () => {

                throw new TypeError('Failed to fetch');
            }]
        ];
        const fnPanelBox = () => {

            const oBox = qs('#navManagerPanel').getBoundingClientRect();

            return [oBox.top, oBox.height];
        };
        const fnDisplay = (pSelector) => getComputedStyle(qs(pSelector)).display;

        for (const sView of ['new', 'legacy']) {

            for (const [sOutcome, sClass, sMessage, fnRespond] of aOutcomes) {

                const sCase = `${sView} view, ${sOutcome}`;
                const sHost = sView === 'legacy' ? '#legacyTree' : '#container';
                let fnRelease = null;

                /* A copy-forward from the previous case would otherwise roam its view mode back in */
                resetSettings();
                resetNav();
                oStorage.local.data.fex_viewMode = sView;

                await boot({
                    tabUrl: RECORD_URL,
                    sPageDom: 'nav-flat.html',
                    bWait: false,
                    respond: () => new Promise((pResolve, pReject) => {

                        fnRelease = () => fnRespond().then(pResolve, pReject);
                    })
                });

                await waitFor(() => !!fnRelease, 2000, 'fetch to start');

                qs('#navManagerBtn').click();
                await waitFor(() => !!qs('#navTreeAll .nav-tree-item'), 2000, 'nav panel');

                const aBefore = fnPanelBox();

                checkEqual(`${sCase}: panel fills the popup before the response`, aBefore, [0, document.documentElement.getBoundingClientRect().height]);

                await fnRelease();
                await delay(40);

                checkEqual(`${sCase}: panel box untouched`, fnPanelBox(), aBefore);
                checkEqual(`${sCase}: record containers stay hidden`, [fnDisplay('#container'), fnDisplay('#legacyContainer')], ['none', 'none']);
                checkEqual(`${sCase}: tree still there`, qsa('#navTreeAll .nav-tree-item').length, 3);
                check(`${sCase}: nothing painted yet`, !message());

                qs('#navManagerBack').click();
                await delay(10);

                const oShown = qs(`${sHost} .${sClass}`);

                check(`${sCase}: Back shows the message`, !!oShown && oShown.textContent.startsWith(sMessage), oShown?.textContent);
                checkEqual(`${sCase}: panel closed`, fnDisplay('#navManagerPanel'), 'none');
                checkEqual(`${sCase}: the right view shows`, [fnDisplay('#container') !== 'none', fnDisplay('#legacyContainer') !== 'none'], [sView === 'new', sView === 'legacy']);
                checkEqual(`${sCase}: tab bar stays hidden`, fnDisplay('#tabBar'), 'none');
                check(`${sCase}: exports disabled`, qs('#exportJsonBtn').disabled && qs('#exportCsvBtn').disabled);
            }
        }

        resetSettings();
    };

    /* ──── Screenshots: states only, tests/browser/screenshots.js takes the pictures ──── */

    const shotRecord = async (pOptions = {}) => {

        resetSettings();
        oStorage.local.data = {fex_settingsMigrated: true, fex_darkMode: pOptions.sTheme || 'off', ...(pOptions.oLocal || {})};

        await boot({respond: xmlResponder('invoice.xml'), sPageDom: 'invoice-view-dom.html', systemDark: false, ...(pOptions.oWorld || {})});
    };

    SCENARIOS['shot-legacy'] = async () => {

        await shotRecord({oLocal: {fex_viewMode: 'legacy'}});
        await delay(0);
        check('rendered', !!qs('#legacyTree .json-formatter-row'));
    };

    SCENARIOS['shot-body-dark'] = async () => {

        await shotRecord({sTheme: 'on', oLocal: {fex_showEmpty: true}});
        check('rendered', bodyRows().length > 0);
    };

    SCENARIOS['shot-sublists'] = async () => {

        await shotRecord();
        await openTab('tabBtnSublists');
        setSearch('widget');
        check('rendered', sublistLineRows().length > 0);
    };

    SCENARIOS['shot-raw'] = async () => {

        await shotRecord();
        await openTab('tabBtnRaw');
        check('rendered', !!qs('#rawJsonContainer .raw-json').textContent);
    };

    SCENARIOS['shot-nav'] = async () => {

        resetSettings();
        oStorage.local.data = {fex_settingsMigrated: true, fex_darkMode: 'off', navHide_all: [{key: 'Lists', id: '', label: 'Lists'}]};

        await openNav();
        check('rendered', !!navRow('navTreeAll', 'Lists'));
    };

    SCENARIOS['shot-compare'] = async () => {

        resetSettings();
        oStorage.local.data = {fex_settingsMigrated: true, fex_darkMode: 'off'};

        await pinThenOpenB();
        await openTab('tabBtnCompare');
        check('rendered', compareRows().length > 0);
    };

    /* ──────────── Runner ──────────── */

    const run = async () => {

        oHarness.scenarios = Object.keys(SCENARIOS);

        if (sScenario === '__list__') return;

        const fnScenario = SCENARIOS[sScenario];

        if (!fnScenario) throw new Error(`Unknown scenario "${sScenario}"`);

        await fnScenario();

        checkEqual('zero CSP violations', aCspViolations, []);
        checkEqual('zero page errors', aPageErrors, []);
    };

    run().catch((pErr) => {

        check('scenario ran to completion', false, pErr && pErr.stack ? pErr.stack : String(pErr));

    }).finally(() => {

        oHarness.done = true;
    });
})();
