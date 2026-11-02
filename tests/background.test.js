import {describe, expect, test} from 'bun:test';
import {createExtensionApi, loadScripts} from './fakes.js';

/* Waits for the fire-and-forget async work a listener started */
const settle = () => new Promise((pResolve) => setTimeout(pResolve, 5));

const load = (pApi) => loadScripts(['js/shared.js', 'js/background.js'], {chrome: pApi});

describe('update from 1.1.1 storage', () => {

    const oProfile = {
        navHide_all: ['legacyid', {key: 'k1', id: 'k1', label: 'One'}],
        navHide_123: ['acct-rule'],
        navHide_: ['dead'],
        fex_darkMode: true
    };

    test('rewrites rule arrays to object form and drops the dead key', async () => {

        const oApi = createExtensionApi({local: oProfile});

        load(oApi);
        oApi.runtime.onInstalled.fire();
        await settle();

        const oData = oApi.storage.local.data;

        expect(oData.navHide_all).toEqual([
            {key: 'legacyid', id: 'legacyid', label: ''},
            {key: 'k1', id: 'k1', label: 'One'}
        ]);
        expect(oData.navHide_123).toEqual([{key: 'acct-rule', id: 'acct-rule', label: ''}]);
        expect(oData.navHide_).toBeUndefined();
        expect(oData.navHide_schemaVersion).toBe(2);
    });

    test('a second onInstalled is a no-op', async () => {

        const oApi = createExtensionApi({local: oProfile});

        load(oApi);
        oApi.runtime.onInstalled.fire();
        await settle();

        const nWrites = oApi.storage.local.writes.length;

        oApi.storage.local.data.navHide_all = ['written-after-migration'];
        oApi.runtime.onInstalled.fire();
        await settle();

        expect(oApi.storage.local.writes.length).toBe(nWrites);
        expect(oApi.storage.local.data.navHide_all).toEqual(['written-after-migration']);
    });

    test('a storage failure during migration does not escape', async () => {

        const oApi = createExtensionApi({local: oProfile});

        oApi.storage.local.failSet = new Error('quota');
        load(oApi);
        oApi.runtime.onInstalled.fire();
        await settle();

        expect(oApi.storage.local.data.navHide_schemaVersion).toBeUndefined();
    });
});

describe('registration triggers', () => {

    test('onInstalled, onStartup and permissions.onAdded all reach the registration', async () => {

        for (const sEvent of ['onInstalled', 'onStartup', 'onAdded']) {

            const oApi = createExtensionApi();

            load(oApi);

            (sEvent === 'onAdded' ? oApi.permissions.onAdded : oApi.runtime[sEvent]).fire();
            await settle();

            expect(oApi.registry.has('fex-navhider')).toBe(true);
        }
    });

    test('in a worker it imports shared.js by absolute path, on an event page it does not try', () => {

        const aImported = [];
        const oApi = createExtensionApi();

        loadScripts(['js/shared.js', 'js/background.js'], {
            chrome: oApi,
            importScripts: (pPath) => aImported.push(pPath)
        });

        expect(aImported).toEqual(['/js/shared.js']);

        expect(() => load(createExtensionApi())).not.toThrow();
    });
});
