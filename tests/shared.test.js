import {describe, expect, test} from 'bun:test';
import {createExtensionApi, loadScripts, plain} from './fakes.js';

const load = (pApi) => loadScripts(['js/shared.js'], {chrome: pApi || createExtensionApi()});

describe('hostname and key helpers', () => {

    const {read} = load();

    test('isNetSuiteHostname parses the host rather than substring-matching', () => {

        const fnCheck = read('isNetSuiteHostname');

        expect(fnCheck('1234567.app.netsuite.com')).toBe(true);
        expect(fnCheck('NETSUITE.COM')).toBe(true);
        expect(fnCheck('netsuite.com.evil.example')).toBe(false);
        expect(fnCheck('notnetsuite.com')).toBe(false);
        expect(fnCheck('')).toBe(false);
    });

    test('getAccountIdFromHostname reads only the app host form', () => {

        const fnAccount = read('getAccountIdFromHostname');

        expect(fnAccount('1234567_SB1.app.netsuite.com')).toBe('1234567_SB1');
        expect(fnAccount('system.netsuite.com')).toBe('');
    });

    test('buildNavHideKey maps scopes and refuses an empty one', () => {

        const fnKey = read('buildNavHideKey');

        expect(fnKey('all')).toBe('navHide_all');
        expect(fnKey('123')).toBe('navHide_123');
        expect(fnKey('')).toBe('');
    });

    test('normalizeHiddenItem handles legacy strings, objects and junk', () => {

        const fnNormalize = read('normalizeHiddenItem');

        expect(plain(fnNormalize('abc'))).toEqual({key: 'abc', id: 'abc', label: ''});
        expect(plain(fnNormalize({key: 'k', label: 'L'}))).toEqual({key: 'k', id: '', label: 'L'});
        expect(fnNormalize('')).toBe(null);
        expect(fnNormalize({label: 'no key'})).toBe(null);
    });

    test('fexDebounce only runs after calls stop', async () => {

        const fnDebounce = read('fexDebounce');
        let nCalls = 0;
        const fnWrapped = fnDebounce(() => nCalls++, 10);

        fnWrapped();
        fnWrapped();
        fnWrapped();
        expect(nCalls).toBe(0);
        await new Promise((pResolve) => setTimeout(pResolve, 30));
        expect(nCalls).toBe(1);
    });
});

describe('ensureNavhiderRegistered', () => {

    test('reports no-permission and touches nothing', async () => {

        const oApi = createExtensionApi({bGranted: false});

        expect(await load(oApi).read('ensureNavhiderRegistered')()).toBe('no-permission');
        expect(oApi.calls).toEqual([]);
    });

    test('registers when absent, with both files at document_start', async () => {

        const oApi = createExtensionApi();

        expect(await load(oApi).read('ensureNavhiderRegistered')()).toBe('ok');
        expect(oApi.calls).toEqual(['register']);

        const oEntry = oApi.registry.get('fex-navhider');

        expect(oEntry.js).toEqual(['js/shared.js', 'js/navhider.js']);
        expect(oEntry.runAt).toBe('document_start');
        expect(oEntry.persistAcrossSessions).toBe(true);
    });

    test('updates a stale registration in place, no unregister window', async () => {

        const oApi = createExtensionApi();

        oApi.registry.set('fex-navhider', {
            id: 'fex-navhider',
            js: ['js/navhider.js'],
            matches: ['https://*.netsuite.com/*'],
            runAt: 'document_start',
            persistAcrossSessions: true
        });

        expect(await load(oApi).read('ensureNavhiderRegistered')()).toBe('ok');
        expect(oApi.calls).toEqual(['update']);
        expect(oApi.registry.get('fex-navhider').js).toEqual(['js/shared.js', 'js/navhider.js']);
    });

    test('leaves a correct registration alone, and Firefox omitting persistAcrossSessions is not a mismatch', async () => {

        const oApi = createExtensionApi();

        oApi.registry.set('fex-navhider', {
            id: 'fex-navhider',
            js: ['js/shared.js', 'js/navhider.js'],
            matches: ['https://*.netsuite.com/*'],
            runAt: 'document_start'
        });

        expect(await load(oApi).read('ensureNavhiderRegistered')()).toBe('ok');
        expect(oApi.calls).toEqual([]);
    });

    test('a duplicate-id rejection is ok when the live registration is right', async () => {

        const oApi = createExtensionApi();
        const fnRegister = oApi.scripting.registerContentScripts;

        oApi.scripting.registerContentScripts = async (pEntries) => {

            await fnRegister(pEntries);
            throw new Error('Duplicate script ID');
        };

        expect(await load(oApi).read('ensureNavhiderRegistered')()).toBe('ok');
    });

    test('a real registration failure reports failed without throwing', async () => {

        const oApi = createExtensionApi();

        oApi.failRegister = new Error('no');

        expect(await load(oApi).read('ensureNavhiderRegistered')()).toBe('failed');
    });
});
