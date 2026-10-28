import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createCore} from './core.mjs';
import {niceAxis, renderDeclaredChart} from './template-chart-render.mjs';
import {annotateMappings, resolveMappings, normalizeMappings} from './template-data.mjs';
import {matchSourceViews} from './minigame-data-fields.mjs';

const rects = svg => [...svg.matchAll(/<rect x="([-\d.e]+)" y="([-\d.e]+)" width="([-\d.e]+)" height="([-\d.e]+)"/g)].map(m => m.slice(1).map(Number));
const texts = svg => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(m => m[1]);

test('nice axis uses 1/2/5 steps and integer steps for counts', () => {
  assert.deepEqual(niceAxis(868.9), {max: 1000, step: 200, ticks: 5});
  assert.deepEqual(niceAxis(11.55, 5, true), {max: 12, step: 2, ticks: 6});
  assert.deepEqual(niceAxis(21106, 5, true), {max: 25000, step: 5000, ticks: 5});
  assert.equal(niceAxis(3, 5, true).step, 1);
});

test('stacked bars stay inside the plot, show segment and total labels, and empty categories say 数据待补', () => {
  const chart = {type: 'combo', legend: true, stackTotals: true, categories: ['6月', '7月', '8月'], series: [
    {name: '抖音信息流', render: 'bar', stack: '抖音', values: [null, 194.2, 283.6], labels: ['', '194.2', '283.6']},
    {name: '抖音达人', render: 'bar', stack: '抖音', values: [null, 615.9, 543.9], labels: ['', '615.9', '543.9']},
    {name: '微信信息流', render: 'bar', stack: '微信', values: [null, 278.8, 286], labels: ['', '278.8', '286']},
    {name: '抖音游戏数', render: 'line', axis: 'right', values: [null, 18894, 19698], labels: ['', '18,894', '19,698']},
  ]};
  const svg = renderDeclaredChart(chart, 1185, 602);
  const top = Math.max(11, Math.min(20, 602 / 25)) * 2.6;
  for (const [, y, , h] of rects(svg).filter(r => r[3] > 0)) assert.ok(y >= top - 0.5, `bar top ${y} above plot ${top}`);
  const t = texts(svg);
  assert.ok(t.includes('810.1'), 'stack total for 7月');
  assert.ok(t.includes('827.5'), 'stack total for 8月');
  assert.ok(t.includes('283.6') && t.includes('19,698'));
  assert.ok(t.includes('数据待补'));
  assert.ok(!t.some(x => /^\d+\.\d+$/.test(x) && ['689.8', '22508.6'].includes(x)), 'no raw max ticks');
  assert.ok(t.includes('1,000') || t.includes('900'), 'left axis covers stacked total');
});

test('hbar counts render integer ticks', () => {
  const svg = renderDeclaredChart({type: 'hbar', legend: false, categories: ['沙画like', '收纳三消'], series: [{name: '数量', render: 'bar', values: [11, 5], labels: ['11（+3）', '5（-1）']}]}, 891, 620);
  const ticks = texts(svg).filter(x => /^[\d,.]+$/.test(x));
  assert.ok(ticks.every(x => !x.includes('.')), ticks.join(' '));
});

test('mappings re-resolve by field path / table and column names after fields are inserted', () => {
  const before = [{id: 's0', name: 'api', tables: [{id: 's0t0', name: 'bestseller', columns: ['game', 'publisher'], rows: [['A', 'X']]}], scalars: [
    {id: 's0v0', path: 'adx_kpi.wechat_material_growth', label: 'g', value: '-7.4%'}]}];
  const saved = annotateMappings([{id: 'kpi', kind: 'text', sourceId: 's0v0'}, {id: 'tbl', kind: 'table', sourceId: 's0t0', columnMap: [1, 0, -1]}], before);
  assert.equal(saved[0].sourcePath, 'adx_kpi.wechat_material_growth');
  assert.deepEqual(saved[1].columnNames, ['publisher', 'game', null]);
  const after = [{id: 's0', name: 'api', tables: [{id: 's0t0', name: 'coverage', columns: ['k'], rows: []}, {id: 's0t1', name: 'bestseller', columns: ['rank', 'game', 'publisher'], rows: [['1', 'A', 'X']]}], scalars: [
    {id: 's0v0', path: 'adx_kpi.douyin_talent_total', label: 't', value: '4164601'}, {id: 's0v1', path: 'adx_kpi.wechat_material_growth', label: 'g', value: '-7.4%'}]}];
  const resolved = resolveMappings(saved, after);
  assert.equal(resolved[0].sourceId, 's0v1');
  assert.equal(resolved[1].sourceId, 's0t1');
  assert.deepEqual(resolved[1].columnMap, [2, 1, -1]);
  assert.throws(() => resolveMappings([{id: 'k', kind: 'text', sourceId: 's0v0', sourcePath: 'adx_kpi.missing'}], after), /字段不存在：adx_kpi\.missing/);
  // A stale id with a stored path is corrected rather than overwritten.
  assert.equal(normalizeMappings([{id: 'kpi', kind: 'text', sourceId: 's0v0', sourcePath: 'adx_kpi.wechat_material_growth'}], after)[0].sourceId, 's0v1');
});

