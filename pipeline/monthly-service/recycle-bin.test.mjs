import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createCore, tools} from './core.mjs';
import {createService} from './server.mjs';

const obj = (id, content, kind = 'text') => ({tagName: kind === 'table' ? 'table' : 'div', attributes: {'data-object-id': id, 'data-kind': kind, 'data-name': id, 'data-content-layer': 'manual'}, style: {left: '10px', top: id === 'board' ? '80px' : '10px', width: '400px', height: id === 'board' ? '200px' : '60px'}, content});
const template = () => ({format: 'steam-grapesjs-v2', deck: {css: '', notes: {template_origin: 'pptx', pptx_imports: [{filename: 't.pptx', pages: []}]}, pages: [{name: '9月榜单', width: 800, height: 450, background: '#fff', objects: [
  obj('board', '<tr><th>游戏</th><th>厂商</th></tr><tr><td>旧1</td><td>旧厂1</td></tr>', 'table')]}]}});

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'monthly-bin-'));
  const core = createCore({dataDir: dir, publicUrl: 'http://127.0.0.1:4320'});
  const created = core.importPptxTemplate({title: '回收站验证', project: template()});
  const source = {name: '本月', reportMonth: '2026-09', tables: [{name: '榜单', columns: ['游戏', '厂商'], rows: [['新1', '新厂1']]}], scalars: []};
  const imported = await core.call('import_template_data', {templateId: created.templateId, baseRevision: 0, templateRevision: 0, projectRevision: 1, month: '2026-09', confirmedWindow: true, sources: [source]});
  const mapping = {id: 'board', kind: 'table', sourceId: imported.sources[0].tables[0].id, columnMap: [0, 1]};
  const draft = await core.call('generate_template_data_preview', {templateId: created.templateId, baseRevision: imported.revision, templateRevision: 0, projectRevision: 1, mappings: [mapping]});
  return {dir, core, created, draft};
}

test('recycle-bin tools are registered with accurate hints', () => {
  const byName = Object.fromEntries(tools.map(t => [t.name, t]));
  assert.equal(byName.delete_project.annotations.destructiveHint, true);
  assert.equal(byName.list_deleted_projects.annotations.readOnlyHint, true);
  assert.ok(byName.restore_deleted_project);
});

test('a data draft moves to the recycle bin, disappears from the list, and can be restored intact', async () => {
  const {dir, core, draft} = await setup();
  try {
    const before = core.project(draft.projectId);
    const result = await core.call('delete_project', {projectId: draft.projectId, baseRevision: before.revision});
    assert.deepEqual([result.deleted, result.restorable], [true, true]);
    assert.ok(!(await core.call('list_projects', {})).some(p => p.id === draft.projectId));
    assert.throws(() => core.project(draft.projectId), /not found/i);
    const bin = await core.call('list_deleted_projects', {});
    assert.equal(bin.length, 1);
    assert.equal(bin[0].id, draft.projectId);
    assert.ok(bin[0].deletedAt && bin[0].pageCount >= 1);
    // The bin survives a restart.
    const reopened = createCore({dataDir: dir, publicUrl: 'http://127.0.0.1:4320'});
    assert.equal((await reopened.call('list_deleted_projects', {})).length, 1);
    const restored = await reopened.call('restore_deleted_project', {projectId: draft.projectId});
    assert.equal(restored.restored, true);
    assert.equal(reopened.project(draft.projectId).revision, before.revision);
    assert.equal(JSON.stringify(reopened.project(draft.projectId).project), JSON.stringify(before.project));
    assert.equal((await reopened.call('list_deleted_projects', {})).length, 0);
    await assert.rejects(reopened.call('restore_deleted_project', {projectId: draft.projectId}), e => e.status === 404);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('template edit drafts, stale revisions and the current AI target are protected', async () => {
  const {dir, core, created, draft} = await setup();
  try {
    const templateProject = core.project(created.projectId);
    assert.equal(templateProject.kind, 'template-draft');
    await assert.rejects(core.call('delete_project', {projectId: created.projectId, baseRevision: templateProject.revision}), e => e.status === 400);
    assert.ok(core.project(created.projectId), 'template edit draft untouched');
    const current = core.project(draft.projectId);
    await assert.rejects(core.call('delete_project', {projectId: draft.projectId, baseRevision: current.revision + 1}), e => e.status === 409);
    const target = 'local-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    await core.call('set_editing_target', {editingTargetId: target, projectId: draft.projectId, baseRevision: 0});
    await assert.rejects(core.call('delete_project', {projectId: draft.projectId, baseRevision: current.revision}), e => e.status === 409 && /AI编辑目标/.test(e.message));
    assert.ok(core.project(draft.projectId), 'selected draft untouched');
    await assert.rejects(core.call('delete_project', {projectId: '00000000-0000-4000-8000-000000000000', baseRevision: 1}), e => e.status === 404);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('old preview and editor links explain that a draft can be restored', async () => {
  const {dir, core, draft} = await setup();
  const current = core.project(draft.projectId);
  await core.call('delete_project', {projectId: draft.projectId, baseRevision: current.revision});
  const {server} = createService({host:'127.0.0.1', publicUrl:'http://127.0.0.1:4320', dataDir:dir, token:'test-token', backupIntervalHours:0, workspaceRoot:path.resolve(import.meta.dirname,'../..')});
  try {
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const url of [`/preview/${draft.projectId}`, `/editor?project=${draft.projectId}`]) {
      const response = await fetch(base+url,{headers:{Authorization:'Bearer test-token'}});
      assert.equal(response.status,410);
      assert.match(await response.text(),/回收站.*恢复|恢复.*回收站/s);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
