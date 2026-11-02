import {describe, expect, test} from 'bun:test';
import {createEvent, createExtensionApi, cssEscape, loadScripts} from './fakes.js';

const settle = () => new Promise((pResolve) => setTimeout(pResolve, 5));

/**
 * Runs navhider.js against a stub document on an account host.
 *
 * @param {Object} pLocal - storage.local contents
 * @param {Object} [pOverrides] - API overrides
 * @returns {{oApi: Object, styleText: Function}}
 */
const runNavhider = (pLocal, pOverrides = {}) => {

    const oApi = createExtensionApi({local: pLocal});

    oApi.storage.onChanged = createEvent();
    Object.assign(oApi.storage.local, pOverrides);

    const oElements = {};

    loadScripts(['js/shared.js', 'js/navhider.js'], {
        chrome: oApi,
        CSS: {escape: cssEscape},
        window: {location: {hostname: '1234567.app.netsuite.com'}},
        document: {
            head: {appendChild: (pEl) => { oElements[pEl.id] = pEl; }},
            documentElement: {},
            createElement: () => ({
                id: '',
                textContent: '',
                remove() {

                    delete oElements[this.id];
                }
            }),
            getElementById: (pId) => oElements[pId] || null
        }
    });

    return {oApi: oApi, styleText: () => oElements['fex-navhider-style']?.textContent ?? null};
};

describe('selectors', () => {

    test('a rule with both id and label emits both selectors', async () => {

        const {styleText} = runNavhider({navHide_all: [{key: 'X', id: 'X', label: 'Recent Records'}]});

        await settle();

        expect(styleText()).toContain('[role="menuitem"]:has(> a[data-automation-id="X"])');
        expect(styleText()).toContain('[role="menuitem"]:has(> a[aria-label="Recent\\ Records"])');
        expect(styleText()).toContain('display: none !important');
    });

    test('a label-only rule emits only the label selector, an id-only rule only the id selector', async () => {

        const oLabel = runNavhider({navHide_all: [{key: 'L', id: '', label: 'L'}]});
        const oId = runNavhider({navHide_all: [{key: 'I', id: 'I', label: ''}]});

        await settle();

        expect(oLabel.styleText()).not.toContain('data-automation-id');
        expect(oId.styleText()).not.toContain('aria-label');
    });

    test('no rules injects no style', async () => {

        const {styleText} = runNavhider({});

        await settle();

        expect(styleText()).toBe(null);
    });
});

describe('storage', () => {

    test('merges the global and account scopes, deduplicated by key', async () => {

        const {styleText} = runNavhider({
            navHide_all: [{key: 'A', id: '', label: 'A'}],
            navHide_1234567: [{key: 'A', id: '', label: 'A'}, {key: 'B', id: '', label: 'B'}],
            navHide_999: [{key: 'C', id: '', label: 'C'}]
        });

        await settle();

        expect(styleText().match(/aria-label="A"/g).length).toBe(1);
        expect(styleText()).toContain('aria-label="B"');
        expect(styleText()).not.toContain('aria-label="C"');
    });

    test('re-applies on a local navHide change and ignores everything else', async () => {

        const {oApi, styleText} = runNavhider({navHide_all: [{key: 'A', id: '', label: 'A'}]});

        await settle();

        oApi.storage.local.data.navHide_all = [{key: 'Z', id: '', label: 'Z'}];
        oApi.storage.onChanged.fire({fex_darkMode: {}}, 'local');
        await settle();
        expect(styleText()).toContain('aria-label="A"');

        oApi.storage.onChanged.fire({navHide_all: {}}, 'sync');
        await settle();
        expect(styleText()).toContain('aria-label="A"');

        oApi.storage.onChanged.fire({navHide_all: {}}, 'local');
        await settle();
        expect(styleText()).toContain('aria-label="Z"');
    });

    test('a failed storage read is caught, no unhandled rejection', async () => {

        let nUnhandled = 0;
        const fnCount = () => nUnhandled++;

        process.on('unhandledRejection', fnCount);

        const {styleText} = runNavhider({}, {get: async () => {

            throw new Error('storage gone');
        }});

        await settle();
        process.off('unhandledRejection', fnCount);

        expect(nUnhandled).toBe(0);
        expect(styleText()).toBe(null);
    });
});
