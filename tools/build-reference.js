/**
 * Generates data/records-reference.json from Oracle's records reference.
 *
 * Usage: bun tools/build-reference.js [path/to/records.json]
 * Default source: the netsuite-suitescript-records-reference skill's references/records.json.
 *
 * Output shape: {type: {f: {id: [label, type, required]}, s: {sublist: {id: [label, type]}}}}
 * required is 1 or 0. Records with nothing to contribute are left out.
 */

import {readFileSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const sSkillFile = 'skills/netsuite-suitescript-records-reference/references/records.json';
const sSource = process.argv[2] || join(homedir(), '.claude', sSkillFile);
const sTarget = resolve(dirname(fileURLToPath(import.meta.url)), '../data/records-reference.json');

const oRecords = JSON.parse(readFileSync(sSource, 'utf8')).records;
const oOutput = {};

Object.keys(oRecords).sort().forEach((pType) => {

    /* Oracle's two "<use script id of your desired ...>" entries are instructions, not records */
    if (pType.startsWith('<')) return;

    const oRecord = oRecords[pType];
    const oFields = {};
    const oSublists = {};

    (oRecord.fields || []).forEach((pField) => {

        oFields[pField.internalId] = [pField.label || '', pField.type || '', pField.required === 'true' ? 1 : 0];
    });

    (oRecord.sublists || []).forEach((pSublist) => {

        const oColumns = {};

        (pSublist.fields || []).forEach((pField) => {

            oColumns[pField.internalId] = [pField.label || '', pField.type || ''];
        });

        if (Object.keys(oColumns).length > 0) oSublists[pSublist.internalId] = oColumns;
    });

    const bHasFields = Object.keys(oFields).length > 0;
    const bHasSublists = Object.keys(oSublists).length > 0;

    if (!bHasFields && !bHasSublists) return;

    oOutput[pType] = {};

    if (bHasFields) oOutput[pType].f = oFields;
    if (bHasSublists) oOutput[pType].s = oSublists;
});

const sJson = JSON.stringify(oOutput);

writeFileSync(sTarget, sJson + '\n');

console.log(`${sTarget}: ${Object.keys(oOutput).length} records, ${sJson.length} bytes`);