test('rule-draft preview keeps image slots empty when earlier same-month drafts only hold the template image', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'monthly-image-carry-'));
  try {
    const core = createCore({dataDir: dir, publicUrl: 'http://127.0.0.1:4320'});
    const obj = (id, content, kind) => ({tagName: kind === 'table' ? 'table' : 'div', attributes: {'data-object-id': id, 'data-kind': kind, 'data-name': id, 'data-content-layer': 'manual', 'data-refresh-policy': 'preserve'}, style: {left: '10px', top: id === 'board' ? '80px' : '10px', width: '400px', height: id === 'board' ? '200px' : '60px'}, content});
    const project = {format: 'steam-grapesjs-v2', deck: {css: '', notes: {template_origin: 'pptx', pptx_imports: [{filename: 't.pptx', pages: []}]}, pages: [{name: '9月榜单', width: 800, height: 450, background: '#fff', objects: [
      obj('board', '<tr><th>游戏</th><th>厂商</th></tr><tr><td>旧1</td><td>旧厂1</td></tr>', 'table'),
      obj('slide-3-image-158', '<img src="http://127.0.0.1:4320/api/projects/tpl/assets/aaa.png">', 'image')]}]}};
    const {templateId} = core.importPptxTemplate({title: '图片沿用', project});
    const source = {name: '本月', reportMonth: '2026-09', tables: [{name: '榜单', columns: ['游戏', '厂商'], rows: [['新1', '新厂1']]}], scalars: []};
    const imported = await core.call('import_template_data', {templateId, baseRevision: 0, templateRevision: 0, projectRevision: 1, month: '2026-09', confirmedWindow: true, sources: [source]});
    const mapping = {id: 'board', kind: 'table', sourceId: imported.sources[0].tables[0].id, columnMap: [0, 1]};
    // A plain data preview copies the template image into a same-month project.
    const dataPreview = await core.call('generate_template_data_preview', {templateId, baseRevision: imported.revision, templateRevision: 0, projectRevision: 1, mappings: [mapping]});
    assert.match(JSON.stringify(core.project(dataPreview.projectId).project), /aaa\.png/);
    const canvas = await core.call('get_visual_rule_canvas', {templateId, pageIndex: 0});
    const rules = {...canvas.rules, visual: true, regions: [], objects: canvas.rules.objects.map(o => ({...o, mode: o.id === 'slide-3-image-158' ? 'blank' : 'auto'}))};
    const draft = await core.call('save_visual_rule_draft', {templateId, baseRevision: 0, projectRevision: 1, templateRevision: 0, dataRevision: dataPreview.dataRevision, rules, mappings: [mapping]});
    const preview = await core.call('preview_visual_rule_draft', {templateId, draftRevision: draft.revision});
    const image = core.project(preview.projectId).project.deck.pages[0].objects.find(o => o.attributes['data-object-id'] === 'slide-3-image-158');
    assert.match(image.content, /data-image-slot="true"/);
    // A human upload in an earlier same-month report is still carried over.
    const earlier = core.project(preview.projectId), edited = structuredClone(earlier.project);
    edited.deck.pages[0].objects.find(o => o.attributes['data-object-id'] === 'slide-3-image-158').content = '<div class="imagebox"><img src="data:image/png;base64,iVBORw0KGgo="></div>';
    core.save(earlier.id, earlier.revision, edited, 'operator');
    const again = await core.call('preview_visual_rule_draft', {templateId, draftRevision: draft.revision});
    const carried = core.project(again.projectId).project.deck.pages[0].objects.find(o => o.attributes['data-object-id'] === 'slide-3-image-158');
    assert.match(carried.content, /data:image\/png/);
    // Saved mappings carry stable names.
    const stored = (await core.call('get_visual_rule_canvas', {templateId, pageIndex: 0})).mappings[0];
    assert.equal(stored.sourceTable, '榜单');
    assert.deepEqual(stored.columnNames, ['游戏', '厂商']);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('new-game tables follow featured_rank when the interface provides it', () => {
  const source = {name: 'api', origin: 'http://x/minigame-db/api/report/monthly/export?month=2026-09', scalars: [], tables: [
    {id: 's0t0', name: 'new_games.bestseller', columns: ['game_name', 'featured_rank'], rows: [['A', '3'], ['B', ''], ['C', '1'], ['D', '2']]},
    {id: 's0t1', name: 'new_games.most_played', columns: ['game_name'], rows: [['X'], ['Y']]}]};
  const [view] = matchSourceViews([source]);
  assert.deepEqual(view.tables[0].rows.map(r => r[0]), ['C', 'D', 'A', 'B']);
  assert.deepEqual(view.tables[1].rows.map(r => r[0]), ['X', 'Y']);
});

test('new-game tables follow featured_rank when the interface provides it', () => {
  const source = {name: 'api', origin: 'http://x/minigame-db/api/report/monthly/export?month=2026-09', scalars: [], tables: [
    {id: 's0t0', name: 'new_games.bestseller', columns: ['game_name', 'featured_rank'], rows: [['A', '3'], ['B', ''], ['C', '1'], ['D', '2']]},
    {id: 's0t1', name: 'new_games.most_played', columns: ['game_name'], rows: [['X'], ['Y']]}]};
  const [view] = matchSourceViews([source]);
  assert.deepEqual(view.tables[0].rows.map(r => r[0]), ['C', 'D', 'A', 'B']);
  assert.deepEqual(view.tables[1].rows.map(r => r[0]), ['X', 'Y']);
});
