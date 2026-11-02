/**
 * Test doubles for the unit suite. The real source files run unmodified inside a node:vm context,
 * in the same order the extension loads them. All data is synthetic.
 */

import {readFileSync} from 'node:fs';
import vm from 'node:vm';

/**
 * Runs extension scripts in one fresh context, sharing lexical scope like classic scripts do.
 *
 * @param {Array<string>} pFiles - repo-relative paths
 * @param {Object} [pGlobals] - extra globals
 * @returns {{read: Function, oContext: Object}} read evaluates an expression in the context
 */
export const loadScripts = (pFiles, pGlobals = {}) => {

    const oContext = vm.createContext({
        console: {log: () => {}, warn: () => {}, error: () => {}},
        URL: URL,
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        AbortController: AbortController,
        chrome: {},
        ...pGlobals
    });

    pFiles.forEach((pFile) => {

        const sSource = readFileSync(new URL(`../${pFile}`, import.meta.url), 'utf8');

        vm.runInContext(sSource, oContext, {filename: pFile});
    });

    return {oContext: oContext, read: (pExpression) => vm.runInContext(pExpression, oContext)};
};

/**
 * Moves a value out of the vm realm so toEqual compares structure alone.
 *
 * @param {*} pValue
 * @returns {*}
 */
export const plain = (pValue) => JSON.parse(JSON.stringify(pValue));

/**
 * In-memory storage area double.
 *
 * @param {Object} [pInitial]
 * @returns {Object} area with data and writes for inspection, and failNext for failure injection
 */
export const createStorageArea = (pInitial = {}) => {

    const oArea = {
        data: {...pInitial},
        writes: [],
        failSet: null,
        failGet: null,
        get: async (pKeys) => {

            if (oArea.failGet) throw oArea.failGet;
            if (pKeys === null || pKeys === undefined) return {...oArea.data};

            const oResult = {};

            [].concat(pKeys).forEach((pKey) => {

                if (oArea.data[pKey] !== undefined) oResult[pKey] = oArea.data[pKey];
            });

            return oResult;
        },
        set: async (pValues) => {

            if (oArea.failSet) throw oArea.failSet;

            oArea.writes.push(pValues);
            Object.assign(oArea.data, pValues);
        },
        remove: async (pKeys) => {

            [].concat(pKeys).forEach((pKey) => delete oArea.data[pKey]);
        }
    };

    return oArea;
};

/**
 * Listener registry double for runtime and permission events.
 *
 * @returns {Object} event with addListener, and fire to call what was registered
 */
export const createEvent = () => {

    const aListeners = [];

    return {
        addListener: (pListener) => aListeners.push(pListener),
        fire: (...pArgs) => aListeners.map((pListener) => pListener(...pArgs)),
        count: () => aListeners.length
    };
};

/**
 * chrome.scripting + chrome.permissions double holding one content-script registry.
 *
 * @param {Object} [pOptions]
 * @param {boolean} [pOptions.bGranted]
 * @returns {Object} chrome-shaped API
 */
export const createExtensionApi = (pOptions = {}) => {

    const oApi = {
        registry: new Map(),
        calls: [],
        bGranted: pOptions.bGranted !== false,
        failRegister: null,
        failUpdate: null,
        storage: {local: createStorageArea(pOptions.local), sync: createStorageArea(pOptions.sync)},
        runtime: {onInstalled: createEvent(), onStartup: createEvent()},
        permissions: {
            onAdded: createEvent(),
            contains: async () => oApi.bGranted
        },
        scripting: {
            getRegisteredContentScripts: async (pFilter) => {

                return Array.from(oApi.registry.values()).filter((pEntry) => pFilter.ids.includes(pEntry.id));
            },
            registerContentScripts: async (pEntries) => {

                oApi.calls.push('register');

                if (oApi.failRegister) throw oApi.failRegister;

                pEntries.forEach((pEntry) => oApi.registry.set(pEntry.id, {...pEntry}));
            },
            updateContentScripts: async (pEntries) => {

                oApi.calls.push('update');

                if (oApi.failUpdate) throw oApi.failUpdate;

                pEntries.forEach((pEntry) => oApi.registry.set(pEntry.id, {...pEntry}));
            },
            unregisterContentScripts: async (pFilter) => {

                oApi.calls.push('unregister');
                pFilter.ids.forEach((pId) => oApi.registry.delete(pId));
            }
        }
    };

    return oApi;
};

/**
 * CSS.escape double covering what the selectors under test contain.
 *
 * @param {string} pValue
 * @returns {string}
 */
export const cssEscape = (pValue) => String(pValue).replace(/[^a-zA-Z0-9_-]/g, (pChar) => `\\${pChar}`);
