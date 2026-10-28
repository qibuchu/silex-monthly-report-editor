import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createCore} from './core.mjs';
test('existing PPT source registration preserves report and publication, rejects stale config and persists samples',async()=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'monthly-sources-'));
 try{
  const config={dataDir,publicUrl:'http://localhost:4320'},core=createCore(config);
  const project={format:'steam-grapesjs-v2',deck:{css:'',notes:{template_origin:'pptx',pptx_imports:[{filename:'小游戏.pptx'}]},pages:[{name:'微信小游戏 AdXray 买量',width:1920,height:1080,objects:[{attributes:{'data-object-id':'title','data-kind':'text'},style:{top:'0px'},content:'小游戏买量大盘'}]}]}};
  const imported=core.importPptxTemplate({title:'旧模板',project}),templateId=imported.templateId;
  const before=JSON.stringify(core.project(imported.projectId)),first=await core.call('get_template_data_sources',{templateId});assert.equal(first.revision,0);assert.equal(first.needs.length,1);
  const args={templateId,baseRevision:0,templateRevision:0,projectRevision:1,entries:[{requirement:first.needs[0].name,name:'买量导出',kind:'json',filename:'8月.json',sample:{report_month:'2026-08',games:[{name:'样例',rank:1}]}}]};
  const saved=await core.call('configure_template_data_sources',args);assert.equal(saved.revision,1);assert.equal(saved.entries[0].status,'pending-adapter');assert.ok(saved.entries[0].fields.includes('games[].rank'));
  assert.equal(JSON.stringify(core.project(imported.projectId)),before);assert.equal((await core.call('get_template',{templateId})).revision,0);
  const detail=await core.call('get_template',{templateId});assert.equal(detail.dataSourceMatch.entries[0].sample,undefined);
  await assert.rejects(core.call('configure_template_data_sources',args),e=>e.status===409);
  await assert.rejects(core.call('configure_template_data_sources',{...args,baseRevision:1,entries:[{requirement:first.needs[0].name,name:'错误',kind:'steamauto'}]}),/SteamAuto/);
  const restored=createCore(config);assert.deepEqual((await restored.call('get_template_data_sources',{templateId})).entries[0].sample,args.entries[0].sample);
 }finally{fs.rmSync(dataDir,{recursive:true,force:true});}
});
