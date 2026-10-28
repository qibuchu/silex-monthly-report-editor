import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pruneReleases} from './prune-releases.mjs';

test('retains current and previous code, removes old releases and archives, preserves state', () => {
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'monthly-prune-'));
  try {
    const releases=path.join(base,'releases');fs.mkdirSync(releases);
    for(const name of ['20261028-01','20261028-02','20261028-03'])fs.mkdirSync(path.join(releases,name));
    fs.writeFileSync(path.join(releases,'server-20261028-01.tar.gz'),'archive');
    fs.mkdirSync(path.join(base,'state'));fs.writeFileSync(path.join(base,'state','store.json'),'data');
    const removed=pruneReleases(base,'releases/20261028-02','releases/20261028-03');
    assert.deepEqual(removed.sort(),['20261028-01','server-20261028-01.tar.gz']);
    assert.equal(fs.existsSync(path.join(releases,'20261028-02')),true);
    assert.equal(fs.existsSync(path.join(releases,'20261028-03')),true);
    assert.equal(fs.readFileSync(path.join(base,'state','store.json'),'utf8'),'data');
  } finally { fs.rmSync(base,{recursive:true,force:true}); }
});
