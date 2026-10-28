// Data sentences: fill a text object with a sentence built from imported data.
//
// spec = {
//   template: '《{game_name}》：月均排名 {previous_avg_rank|num1}→{avg_rank|num1}（{plan_delta_pct|pct}）',
//   source: 'bestseller',                       // table name or role; optional when only @scalars / #lists are used
//   where: [{field:'rank_delta', op:'>', value:0}],
//   sort: {by:'rank_delta', order:'desc'},
//   row: 0,                                     // which row after where/sort (default 0)
//   lists: {up:{source:'iap.top50.rows', where:[...], sort:{...}, limit:3, item:'{genre}+{delta}', join:'、', empty:''}},
//   missing: '—',                               // shown for an empty field value
//   empty: ''                                   // whole sentence when the selected row does not exist
// }
// Placeholders: {field|fmt|fmt}, {@scalar.path|fmt}, {@month}, {@year}, {#listName}
// Formats: int, num1, num2, num, pct (+x.x%), signed (+x), abs, md (2026-09-01 -> 9.1), trend:A/B[/C]
// A sentence never invents values: missing fields render as `missing`, a missing row renders `empty`.
const fail = message => { throw Object.assign(Error(message), {status: 400}); };
const OPS = ['>', '>=', '<', '<=', '==', '!=', 'notnull', 'null'];

const toNumber = value => {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/[,%\s]/g, '');
  if (text === '' || text === '-' || text === '—') return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
};
const fixed = (n, digits) => Number(n.toFixed(digits)).toLocaleString('en-US', {maximumFractionDigits: digits, minimumFractionDigits: digits});

function format(value, formats, month, missing) {
  let current = value;
  for (const raw of formats) {
    const [name, arg] = raw.split(/:(.*)/s);
    if (name === 'trend') {
      const n = toNumber(current), words = String(arg || '').split('/');
      if (n === null) return missing;
      current = n > 0 ? words[0] ?? '' : n < 0 ? words[1] ?? '' : words[2] ?? words[1] ?? '';
      continue;
    }
    if (name === 'md') {
      const m = String(current ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!m) return current === '' || current === null || current === undefined ? missing : String(current);
      current = (month && m[1] !== month.slice(0, 4) ? m[1].slice(-2) + '.' : '') + Number(m[2]) + '.' + Number(m[3]);
      continue;
    }
    const n = toNumber(current);
    if (['int', 'num1', 'num2', 'num', 'pct', 'signed', 'abs'].includes(name) && n === null) return missing;
    if (name === 'abs') current = Math.abs(n);
    else if (name === 'int') current = Math.round(n).toLocaleString('en-US');
    else if (name === 'num1') current = fixed(n, 1);
    else if (name === 'num2') current = fixed(n, 2);
    else if (name === 'num') current = n.toLocaleString('en-US', {maximumFractionDigits: 6});
    else if (name === 'pct') current = (n > 0 ? '+' : '') + fixed(n, 1) + '%';
    else if (name === 'signed') current = (n > 0 ? '+' : '') + n.toLocaleString('en-US', {maximumFractionDigits: 2});
    else fail('数据句子格式不支持：' + name);
  }
  if (current === null || current === undefined || current === '') return missing;
  return String(current);
}

function findTable(tables, name) {
  const found = tables.filter(t => t.name === name || t.role === name);
  if (!found.length) return null;
  return found[0];
}

