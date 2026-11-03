const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const target=path.resolve(process.argv[2]||path.join(root,'releases/monthly-demo-0.2.0'));
if(fs.existsSync(target))throw Error('发布目录已存在，请选择新目录，禁止覆盖');
const manifest=[];
const excluded=new Set(['node_modules','node-compile-cache','dist','.git','.env','config.json','.mcp.json','.claude','.test-temp','data','backups','silex','.playwright-mcp','__pycache__']);
function copy(relative){
 const source=path.join(root,relative);if(!fs.existsSync(source))return;
 const stat=fs.lstatSync(source);if(stat.isSymbolicLink())return;
 if(stat.isDirectory()){for(const name of fs.readdirSync(source)){if(!excluded.has(name)&&!name.startsWith('.service-test-')&&!name.startsWith('.chat-test-')&&!name.startsWith('.operations-test-')&&!name.startsWith('.maintenance-test-')&&!name.startsWith('.maintenance-dedup-test-'))copy(path.join(relative,name));}return;}
 if(relative.endsWith('.log'))return;
 const bytes=fs.readFileSync(source),dest=path.join(target,relative);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes);
 manifest.push({path:relative.split(path.sep).join('/'),size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
}
fs.mkdirSync(target,{recursive:true});
for(const dir of ['pipeline/monthly-service','pipeline/monthly-toolkit','tools'])copy(dir);
copy('deployment/steam-monthly');
for(const file of ['AGENTS.md','README.md','.gitignore','启动月报Demo.cmd','启动月报MCP服务.cmd','outputs/monthly-editor/chart.js'])copy(file);
for(const file of ['generate-draft.cjs','topic-template.cjs','topic-slots.json','market-details.cjs','market-source.cjs','market-source.test.cjs','binding-contract.cjs','page-layout.cjs','data-quality.cjs','data-quality.test.cjs','generate-draft.test.cjs','page-layout.test.cjs','README.md'])copy('workflow/'+file);
copy('workflow/fixtures');
copy('workflow/大盘直取字段规范.md');
const editor='work/silex-poc';
for(const dir of ['editor','server','common','grapesjs-plugins','public','scripts','desktop'])copy(path.join(editor,dir));
for(const name of fs.readdirSync(path.join(root,editor))){if(excluded.has(name))continue;const stat=fs.lstatSync(path.join(root,editor,name));if(stat.isFile()&&!name.endsWith('.zip'))copy(path.join(editor,name));}
fs.writeFileSync(path.join(target,'manifest.json'),JSON.stringify({version:'0.2.0',builtAt:new Date().toISOString(),files:manifest},null,2));
if(!fs.existsSync(path.join(target,'README.md')))fs.writeFileSync(path.join(target,'README.md'),'# 月报工具 0.2.0\n\n此包包含源码，不包含用户项目库、图片历史、凭据、依赖或构建产物。\n');
console.log(JSON.stringify({directory:target,files:manifest.length,bytes:manifest.reduce((sum,f)=>sum+f.size,0)},null,2));
