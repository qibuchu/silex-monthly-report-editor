import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateMonthlyData} from './validate.mjs';

const read=name=>JSON.parse(fs.readFileSync(new URL(name,import.meta.url),'utf8'));

test('both source examples obey the normalized monthly contract',()=>{
 assert.equal(read('./schema.json').$schema,'https://json-schema.org/draft/2020-12/schema');
 for(const name of ['./example-steamauto.json','./example-minigame.json'])assert.deepEqual(validateMonthlyData(read(name)),[],name);
});

test('window, D0-D13, null evidence and type errors are rejected',()=>{
 const source=read('./example-steamauto.json');
 const wrongMonth=structuredClone(source);wrongMonth.windows[0].end='2026-08-30';assert.match(validateMonthlyData(wrongMonth).join(' '),/自然月/);
 const wrongRelease=structuredClone(source);wrongRelease.windows[1].end='2026-09-08';assert.match(validateMonthlyData(wrongRelease).join(' '),/D0 至 D13/);
 const missingEvidence=structuredClone(source);missingEvidence.missing=[];assert.match(validateMonthlyData(missingEvidence).join(' '),/缺少 missing/);
 const mislabeled=structuredClone(source);mislabeled.metrics[0].value='100款';assert.match(validateMonthlyData(mislabeled).join(' '),/值与类型不符/);
});
