import {describe, expect, test} from 'bun:test';
import {loadScripts} from './fakes.js';

/**
 * Runs boot.js against a stub root and mirror.
 *
 * @param {Object} pMirror - localStorage contents
 * @param {boolean} pOsDark - OS prefers dark
 * @param {Object} [pStorageOverride] - replaces localStorage
 * @returns {{aClasses: Array<string>, oVars: Object}}
 */
const runBoot = (pMirror, pOsDark, pStorageOverride) => {

    const aClasses = [];
    const oVars = {};

    loadScripts(['js/boot.js'], {
        parseInt: parseInt,
        isNaN: isNaN,
        Math: Math,
        document: {
            documentElement: {
                classList: {add: (pClass) => aClasses.push(pClass)},
                style: {setProperty: (pName, pValue) => { oVars[pName] = pValue; }}
            }
        },
        localStorage: pStorageOverride || {getItem: (pKey) => (pKey in pMirror ? pMirror[pKey] : null)},
        window: {matchMedia: () => ({matches: pOsDark})}
    });

    return {aClasses: aClasses, oVars: oVars};
};

describe('pre-paint restore', () => {

    test('restores the mirrored size, clamped under the popup cap', () => {

        expect(runBoot({fex_popupWidth: '470', fex_popupHeight: '450'}, false).oVars)
            .toEqual({'--fe-width': '470px', '--fe-height': '450px'});
        expect(runBoot({fex_popupWidth: '5000', fex_popupHeight: '5000'}, false).oVars)
            .toEqual({'--fe-width': '792px', '--fe-height': '592px'});
        expect(runBoot({fex_popupWidth: '10', fex_popupHeight: '10'}, false).oVars)
            .toEqual({'--fe-width': '350px', '--fe-height': '300px'});
    });

    test('an empty mirror sets no size vars and falls through to the CSS defaults', () => {

        expect(runBoot({}, false).oVars).toEqual({});
    });

    test('theme table over mode and OS', () => {

        const aTable = [
            [null, false, false],
            [null, true, true],
            ['auto', false, false],
            ['auto', true, true],
            ['on', false, true],
            ['on', true, true],
            ['off', false, false],
            ['off', true, false]
        ];

        aTable.forEach(([pMode, pOsDark, pExpected]) => {

            const oMirror = pMode === null ? {} : {fex_darkMode: pMode};

            expect(runBoot(oMirror, pOsDark).aClasses.includes('theme-dark')).toBe(pExpected);
        });
    });

    test('compact mirror adds the compact class', () => {

        expect(runBoot({fex_compactMode: 'true'}, false).aClasses).toContain('fe-compact');
        expect(runBoot({fex_compactMode: 'false'}, false).aClasses).not.toContain('fe-compact');
    });

    test('localStorage throwing is swallowed: no classes, no vars', () => {

        const oThrowing = {
            getItem: () => {

                throw new Error('private window');
            }
        };
        const oResult = runBoot({}, true, oThrowing);

        expect(oResult.aClasses).toEqual([]);
        expect(oResult.oVars).toEqual({});
    });
});
