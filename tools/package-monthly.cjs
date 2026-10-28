const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const target = path.resolve(process.argv[2] || path.join(root, 'releases/monthly-toolkit'));
if (fs.existsSync(target)) throw Error('输出目录已存在，请使用新目录。');
fs.mkdirSync(target, { recursive: true });
function copy(source, destination = source) {
  const to = path.join(target, destination);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(root, source), to);
}
for (const file of ['generate-draft.cjs', 'topic-template.cjs', 'topic-slots.json', 'market-details.cjs', 'market-source.cjs', 'binding-contract.cjs','page-layout.cjs','data-quality.cjs']) copy('workflow/' + file);
copy('outputs/monthly-editor/chart.js');
copy('work/silex-poc/scripts/monthly-report-adapter.cjs', 'lib/silex-adapter.cjs');
copy('pipeline/monthly-toolkit/run.cjs', 'run.cjs');
copy('pipeline/monthly-toolkit/config.example.json', 'config.example.json');
copy('pipeline/monthly-toolkit/README.md', 'README.md');
copy('pipeline/monthly-toolkit/AGENTS.md', 'AGENTS.md');
const content = fs.readFileSync(path.join(root, 'pipeline/monthly-toolkit/templates/steam-ppt-v1.json'), 'utf8');
fs.mkdirSync(path.join(target, 'templates'));
fs.writeFileSync(path.join(target, 'templates/steam-ppt-v1.json'), content);
fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify({ version: '0.1.0', template: 'steam-ppt-v1', template_sha256: crypto.createHash('sha256').update(content).digest('hex'), built_at: new Date().toISOString() }, null, 2));
console.log(target);
