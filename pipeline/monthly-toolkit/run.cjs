const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { assertDataCredentials, prepareMonthlyData, authenticationFailure } = require('./workflow/data-quality.cjs');
const root = __dirname;
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function write(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
function execute(command, argv) {
  const result = spawnSync(command, argv, { encoding: 'utf8', shell: false, maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0 && (authenticationFailure((result.stdout || '') + (result.stderr || '')) || (argv.includes('databrain-preflight') && result.status === 2))) {
    const error = new Error('CREDENTIALS_REQUIRED：暂停取数。请用户续期登录凭据并确认后再继续；不生成空榜草稿，不自动重试。');
    error.exitCode = 3; throw error;
  }
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) throw Error(`命令失败，退出码 ${result.status}`);
}
function escape(value) { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
try {
  if (args.includes('--help') || !args.length) {
    console.log('node run.cjs --month YYYY-MM [--data monthly-report.json] [--history history.json] [--selection selection.json] [--profile data-supported|finished-eight|full] [--config config.json] [--out output-directory]');
    process.exit(0);
  }
  const month = option('--month');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) throw Error('请指定 --month YYYY-MM');
  const configFile = path.resolve(option('--config') || path.join(root, 'config.json'));
  const config = fs.existsSync(configFile) ? read(configFile) : {};
  const relative = file => path.resolve(path.dirname(configFile), file);
  const output = path.resolve(option('--out') || path.join(root, 'reports', month));
  if (fs.existsSync(output)) throw Error('输出目录已存在，避免覆盖人工稿，请选择新 --out 目录。');
  fs.mkdirSync(output, { recursive: true });
  const raw = path.join(output, 'monthly-report.json');
  const historicalPackages = option('--history') ? read(path.resolve(option('--history'))) : [];
  if (!Array.isArray(historicalPackages)) throw Error('--history 必须为历史 monthly-report 数据包数组。');
  if (option('--data')) fs.copyFileSync(path.resolve(option('--data')), raw);
  else {
    if (!config.steamautoSkillDir) throw Error('取数需要在 config.json 设置 steamautoSkillDir，或传入 --data。');
    const skill = relative(config.steamautoSkillDir);
    const python = config.python || 'python';
    execute(python, ['-X', 'utf8', path.join(skill, 'scripts/query.py'), 'health']);
    execute(python, ['-X', 'utf8', path.join(skill, 'scripts/query.py'), 'databrain-preflight']);
    execute(python, ['-X', 'utf8', path.join(skill, 'scripts/query.py'), 'monthly-report', '--month', month, '--output', raw]);
    assertDataCredentials(read(raw));
    execute(python, ['-X', 'utf8', path.join(skill, 'scripts/validate_monthly_report.py'), raw, '--output', path.join(output, 'upstream-validation.json')]);
    if (!option('--history')) {
      const [year, number] = month.split('-').map(Number);
      for (const offset of [1, 2]) {
        const previous = new Date(Date.UTC(year, number - 1 - offset, 1)).toISOString().slice(0, 7);
        const historyFile = path.join(output, `history-${previous}.json`);
        execute(python, ['-X', 'utf8', path.join(skill, 'scripts/query.py'), 'monthly-report', '--month', previous, '--output', historyFile]);
        assertDataCredentials(read(historyFile));
        historicalPackages.push(read(historyFile));
      }
    }
  }
  const data = read(raw);
  assertDataCredentials(data);
  if (data.report_month !== month) throw Error('数据月份与指定月份不一致。');
  if (historicalPackages.some(item => item.schema_version !== '2.0' || !['ok', 'partial'].includes(item.status))) throw Error('历史数据包状态或 schema 不符合约定。');
  const quality = prepareMonthlyData(data);
  write(path.join(output, 'data-quality.json'), { snapshot_id: data.snapshot_id, report_month: data.report_month, excluded: quality.blocked });
  const history = historicalPackages.map(item => prepareMonthlyData(item).data);
  const { generate } = require('./workflow/generate-draft.cjs');
  const profile = option('--profile') || (args.includes('--full') ? 'full' : 'data-supported');
  if (!['data-supported','finished-eight','full'].includes(profile)) throw Error('未知页面结构。');
  const selection = option('--selection') ? read(path.resolve(option('--selection'))) : {};
  if (selection.mode === 'refresh') throw Error('该入口只生成新草稿，不刷新人工稿。');
  const result = generate(read(path.join(root, 'templates/steam-ppt-v1.json')), data, { ...selection, page_mode: profile, market_history: history });
  if (!result.contract.valid) throw Error('可编辑项目绑定协议检查失败。');
  write(path.join(output, 'draft.json'), result.envelope);
  write(path.join(output, 'issues.json'), result.issues);
  write(path.join(output, 'contract.json'), result.contract);
  const deck = result.envelope.project.deck;
  const pages = deck.pages.map(page => `<section class="slide report-page" style="background:${escape(page.background || '#fff')}">${page.objects.map(o => `<div ${Object.entries(o.attributes || {}).map(([k,v]) => `${k}="${escape(v)}"`).join(' ')} class="${escape((o.classes || ['object']).join(' '))}" style="${escape(Object.entries(o.style || {}).map(([k,v]) => `${k}:${v}`).join(';'))}">${o.content || ''}</div>`).join('')}</section>`).join('');
  fs.writeFileSync(path.join(output, 'draft.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Steam ${month} 月报草稿</title><style>${deck.css || ''}\nbody{margin:0;background:#e5e7eb}.report-page{position:relative;width:1920px;height:1080px;margin:24px auto;overflow:hidden}.report-page>.object{position:absolute;box-sizing:border-box}</style>${pages}</html>`);
  const adapter = require('./lib/silex-adapter.cjs');
  const projectId = `steam-monthly-${month}-${Date.now()}`;
  const storage = config.silexStorageDir ? relative(config.silexStorageDir) : path.join(output, 'silex-storage');
  const silexDir = adapter.writeSilexProject(adapter.createSilexProject(result.envelope), storage, projectId);
  const summary = { month, status: data.status, snapshot_id: data.snapshot_id, template: 'steam-ppt-v1', pages: deck.pages.length, objects: result.contract.objectCount, issues: result.issues.length, silex_project: silexDir, editor_url: config.silexStorageDir ? `${config.editorUrl || 'http://localhost:6805/'}?id=${projectId}&connectorId=fs-storage&lang=zh` : null };
  write(path.join(output, 'result.json'), summary);
  fs.writeFileSync(path.join(output, '缺失与口径说明.md'), '# 数据缺失与口径说明\n\n' + result.issues.map(issue => `- ${issue.code}: ${issue.message || issue.reason || ''}`).join('\n') + '\n');
  console.log(JSON.stringify(summary, null, 2));
} catch (error) { console.error(error.message); process.exitCode = error.exitCode || 1; }
