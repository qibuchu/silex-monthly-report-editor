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

test('game introduction candidates require an explicit selection from the same monthly snapshot',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-game-selection-'));
  try{
    const core=createCore({dataDir:path.join(root,'data'),publicUrl:'http://127.0.0.1:4320'});
    const mapping={dataSource:'steam-monthly',gameSelection:{groups:[{id:'head',title:'头部介绍',source:'head.top20',defaultSource:'head.highlights',idField:'appid',nameField:'name',rankField:'rank',min:1,max:2}]}};
    core.db.pptTemplates.example={id:'example',title:'Steam',revision:1,sourcePptx:{sha256:'abc'},published:{mapping,sourcePptx:{sha256:'abc'},revision:1}};
    const data={report_month:'2026-09',snapshot_id:'monthly-2026-09-test',head:{top20:[{appid:10,name:'Alpha',rank:1},{appid:20,name:'Beta',rank:2}],highlights:[{appid:20,rank:2}]}};
    const audit={month:'2026-09',snapshot_id:data.snapshot_id,contract_errors:[]};
    const preview=await core.call('prepare_ppt_game_selection',{templateId:'example',month:'2026-09',data,audit});
    assert.equal(preview.snapshot,data.snapshot_id);
    assert.deepEqual(preview.groups[0].candidates.filter(game=>game.recommended).map(game=>game.id),[20]);
    await assert.rejects(core.call('generate_ppt',{templateId:'example',month:'2026-09',data,audit,selectionTemplateRevision:1}),/确认要介绍的游戏/);
    await assert.rejects(core.call('generate_ppt',{templateId:'example',month:'2026-09',data,audit,selection:{head:[10]},selectionSnapshot:'old',selectionTemplateRevision:1}),/重新确认/);
    await assert.rejects(core.call('generate_ppt',{templateId:'example',month:'2026-09',data,audit,selection:{head:[99]},selectionSnapshot:preview.snapshot,selectionTemplateRevision:1}),/不在当前榜单/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('generate_ppt fetches the minigame export for the month and refuses an unfinished month',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-fetch-'));
  const asked=[];let complete=false;
  const server=http.createServer((req,res)=>{const month=new URL(req.url,'http://x').searchParams.get('month');asked.push(month);
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({month,coverage:{calendar_complete:complete},snapshot:complete?null:{id:1},mode:complete?'preview':'snapshot'}));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{
    const core=createCore({dataDir:path.join(root,'data'),publicUrl:'http://127.0.0.1:4320',minigameExportUrl:`http://127.0.0.1:${server.address().port}/export?month={month}`});
    const created=core.createPptTemplate(smallPptx(),{title:'小游戏月报',dataSourceId:'minigame-monthly'});
    const t=core.db.pptTemplates[created.id];
    t.mapping={format:'native-pptx-mapping-v1',dataSource:'minigame-monthly',ops:[{op:'clearText',slide:1,shapeId:1}]};
    t.published={sourcePptx:t.sourcePptx,mapping:t.mapping,mappingRevision:1,revision:1};t.revision=1;
    await assert.rejects(core.call('generate_ppt',{templateId:t.id,month:'2026-11'}),/还没有完整的月度数据/);
    assert.deepEqual(asked,['2026-11','2026-10']);
    complete=true;
    await assert.rejects(core.call('generate_ppt',{templateId:t.id,month:'2026-10'}),/还没有固化快照/);
  }finally{server.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('a PPT template picks up updated registered rules; a published one shows them as unpublished changes',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-seed-'));
  try{
    const dataDir=path.join(root,'data');
    const seed=JSON.parse(fs.readFileSync(new URL('./experimental/minigame_monthly_template_v4.json',import.meta.url),'utf8'));
    fs.mkdirSync(path.join(dataDir,'template-pptx'),{recursive:true});
    fs.writeFileSync(path.join(dataDir,'template-pptx',seed.seedSha256+'.pptx'),smallPptx());
    const old={...seed,ops:seed.ops.filter(op=>op.op!=='barLength')};
    const base={title:'小游戏月报',dataSourceId:'minigame-monthly',createdAt:'2026-11-02',sourcePptx:{sha256:seed.seedSha256,bytes:1}};
    fs.writeFileSync(path.join(dataDir,'store.json'),JSON.stringify({projects:{},tasks:{},proposals:{},pptTemplates:{
      a:{...base,id:'a',revision:0,mapping:old,mappingRevision:1},
      b:{...base,id:'b',revision:1,mapping:old,mappingRevision:1,published:{sourcePptx:base.sourcePptx,mapping:old,mappingRevision:1,revision:1}}}}));
    const core=createCore({dataDir,publicUrl:'http://127.0.0.1:4320'});
    const [a,b]=['a','b'].map(id=>core.db.pptTemplates[id]);
    assert.equal(a.mappingRevision,2);assert.ok(a.mapping.ops.some(op=>op.op==='barLength'));
    assert.equal(b.published.mapping.ops.some(op=>op.op==='barLength'),false);
    assert.equal((await core.call('list_ppt_templates')).find(t=>t.id==='b').draftChanged,true);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
