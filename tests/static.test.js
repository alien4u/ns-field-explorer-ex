import {describe, expect, test} from 'bun:test';
import {existsSync, readFileSync} from 'node:fs';
import vm from 'node:vm';

const read = (pPath) => readFileSync(new URL(`../${pPath}`, import.meta.url), 'utf8');

const aFirstParty = ['js/background.js', 'js/boot.js', 'js/core.js', 'js/navhider.js', 'js/navmanager.js', 'js/popup.js',
    'js/shared.js'];
const oChrome = JSON.parse(read('manifest.json'));
const oFirefox = JSON.parse(read('manifest_firefox.json'));

describe('manifests', () => {

    test('both read 1.2.0', () => {

        expect(oChrome.version).toBe('1.2.0');
        expect(oFirefox.version).toBe('1.2.0');
    });

    test('no new permissions', () => {

        const aPermissions = ['activeTab', 'storage', 'scripting'];
        const aHosts = ['https://*.netsuite.com/*'];

        expect(oChrome.permissions).toEqual(aPermissions);
        expect(oFirefox.permissions).toEqual(aPermissions);
        expect(oChrome.optional_host_permissions).toEqual(aHosts);
        expect(oFirefox.optional_host_permissions).toEqual(aHosts);
        expect(oChrome.host_permissions).toBeUndefined();
        expect(oFirefox.host_permissions).toBeUndefined();
        expect(oChrome.web_accessible_resources).toBeUndefined();
    });

    test('each manifest keeps its own background form', () => {

        expect(oChrome.background).toEqual({service_worker: 'js/background.js'});
        expect(oFirefox.background).toEqual({scripts: ['js/shared.js', 'js/background.js']});
        expect(oFirefox.browser_specific_settings.gecko.strict_min_version).toBe('140.0');
        expect(oFirefox.browser_specific_settings.gecko_android.strict_min_version).toBe('142.0');
    });
});

describe('first-party source', () => {

    test('every file parses', () => {

        aFirstParty.forEach((pFile) => {

            expect(() => new vm.Script(read(pFile), {filename: pFile})).not.toThrow();
        });
    });

    test('no invisible BOM in the source: an editor or formatter could strip it unseen', () => {

        aFirstParty.forEach((pFile) => expect(read(pFile).includes('\uFEFF')).toBe(false));

        expect(read('js/core.js')).toContain(`const CSV_BOM = '\\ufeff';`);
    });

    test('no innerHTML, outerHTML, insertAdjacentHTML or eval', () => {

        aFirstParty.forEach((pFile) => {

            expect(read(pFile)).not.toMatch(/\.innerHTML|\.outerHTML|insertAdjacentHTML|\beval\(|new Function\(/);
        });
    });

    test('no var and no SuiteScript or REST: the extension stays zero governance', () => {

        aFirstParty.forEach((pFile) => {

            const sSource = read(pFile);

            expect(sSource).not.toMatch(/^\s*var\s/m);
            expect(sSource).not.toMatch(/nlapi[A-Z]\w*\(|require\(\[|\/services\/rest\/|runSuiteQL/);
        });
    });

    test('the record gate no longer keys on an id parameter', () => {

        expect(read('js/popup.js')).not.toMatch(/searchParams\.has\('id'\)/);
    });

    test('importScripts keeps its absolute path', () => {

        expect(read('js/background.js')).toContain('importScripts(\'/js/shared.js\')');
    });
});

describe('popup.html', () => {

    const sHtml = read('popup.html');

    test('loads core.js after shared.js and before popup.js', () => {

        const nShared = sHtml.indexOf('js/shared.js');
        const nCore = sHtml.indexOf('js/core.js');
        const nPopup = sHtml.indexOf('js/popup.js');

        expect(nShared).toBeGreaterThan(-1);
        expect(nCore).toBeGreaterThan(nShared);
        expect(nPopup).toBeGreaterThan(nCore);
    });

    test('the footer carries no hard-coded version', () => {

        expect(sHtml).not.toMatch(/v\d+\.\d+\.\d+/);
    });

    test('has no inline script', () => {

        expect(sHtml).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
        expect(sHtml).not.toMatch(/\son[a-z]+="/);
    });
});

describe('sponsor removal', () => {

    const rSponsor = /sponsor|spon-logo|utm_source/i;

    test('gone from everything that ships', () => {

        [...aFirstParty, 'popup.html', 'css/main.css', 'manifest.json', 'manifest_firefox.json', 'THIRD_PARTY_NOTICES.md']
            .forEach((pFile) => expect(rSponsor.test(read(pFile))).toBe(false));

        expect(existsSync(new URL('../img/spon-logo.png', import.meta.url))).toBe(false);
    });

    test('in the tracked docs only the removal note may mention it', () => {

        const aMentions = read('README.md').split('\n').filter((pLine) => /sponsor|spon-logo|utm_source/i.test(pLine));

        expect(aMentions).toEqual(['- Removed the sponsor footer; the footer version now comes from the manifest', '- Footer with sponsor branding']);
        expect(/sponsor/i.test(read('PRIVACY.md'))).toBe(false);
    });
});
