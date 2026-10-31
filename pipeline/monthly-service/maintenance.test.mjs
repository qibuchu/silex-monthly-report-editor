import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {acquireStoreLock,backupStore,restoreStore} from './maintenance.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
test('storage lock and hashed backup restore protect live data and reject damaged or unsafe archives',()=>{
 const root=fs.mkdtempSync(path.join(here,'.maintenance-test-'));
 try{
  const data=path.join(root,'data');fs.mkdirSync(data);
  const unlock=acquireStoreLock(data);assert.throws(()=>acquireStoreLock(data),/禁止多实例/);unlock();
  const unlockAgain=acquireStoreLock(data);unlockAgain();
  fs.writeFileSync(path.join(data,'store.json'),JSON.stringify({projects:{one:{revision:3}},tasks:{}}));
  fs.mkdirSync(path.join(data,'assets'));fs.writeFileSync(path.join(data,'assets','cover.png'),'image');
  const backup=backupStore(data,path.join(root,'backups'));
  assert.throws(()=>backupStore(data,path.join(data,'backup')),/之外/);
  const restored=restoreStore(backup.directory,path.join(root,'restored'));
  assert.equal(restored.projects,1);assert.equal(fs.readFileSync(path.join(root,'restored','assets','cover.png'),'utf8'),'image');
  assert.throws(()=>restoreStore(backup.directory,data),/禁止覆盖/);
  fs.writeFileSync(path.join(backup.directory,'assets','cover.png'),'damaged');
  assert.throws(()=>restoreStore(backup.directory,path.join(root,'damaged')),/校验失败/);
  assert.equal(fs.existsSync(path.join(root,'damaged')),false);
 }finally{if(!path.resolve(root).startsWith(here+path.sep))throw Error('Unsafe cleanup');fs.rmSync(root,{recursive:true,force:true});}
});
test('completed backups retain the latest seven and a failed backup leaves no partial copy',()=>{
 const root=fs.mkdtempSync(path.join(here,'.maintenance-retention-test-'));
 try{
  const data=path.join(root,'data'),backups=path.join(root,'backups');fs.mkdirSync(data);
  assert.throws(()=>backupStore(data,backups),/缺少store.json/);
  assert.deepEqual(fs.readdirSync(backups),[]);
  fs.writeFileSync(path.join(data,'store.json'),JSON.stringify({projects:{},tasks:{}}));
  let latest;
  for(let i=0;i<9;i++)latest=backupStore(data,backups).directory;
  const completed=fs.readdirSync(backups).filter(name=>!name.endsWith('.partial'));
  assert.equal(completed.length,7);
  assert.ok(fs.existsSync(latest));
 }finally{if(!path.resolve(root).startsWith(here+path.sep))throw Error('Unsafe cleanup');fs.rmSync(root,{recursive:true,force:true});}
});
test('unchanged assets share backup storage while changed assets keep older snapshots intact',()=>{
 const root=fs.mkdtempSync(path.join(here,'.maintenance-dedup-test-'));
 try{
  const data=path.join(root,'data'),backups=path.join(root,'backups'),assets=path.join(data,'assets');fs.mkdirSync(assets,{recursive:true});
  fs.writeFileSync(path.join(data,'store.json'),JSON.stringify({projects:{},tasks:{}}));
  fs.writeFileSync(path.join(assets,'cover.png'),'first');
  const first=backupStore(data,backups).directory,second=backupStore(data,backups).directory;
  const prior=path.join(first,'assets','cover.png'),reused=path.join(second,'assets','cover.png');
  assert.equal(fs.statSync(prior).ino,fs.statSync(reused).ino);
  fs.writeFileSync(path.join(assets,'cover.png'),'second');
  const third=backupStore(data,backups).directory;
  assert.notEqual(fs.statSync(prior).ino,fs.statSync(path.join(third,'assets','cover.png')).ino);
  assert.equal(fs.readFileSync(prior,'utf8'),'first');
  assert.equal(fs.readFileSync(path.join(third,'assets','cover.png'),'utf8'),'second');
  restoreStore(first,path.join(root,'restore-first'));restoreStore(third,path.join(root,'restore-third'));
  assert.equal(fs.readFileSync(path.join(root,'restore-first','assets','cover.png'),'utf8'),'first');
  assert.equal(fs.readFileSync(path.join(root,'restore-third','assets','cover.png'),'utf8'),'second');
 }finally{if(!path.resolve(root).startsWith(here+path.sep))throw Error('Unsafe cleanup');fs.rmSync(root,{recursive:true,force:true});}
});
