const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),target=path.resolve(process.argv[2]||'');
if(!process.argv[2]||fs.existsSync(target))throw Error('请指定不存在的独立发布目录');
function run(file,args){const r=spawnSync(process.execPath,[path.join(root,file),...args],{cwd:root,stdio:'inherit'});if(r.status!==0)throw Error(file+' failed');}
run('tools/package-demo.cjs',[target]);
const cp=(from,to)=>fs.cpSync(path.join(root,from),path.join(target,to||from),{recursive:true});
cp('deployment/steam-monthly');
run('tools/package-monthly.cjs',[path.join(target,'releases/monthly-toolkit-portable')]);
const editor='work/silex-poc',index=fs.readFileSync(path.join(root,editor,'dist/client/index.html'),'utf8');
const active=new Set([...index.matchAll(/(?:js\/main\.[a-f\d]+\.js|css\/admin\.[a-f\d]+\.css)/g)].map(m=>m[0]));
if(!active.size)throw Error('无法识别编辑器当前构建');
function copyDist(rel){const source=path.join(root,editor,'dist',rel),stat=fs.statSync(source);
 if(stat.isDirectory()){for(const f of fs.readdirSync(source))copyDist(path.join(rel,f));return;}
 const portable=rel.split(path.sep).join('/').replace(/^client\//,'');
 if(/^(js\/main\.[a-f\d]+\.js|css\/admin\.[a-f\d]+\.css)$/.test(portable)&&!active.has(portable))return;
 if(source.endsWith('.map'))return;
 const dest=path.join(target,editor,'dist',rel);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(source,dest);
}
copyDist('client');copyDist('server');
// Production configuration replaces only the copy inside this isolated release.
fs.copyFileSync(path.join(root,'deployment/steam-monthly/silex.config.cjs'),path.join(target,editor,'server/deploy/.silex.js'));
const pkg=JSON.parse(fs.readFileSync(path.join(root,editor,'package.json')));
fs.writeFileSync(path.join(target,editor,'package.json'),JSON.stringify({name:'steam-monthly-silex-runtime',version:'0.1.0',private:true,dependencies:pkg.dependencies},null,2));
const manifest=[];function walk(dir){for(const ent of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,ent.name);if(ent.isDirectory())walk(f);else manifest.push({path:path.relative(target,f).split(path.sep).join('/'),size:fs.statSync(f).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')});}}walk(target);
const revision=spawnSync('git',['-c',`safe.directory=${root.replaceAll('\\','/')}`,'rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true});
fs.writeFileSync(path.join(target,'server-manifest.json'),JSON.stringify({builtAt:new Date().toISOString(),sourceRevision:revision.status===0?revision.stdout.trim():null,files:manifest},null,2));
console.log(JSON.stringify({release:target,files:manifest.length,bytes:manifest.reduce((s,f)=>s+f.size,0)}));
