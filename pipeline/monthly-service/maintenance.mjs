import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

function hashFile(file){
 const digest=createHash('sha256'),fd=fs.openSync(file,'r'),chunk=Buffer.allocUnsafe(4*1024*1024);
 try{let count;while((count=fs.readSync(fd,chunk,0,chunk.length,null))>0)digest.update(chunk.subarray(0,count));}
 finally{fs.closeSync(fd);}
 return digest.digest('hex');
}
export function acquireStoreLock(dataDir){
 fs.mkdirSync(dataDir,{recursive:true});
 const file=path.join(dataDir,'.service-lock.json'),identity=randomUUID();
 const create=()=>{const fd=fs.openSync(file,'wx');try{fs.writeFileSync(fd,JSON.stringify({pid:process.pid,identity}));}finally{fs.closeSync(fd);}};
 try{create();}catch(error){
  if(error.code!=='EEXIST')throw error;
  let previous;try{previous=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw Error('存储锁损坏，请先确认没有服务运行，再人工检查锁文件');}
  if(!Number.isInteger(previous.pid)||previous.pid<1)throw Error('无效存储锁');
  try{process.kill(previous.pid,0);}catch(cause){
   if(cause.code!=='ESRCH')throw Error('无法确认存储锁进程状态，拒绝并行启动');
   // Only remove a lock whose owning process no longer exists.
   fs.unlinkSync(file);create();return release;
  }
  throw Error(`数据目录已由进程 ${previous.pid} 使用，禁止多实例同时写入`);
 }
 return release;
 function release(){
  if(fs.existsSync(file)&&JSON.parse(fs.readFileSync(file,'utf8')).identity===identity)fs.unlinkSync(file);
 }
}
export function backupStore(dataDir,backupRoot){
 const root=path.resolve(dataDir),base=path.resolve(backupRoot);
 if(base===root||base.startsWith(root+path.sep))throw Error('备份目录须位于数据目录之外');
 fs.mkdirSync(base,{recursive:true});
 const backupName=/^20\d\d-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z-[a-f\d]{8}$/;
 const previousName=fs.readdirSync(base,{withFileTypes:true}).filter(entry=>entry.isDirectory()&&backupName.test(entry.name)&&fs.existsSync(path.join(base,entry.name,'manifest.json'))).map(entry=>entry.name).sort().at(-1);
 const previous=previousName?path.join(base,previousName):null;
 let previousFiles=new Map();
 if(previous){
  try{const manifest=JSON.parse(fs.readFileSync(path.join(previous,'manifest.json'),'utf8'));if(manifest.format==='monthly-backup-v1'&&Array.isArray(manifest.files))previousFiles=new Map(manifest.files.map(file=>[file.path,file]));}catch{}
 }
 const target=path.join(base,new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));
 const staged=target+'.partial';fs.mkdirSync(staged);
 const files=[];
 const copy=(source,relative)=>{
  const stat=fs.lstatSync(source);if(stat.isSymbolicLink())throw Error('备份不允许符号链接');
  if(stat.isDirectory()){for(const name of fs.readdirSync(source))copy(path.join(source,name),path.posix.join(relative,name));return;}
  const digest=hashFile(source),dest=path.join(staged,...relative.split('/'));
  fs.mkdirSync(path.dirname(dest),{recursive:true});
  let linked=false;const earlier=previousFiles.get(relative),prior=previous&&path.join(previous,...relative.split('/'));
  if(earlier?.size===stat.size&&earlier.sha256===digest&&prior&&fs.existsSync(prior)&&fs.lstatSync(prior).isFile()){
   try{if(hashFile(prior)===digest){fs.linkSync(prior,dest);linked=true;}}catch{}
  }
  if(!linked)fs.copyFileSync(source,dest);
  files.push({path:relative,size:stat.size,sha256:digest});
 };
 try{
  if(!fs.existsSync(path.join(root,'store.json')))throw Error('缺少store.json，不能生成空备份');
  // These are the authoritative data. In-flight task outputs are excluded;
  // interrupted generation never publishes a project automatically.
  for(const name of ['store.json','assets','history','conflicts','template-pptx'])if(fs.existsSync(path.join(root,name)))copy(path.join(root,name),name);
  fs.writeFileSync(path.join(staged,'manifest.json'),JSON.stringify({format:'monthly-backup-v1',createdAt:new Date().toISOString(),files},null,2));
  fs.renameSync(staged,target);
 }catch(error){try{fs.rmSync(staged,{recursive:true,force:true});}catch{}throw error;}
 let pruned=[],pruneError;
 try{pruned=pruneBackups(base,7);}catch(error){pruneError=error.message;}
 return {directory:target,files:files.length,bytes:files.reduce((sum,f)=>sum+f.size,0),pruned,...(pruneError?{pruneError}:{})};
}
export function pruneBackups(backupRoot,keep=7){
 if(!Number.isInteger(keep)||keep<1)throw Error('至少保留一份完整备份');
 const base=path.resolve(backupRoot),pattern=/^20\d\d-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z-[a-f\d]{8}$/;
 const entries=fs.readdirSync(base,{withFileTypes:true}).filter(e=>e.isDirectory()&&pattern.test(e.name)&&fs.existsSync(path.join(base,e.name,'manifest.json'))).map(e=>e.name).sort().reverse();
 const removed=[];
 for(const name of entries.slice(keep)){
  const target=path.join(base,name);
  if(fs.realpathSync(target)!==target||!target.startsWith(base+path.sep))throw Error('备份目录路径异常，停止清理');
  fs.rmSync(target,{recursive:true});removed.push(name);
 }
 return removed;
}
export function restoreStore(backupDirectory,dataDir){
 const source=path.resolve(backupDirectory),dest=path.resolve(dataDir);
 if(fs.existsSync(dest))throw Error('恢复目标必须为不存在的新目录，禁止覆盖现有数据');
 const manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'),'utf8'));
 if(manifest.format!=='monthly-backup-v1'||!Array.isArray(manifest.files)||!manifest.files.some(f=>f.path==='store.json'))throw Error('无效备份清单');
 const seen=new Set();
 for(const file of manifest.files){
  if(typeof file.path!=='string'||!file.path||file.path.includes('\\')||file.path.split('/').some(p=>!p||p==='..'||p==='.')||path.isAbsolute(file.path)||seen.has(file.path))throw Error('无效备份路径');
  seen.add(file.path);const absolute=path.resolve(source,...file.path.split('/'));
  if(!absolute.startsWith(source+path.sep)||fs.lstatSync(absolute).isSymbolicLink()||!fs.realpathSync(absolute).startsWith(fs.realpathSync(source)+path.sep))throw Error('备份路径越界');
  if(fs.statSync(absolute).size!==file.size||hashFile(absolute)!==file.sha256)throw Error(`备份校验失败：${file.path}`);
 }
 const db=JSON.parse(fs.readFileSync(path.join(source,'store.json'),'utf8'));
 if(!db.projects||!db.tasks)throw Error('备份项目库无效');
 const stage=dest+'.restore-'+randomUUID();fs.mkdirSync(stage,{recursive:true});
 for(const file of manifest.files){const target=path.join(stage,...file.path.split('/'));fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(source,...file.path.split('/')),target);}
 fs.renameSync(stage,dest);return {directory:dest,files:manifest.files.length,projects:Object.keys(db.projects).length};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),option=name=>args[args.indexOf(name)+1];
 try{
  if(args[0]!=='restore'||!args.includes('--backup')||!args.includes('--data-dir'))throw Error('用法：node maintenance.mjs restore --backup 备份目录 --data-dir 新数据目录（恢复后检查图片URL及publicUrl配置）');
  console.log(JSON.stringify(restoreStore(option('--backup'),option('--data-dir')),null,2));
 }catch(error){console.error(error.message);process.exitCode=1;}
}
