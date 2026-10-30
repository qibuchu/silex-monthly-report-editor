import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCore} from './core.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
test('deduplicated media survives offline HTML and editable archive import',()=>{
 const dir=fs.mkdtempSync(path.join(here,'.assets-test-'));
 try{
  const core=createCore({dataDir:dir,publicUrl:'http://localhost:4320'});
  const project={format:'steam-grapesjs-v2',deck:{css:'',pages:[{width:1920,height:1440,objects:[{attributes:{'data-object-id':'pic'},style:{},content:''}]}]}};
  const id=core.importProject({project,month:'2026-08'}).projectId;
  const data='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2i8AAAAASUVORK5CYII=';
  const one=core.putAsset(id,{data}),two=core.putAsset(id,{data});
  assert.equal(one.src,two.src);assert.equal(fs.readdirSync(path.join(dir,'assets',id)).length,1);
  const changed=structuredClone(project);changed.deck.pages[0].objects[0].content=`<img src="${one.src}">`;changed.silexState={assets:[{src:one.src}]};core.save(id,1,changed);
  assert.ok(core.silex(id).editorData.assets[0].src.startsWith('data:image/png;base64,'));
  const archive=core.archive(id);assert.equal(Object.keys(archive.assets).length,1);
  assert.ok(archive.project.silexState.assets[0].src.startsWith('monthly-asset:'));
  const restored=core.importProject(archive).projectId;
  assert.notEqual(restored,id);
  const stored=core.project(restored).project;
  assert.ok(stored.silexState.assets[0].src.includes(restored));
  assert.match(core.preview(restored,undefined,true),/data:image\/png;base64/);
  assert.match(core.preview(restored),/--page-height:1440px/);
  assert.throws(()=>core.importProject({...archive,assets:{}}),/缺少/);
  assert.throws(()=>core.putAsset(id,{data:'data:text/html;base64,SGVsbG8='}));
  assert.throws(()=>core.getAsset(id,'../../store.json'));
  const tableProject=structuredClone(project);
  tableProject.deck.pages[0].objects[0]={attributes:{'data-object-id':'table'},tagName:'table',style:{},content:'<tbody><tr><td>游戏</td></tr></tbody>'};
  const tableId=core.importProject({project:tableProject}).projectId;
  assert.match(core.preview(tableId),/<table[^>]*>\s*<tbody>/);
  assert.match(core.preview(tableId),/@page report-0\{size:1920px 1440px/);
 }finally{if(!path.resolve(dir).startsWith(here+path.sep))throw Error('Unsafe cleanup');fs.rmSync(dir,{recursive:true,force:true});}
});
