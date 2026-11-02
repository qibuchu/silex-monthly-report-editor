import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createCore} from './core.mjs';

function smallPptx(){
  const names=['[Content_Types].xml','ppt/presentation.xml'];
  const local=[],central=[];let offset=0;
  for(const name of names){
    const filename=Buffer.from(name),entry=Buffer.alloc(30+filename.length),index=Buffer.alloc(46+filename.length);
    entry.writeUInt32LE(0x04034b50,0);entry.writeUInt16LE(filename.length,26);filename.copy(entry,30);
    index.writeUInt32LE(0x02014b50,0);index.writeUInt16LE(filename.length,28);index.writeUInt32LE(offset,42);filename.copy(index,46);
    local.push(entry);central.push(index);offset+=entry.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(names.length,8);end.writeUInt16LE(names.length,10);
  end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}

test('PPT-only templates: upload without rules cannot publish, can be removed, and no web project is made',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-templates-'));
  try{
    const core=createCore({dataDir:path.join(root,'data'),publicUrl:'http://127.0.0.1:4320'});
    const before=Object.keys(core.db.projects).length;
    assert.throws(()=>core.createPptTemplate(Buffer.from('not a pptx'),{title:'x',dataSourceId:'minigame-monthly'}),/有效PPTX/);
    assert.throws(()=>core.createPptTemplate(smallPptx(),{title:'x',dataSourceId:'other'}),/数据源/);
    const created=core.createPptTemplate(smallPptx(),{title:'小游戏月报',dataSourceId:'minigame-monthly'});
    assert.equal(created.mappingConfigured,false);assert.equal(created.ready,false);
    assert.equal(Object.keys(core.db.projects).length,before);
    assert.ok(fs.existsSync(core.pptTemplateSource(created.id).file));
    await assert.rejects(core.call('publish_ppt_template',{templateId:created.id,baseRevision:0}),/没有填数规则/);
    await assert.rejects(core.call('generate_ppt',{templateId:created.id,month:'2026-09'}),/先发布/);
    await assert.rejects(core.call('delete_ppt_template',{templateId:created.id,baseRevision:3}),/已变化/);
    await core.call('delete_ppt_template',{templateId:created.id,baseRevision:0});
    assert.deepEqual(await core.call('list_ppt_templates'),[]);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('generate_ppt fetches the minigame export for the month and refuses an unfinished month',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-fetch-'));
  const asked=[];
  const server=http.createServer((req,res)=>{const month=new URL(req.url,'http://x').searchParams.get('month');asked.push(month);
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({month,coverage:{calendar_complete:false},snapshot:{id:1}}));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{
    const core=createCore({dataDir:path.join(root,'data'),publicUrl:'http://127.0.0.1:4320',minigameExportUrl:`http://127.0.0.1:${server.address().port}/export?month={month}`});
    const created=core.createPptTemplate(smallPptx(),{title:'小游戏月报',dataSourceId:'minigame-monthly'});
    const t=core.db.pptTemplates[created.id];
    t.mapping={format:'native-pptx-mapping-v1',dataSource:'minigame-monthly',ops:[{op:'clearText',slide:1,shapeId:1}]};
    t.published={sourcePptx:t.sourcePptx,mapping:t.mapping,mappingRevision:1,revision:1};t.revision=1;
    await assert.rejects(core.call('generate_ppt',{templateId:t.id,month:'2026-11'}),/还没有完整的月度数据/);
    assert.deepEqual(asked,['2026-11','2026-10']);
  }finally{server.close();fs.rmSync(root,{recursive:true,force:true});}
});
