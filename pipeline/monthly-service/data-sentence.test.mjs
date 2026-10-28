import test from 'node:test';
import assert from 'node:assert/strict';
import {renderSentence, validateSentence} from './data-sentence.mjs';
import {fillTemplateData} from './template-data.mjs';
import {validateRules} from './templates.mjs';

const tables = [
  {id: 's0t0', name: 'iap.top50.rows', columns: ['genre', 'current_count', 'previous_count', 'delta'], rows: [
    ['模拟经营', '7', '3', '4'], ['二合', '6', '6', '0'], ['SLG', '6', '7', '-1'], ['开箱子like', '5', '8', '-3'], ['轰隆隆like', '3', '1', '2']]},
  {id: 's0t1', name: 'bestseller', role: 'bestseller', columns: ['game_name', 'avg_rank', 'previous_avg_rank', 'rank_delta', 'avg_plan', 'previous_avg_plan', 'plan_delta_pct'], rows: [
    ['向僵尸开炮', '1.5', '1.4', '-0.1', '21558.5', '29511.6', '-26.9'], ['向末日开炮', '8.4', '15.5', '7.1', '27874', '7125.8', '291.2'], ['天命行者', '21.7', '14.1', '-7.6', '6384.5', '6405.4', '-0.3'], ['新游', '30', '', '', '10', '', '']]},
  {id: 's0t2', name: 'new_games.bestseller', columns: ['game_name', 'first_buying_date', 'first_entry_date', 'avg_rank', 'best_rank', 'days_on_chart', 'avg_material', 'avg_plan'], rows: [
    ['工匠小能手', '2026-07-19', '2026-09-01', '42.9', '29', '30', '1372.3', '4964.8'], ['下方了', '2025-12-17', '2026-09-08', '55.8', '17', '30', '215.2', '674.3']]},
];
const scalars = [{id: 's0v0', path: 'adx_kpi.douyin_info_flow_growth_pct', label: 'x', value: '-16.3'}, {id: 's0v1', path: 'adx_kpi.douyin_talent_growth_pct', label: 'y', value: '-23.4'}];
const ctx = {tables, scalars, month: '2026-09'};

test('genre movers sentence lists gainers and decliners with counts', () => {
  const spec = {template: '{#up}；{#down}', lists: {
    up: {source: 'iap.top50.rows', where: [{field: 'delta', op: '>', value: 0}], sort: {by: 'delta', order: 'desc'}, limit: 2, item: '{genre}新增{delta}款（{previous_count}→{current_count}）'},
    down: {source: 'iap.top50.rows', where: [{field: 'delta', op: '<', value: 0}], sort: {by: 'delta', order: 'asc'}, limit: 2, item: '{genre}收缩（{previous_count}→{current_count}）'}}};
  assert.equal(renderSentence(spec, ctx).text, '模拟经营新增4款（3→7）、轰隆隆like新增2款（1→3）；开箱子like收缩（8→5）、SLG收缩（7→6）');
});

test('top mover row with numeric formats; nulls are skipped by where and never invented', () => {
  const spec = {source: 'bestseller', where: [{field: 'rank_delta', op: 'notnull'}], sort: {by: 'rank_delta', order: 'desc'}, row: 0,
    template: '《{game_name}》：月均排名 {previous_avg_rank|num1}→{avg_rank|num1}，日均计划 {previous_avg_plan|int}→{avg_plan|int}（{plan_delta_pct|pct}）'};
  assert.equal(renderSentence(spec, ctx).text, '《向末日开炮》：月均排名 15.5→8.4，日均计划 7,126→27,874（+291.2%）');
  const faller = renderSentence({...spec, sort: {by: 'rank_delta', order: 'asc'}}, ctx).text;
  assert.match(faller, /^《天命行者》：月均排名 14\.1→21\.7/);
  assert.equal(renderSentence({...spec, row: 9}, ctx).text, '');
  assert.equal(renderSentence({source: 'bestseller', where: [{field: 'game_name', op: '==', value: '新游'}], template: '{previous_avg_rank|num1}→{avg_rank|num1}'}, ctx).text, '—→30.0');
});

test('new game card line uses dates, month and per-row selection', () => {
  const spec = {source: 'new_games.bestseller', row: 1, template: '{first_buying_date|md} 首投、{first_entry_date|md} 冲榜；{@month}月均排名 {avg_rank|num1}（最佳 {best_rank}），日均素材 {avg_material|int} 条'};
  assert.equal(renderSentence(spec, ctx).text, '25.12.17 首投、9.8 冲榜；9月月均排名 55.8（最佳 17），日均素材 215 条');
});

test('trend words follow the sign of scalar values', () => {
  const spec = {template: '信息流 {@adx_kpi.douyin_info_flow_growth_pct|trend:扩张/收缩/持平} 达人投放 {@adx_kpi.douyin_talent_growth_pct|trend:上升/下降/持平}'};
  assert.equal(renderSentence(spec, ctx).text, '信息流 收缩 达人投放 下降');
});

test('invalid specs and unknown fields fail loudly', () => {
  assert.throws(() => validateSentence({template: ''}), /模板不正确/);
  assert.throws(() => renderSentence({source: 'bestseller', template: '{nope}'}, ctx), /字段不存在：nope/);
  assert.throws(() => renderSentence({source: 'bestseller', sort: {by: 'nope'}, template: 'x'}, ctx), /缺少字段：nope/);
  assert.equal(renderSentence({source: 'missing.table', template: 'x', empty: ''}, ctx).text, '');
});

test('fillTemplateData writes sentences into blank-ruled objects keeping the original text style', () => {
  const id = 'pptx-a-slide-3-shape-273';
  const project = {deck: {pages: [{name: '9月', objects: [{tagName: 'div', attributes: {'data-object-id': id, 'data-kind': 'text'}, style: {width: '900px', height: '40px'}, content: '<p style="margin:0"><span style="font-size:28px;color:#002b5c">SLG 新增一款新游</span><span>（5 款）</span></p>'}]}], notes: {}}};
  const rules = {visual: true, objects: [{id, mode: 'blank', sentence: {template: '{#up}', lists: {up: {source: 'iap.top50.rows', where: [{field: 'delta', op: '>', value: 0}], sort: {by: 'delta', order: 'desc'}, limit: 1, item: '{genre}新增{delta}款'}}}}]};
  const out = fillTemplateData(project, [{name: 'api', tables, scalars}], [], '2026-09', () => '', rules).project.deck.pages[0].objects[0];
  assert.equal(out.content, '<p style="margin:0"><span style="font-size:28px;color:#002b5c">模拟经营新增4款</span><span></span></p>');
  assert.equal(out.attributes['data-source-field'], 'sentence');
});

test('template rule validation accepts sentence rules and rejects broken ones', () => {
  const project = {deck: {pages: [{objects: [{attributes: {'data-object-id': 'a'}}]}]}};
  const base = {profile: 'full', description: '', objects: []};
  assert.doesNotThrow(() => validateRules({...base, objects: [{id: 'a', mode: 'auto', sentence: {template: '{@month}'}}]}, project));
  assert.throws(() => validateRules({...base, objects: [{id: 'a', mode: 'auto', sentence: {template: 1}}]}, project), /数据句子模板不正确/);
});