function select(table, {where = [], sort} = {}) {
  if (!Array.isArray(where)) fail('数据句子筛选条件须为数组');
  const col = field => { const i = table.columns.indexOf(field); if (i < 0) fail(`数据表“${table.name}”缺少字段：${field}`); return i; };
  let rows = table.rows.map(r => Object.fromEntries(table.columns.map((c, i) => [c, r[i]])));
  for (const w of where) {
    if (!w || typeof w.field !== 'string' || !OPS.includes(w.op)) fail('数据句子筛选条件不正确');
    col(w.field);
    rows = rows.filter(r => {
      const raw = r[w.field], n = toNumber(raw), v = toNumber(w.value);
      if (w.op === 'notnull') return raw !== '' && raw !== null && raw !== undefined;
      if (w.op === 'null') return raw === '' || raw === null || raw === undefined;
      if (w.op === '==') return v !== null && n !== null ? n === v : String(raw) === String(w.value);
      if (w.op === '!=') return v !== null && n !== null ? n !== v : String(raw) !== String(w.value);
      if (n === null || v === null) return false;
      return w.op === '>' ? n > v : w.op === '>=' ? n >= v : w.op === '<' ? n < v : n <= v;
    });
  }
  if (sort) {
    if (typeof sort.by !== 'string') fail('数据句子排序字段不正确');
    col(sort.by);
    const dir = sort.order === 'asc' ? 1 : -1, key = sort.abs ? r => Math.abs(toNumber(r[sort.by]) ?? 0) : r => toNumber(r[sort.by]);
    rows = rows.map((r, i) => ({r, i})).sort((a, b) => {
      const x = key(a.r), y = key(b.r);
      if (x === null && y === null) return a.i - b.i;
      if (x === null) return 1;
      if (y === null) return -1;
      return dir * (x - y) || a.i - b.i;
    }).map(v => v.r);
  }
  return rows;
}

function fill(template, row, ctx, lists, missing) {
  return template.replace(/\{([#@]?)([^{}|]+)((?:\|[^{}|]+)*)\}/g, (_, kind, name, fmt) => {
    const formats = fmt ? fmt.slice(1).split('|') : [];
    if (kind === '#') { if (!(name in lists)) fail('数据句子列表未定义：' + name); return lists[name]; }
    if (kind === '@') {
      if (name === 'month') return Number(ctx.month.slice(5)) + '月';
      if (name === 'year') return ctx.month.slice(0, 4);
      const v = ctx.scalars.find(s => s.path === name);
      if (!v) return missing;
      return format(v.value, formats, ctx.month, missing);
    }
    if (!row) fail('数据句子未指定数据表，不能使用字段：' + name);
    if (!(name in row)) fail('数据句子字段不存在：' + name);
    return format(row[name], formats, ctx.month, missing);
  });
}

export function validateSentence(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec) || typeof spec.template !== 'string' || !spec.template.trim() || spec.template.length > 2000) fail('数据句子模板不正确');
  if (spec.lists !== undefined && (typeof spec.lists !== 'object' || Array.isArray(spec.lists) || Object.keys(spec.lists).length > 10)) fail('数据句子列表不正确');
  for (const list of Object.values(spec.lists || {}))
    if (!list || typeof list.source !== 'string' || typeof list.item !== 'string' || list.item.length > 500 || (list.limit !== undefined && (!Number.isInteger(list.limit) || list.limit < 1 || list.limit > 50))) fail('数据句子列表不正确');
  if (spec.row !== undefined && (!Number.isInteger(spec.row) || spec.row < 0 || spec.row > 1000)) fail('数据句子行号不正确');
  return spec;
}

export function renderSentence(spec, {tables = [], scalars = [], month = ''} = {}) {
  validateSentence(spec);
  const ctx = {tables, scalars, month}, missing = spec.missing ?? '—', issues = [];
  const lists = {};
  for (const [name, list] of Object.entries(spec.lists || {})) {
    const table = findTable(tables, list.source);
    if (!table) { lists[name] = list.empty ?? ''; issues.push('数据表不存在：' + list.source); continue; }
    const rows = select(table, list).slice(0, list.limit ?? 3);
    lists[name] = rows.length ? rows.map(r => fill(list.item, r, ctx, {}, missing)).join(list.join ?? '、') : (list.empty ?? '');
  }
  let row = null;
  if (spec.source) {
    const table = findTable(tables, spec.source);
    if (!table) return {text: spec.empty ?? '', issues: [...issues, '数据表不存在：' + spec.source]};
    row = select(table, spec)[spec.row ?? 0] || null;
    if (!row) return {text: spec.empty ?? '', issues: [...issues, '没有符合条件的数据行：' + spec.source]};
  }
  return {text: fill(spec.template, row, ctx, lists, missing), issues};
}
