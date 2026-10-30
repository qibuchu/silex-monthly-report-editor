import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createCore} from './core.mjs';
import {applyTemplate} from './templates.mjs';
const object=(id,content,layer='fixed',binding=id)=>({attributes:{'data-object-id':id,'data-content-layer':layer,'data-refresh-policy':layer==='fixed'?'replace':'preserve','data-binding-id':binding,'data-kind':'text'},style:{left:'20px',top:'20px',width:'200px',height:'100px',color:'#123456'},content});
const make=()=>({format:'steam-grapesjs-v2',deck:{css:'p{margin:0}',notes:{report_month:'2026-08'},pages:[{name:'封面',width:1280,height:720,objects:[object('title','<p>旧月标题</p>'),object('manual','<p>旧月分析</p>','manual'),object('logo','<p>品牌</p>','template'),object('missing','<p>旧月数字</p>')]}]}});
const wait=async(core,id)=>{for(let n=0;n<100;n++){const task=await core.call('get_task',{taskId:id});if(task.status!=='running')return task;await new Promise(r=>setTimeout(r,25));}throw Error('timeout');};
test('custom template can be removed without deleting reports or editable archive',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'monthly-template-delete-'));
 try{const core=createCore({dataDir:dir,publicUrl:'http://localhost:4320'}),source=core.importProject({project:make(),month:'2026-08'}).projectId,created=await core.call('create_template',{projectId:source,baseRevision:1,title:'临时模板'});
  const initial=(await core.call('list_templates')).length;core.db.templateData[created.templateId]={revision:1,month:'2026-08'};core.db.projects[source].template={id:created.templateId,title:'临时模板',revision:1};
  await assert.rejects(core.call('delete_template',{templateId:created.templateId,baseRevision:1,projectRevision:1}),e=>e.status===409);
  const builtin=(await core.call('list_templates')).find(t=>t.builtin);await assert.rejects(core.call('delete_template',{templateId:builtin.id,baseRevision:0,projectRevision:1}),/内置模板不能删除/);
  const result=await core.call('delete_template',{templateId:created.templateId,baseRevision:0,projectRevision:1});assert.equal(result.deleted,true);assert.equal(result.existingReports,1);
  assert.equal((await core.call('list_templates')).length,initial-1);await assert.rejects(core.call('get_template',{templateId:created.templateId}),e=>e.status===404);
  assert.equal(core.project(source).revision,1);assert.equal(core.project(source).template.id,created.templateId);assert.equal(core.project(created.projectId).kind,'template-draft');assert.equal(core.db.templateData[created.templateId].revision,1);assert.ok(core.db.deletedTemplates[created.templateId]);
  assert.equal((await core.call('get_template_ai_task',{templateId:created.templateId})).status,'empty');
  const reopened=createCore({dataDir:dir,publicUrl:'http://localhost:4320'});assert.ok(reopened.db.deletedTemplates[created.templateId]);assert.equal((await reopened.call('list_templates')).length,initial-1);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('builtin template creates an isolated editable version without adding a report',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'monthly-builtin-fork-')),dataDir=path.join(root,'data'),toolkit=path.join(root,'toolkit');fs.mkdirSync(toolkit);
 fs.writeFileSync(path.join(toolkit,'run.cjs'),`const fs=require('fs'),path=require('path');const a=process.argv.slice(2),v=n=>a[a.indexOf(n)+1];if(v('--profile')!=='data-supported')process.exit(2);fs.mkdirSync(v('--out'),{recursive:true});fs.writeFileSync(path.join(v('--out'),'draft.json'),JSON.stringify({project:${JSON.stringify(make())}}));`);
 try{
  const core=createCore({dataDir,toolkitDir:toolkit,publicUrl:'http://localhost:4320'});
  await assert.rejects(core.call('fork_builtin_template',{templateId:'steam-data',baseRevision:2}),e=>e.status===409);
  const result=await core.call('fork_builtin_template',{templateId:'steam-data',baseRevision:1});
  const detail=await core.call('get_template',{templateId:result.templateId});
  assert.equal(detail.origin,'builtin');assert.equal(detail.sourceBuiltinId,'steam-data');assert.equal(detail.revision,0);
  assert.equal(detail.profile,'data-supported');assert.equal(core.project(result.projectId).kind,'template-draft');
  assert.equal(core.project(result.projectId).project.deck.notes.templateSeed.month,'2026-08');
  assert.equal((await core.call('list_projects')).filter(p=>p.kind!=='template-draft').length,0);
  assert.equal((await core.call('get_template',{templateId:'steam-data'})).revision,1);
  await core.call('publish_template',{templateId:result.templateId,baseRevision:0,projectRevision:1,rules:detail.rules});
  assert.equal((await core.call('get_template',{templateId:result.templateId})).revision,1);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('builtin template can be edited in place and keeps version one available',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'monthly-builtin-edit-')),dataDir=path.join(root,'data'),toolkit=path.join(root,'toolkit');fs.mkdirSync(toolkit);
 fs.writeFileSync(path.join(toolkit,'run.cjs'),`const fs=require('fs');const a=process.argv.slice(2),v=n=>a[a.indexOf(n)+1];fs.mkdirSync(v('--out'),{recursive:true});fs.writeFileSync(v('--out')+'/draft.json',JSON.stringify({project:${JSON.stringify(make())}}));`);
 try{
  const core=createCore({dataDir,toolkitDir:toolkit,publicUrl:'http://localhost:4320'});
  const enabled=await core.call('enable_builtin_template_editing',{templateId:'steam-data',baseRevision:1});
  assert.equal(enabled.templateId,'steam-data');assert.equal((await core.call('list_templates')).length,3);
  const detail=await core.call('get_template',{templateId:'steam-data'});assert.equal(detail.builtin,true);assert.equal(detail.projectId,enabled.projectId);assert.equal(detail.projectRevision,1);
  assert.equal((await core.call('enable_builtin_template_editing',{templateId:'steam-data',baseRevision:1})).projectId,enabled.projectId);
  await assert.rejects(core.call('delete_template',{templateId:'steam-data',baseRevision:1,projectRevision:1}),/内置模板不能删除/);
  const ai=await core.call('set_visual_rule_selection',{editingTargetId:'builtin-template-test-12345',templateId:'steam-data',pageIndex:0,selectionType:'page',selectionId:'0',dirty:false,sessionId:'test',sequence:1});assert.equal(ai.templateId,'steam-data');
  const context=await core.call('get_visual_rule_context',{editingTargetId:'builtin-template-test-12345'});assert.equal(context.projectId,enabled.projectId);
  const published=await core.call('publish_template',{templateId:'steam-data',baseRevision:1,projectRevision:1,rules:detail.rules});assert.equal(published.revision,2);
  assert.equal((await core.call('list_templates')).length,3);
  const oldTask=await core.call('generate_monthly_report',{month:'2026-08',data:{report_month:'2026-08'},templateId:'steam-data',templateRevision:1});assert.equal((await wait(core,oldTask.id)).status,'succeeded');
  const newTask=await core.call('generate_monthly_report',{month:'2026-08',data:{report_month:'2026-08'},templateId:'steam-data',templateRevision:2});assert.equal((await wait(core,newTask.id)).status,'succeeded');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('data source library versions definitions and templates bind a selected source',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'monthly-source-library-'));
 try{
  const core=createCore({dataDir:dir,publicUrl:'http://localhost:4320'});
  assert.deepEqual((await core.call('list_data_sources')).map(s=>s.id),['steamauto','minigame-monthly']);
  const source=await core.call('save_data_source',{baseRevision:0,name:'业务接口',kind:'api',reference:'https://example.com/monthly?month={month}',description:'目标月接口'});
  const projectId=core.importProject({project:make(),month:'2026-08'}).projectId;
  const template=await core.call('create_template',{projectId,baseRevision:1,title:'业务模板',dataSourceId:source.id});
  assert.equal((await core.call('get_template',{templateId:template.templateId})).dataSourceId,source.id);
  await assert.rejects(core.call('delete_data_source',{id:source.id,baseRevision:1}),e=>e.status===409);
  await assert.rejects(core.call('save_data_source',{id:source.id,baseRevision:0,name:'旧版',kind:'api',reference:'https://example.com/?month={month}'}),e=>e.status===409);
  const changed=await core.call('save_data_source',{id:source.id,baseRevision:1,name:'业务接口新版',kind:'api',reference:'https://example.com/v2?month={month}'});assert.equal(changed.revision,2);
  const pinned=await core.call('get_template_data_matches',{templateId:template.templateId});assert.match(pinned.dataSource.reference,/\/monthly\?/);
  await core.call('bind_template_data_source',{templateId:template.templateId,dataSourceId:source.id,baseRevision:0,projectRevision:1});
  const latest=await core.call('get_template_data_matches',{templateId:template.templateId});assert.match(latest.dataSource.reference,/\/v2\?/);
  const detail=await core.call('get_template',{templateId:template.templateId});await core.call('publish_template',{templateId:template.templateId,baseRevision:0,projectRevision:1,rules:detail.rules});
  await assert.rejects(core.call('generate_monthly_report',{month:'2026-08',templateId:template.templateId,data:{report_month:'2026-08'}}),/导入目标月数据/);
  const reopened=createCore({dataDir:dir,publicUrl:'http://localhost:4320'});assert.equal((await reopened.call('list_data_sources')).find(s=>s.id===source.id).revision,2);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('PPTX creates an isolated unpublished template with safe policies and archived media',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'monthly-pptx-template-'));
 try{
  const core=createCore({dataDir:dir,publicUrl:'http://localhost:4320'}),project=make();
  project.deck.notes={template_origin:'pptx',pptx_imports:[{filename:'月报.pptx',pages:[{unsupported:1}]}]};
  project.deck.pages[0].objects[0].attributes['data-content-layer']='manual';
  project.deck.pages[0].objects.push({...object('image','<img src="data:image/png;base64,aGVsbG8=">','manual'),attributes:{'data-object-id':'image','data-kind':'image','data-content-layer':'manual'}});
  const before=(await core.call('list_projects')).length;
  assert.throws(()=>core.importPptxTemplate({title:'',profile:'full',project}),/模板名称/);
  const created=core.importPptxTemplate({title:'PPT导入模板',profile:'full',project});
  const t=await core.call('get_template',{templateId:created.templateId});
  assert.equal(t.revision,0);assert.equal(t.pages.length,1);assert.equal(t.origin,'pptx');
  assert.equal(core.project(created.projectId).kind,'template-draft');assert.equal((await core.call('list_projects')).length,before+1);
  assert.equal(t.rules.objects.find(o=>o.id==='title').mode,'blank');assert.equal(t.rules.objects.find(o=>o.id==='logo').mode,'static');assert.equal(t.rules.objects.find(o=>o.id==='image').mode,'blank');
  assert.match(core.project(created.projectId).project.deck.pages[0].objects.at(-1).content,/\/assets\//);
  assert.ok(core.archive(created.projectId).assets);
  await assert.rejects(core.call('generate_monthly_report',{month:'2026-09',templateId:created.templateId,data:{report_month:'2026-09'}}),/已发布模板/);
  const rules=t.rules;await assert.rejects(core.call('publish_template',{templateId:created.templateId,baseRevision:0,projectRevision:1,rules}),/核对PPT/);rules.recognitionReviewed=true;await core.call('publish_template',{templateId:created.templateId,baseRevision:0,projectRevision:1,rules});
  assert.equal((await core.call('get_template',{templateId:created.templateId})).revision,1);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('template publication, isolation and generation use versioned tool paths',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'monthly-templates-'));const toolkit=path.join(dir,'toolkit');fs.mkdirSync(toolkit);
 fs.writeFileSync(path.join(toolkit,'run.cjs'),`const fs=require('fs'),path=require('path');const a=process.argv.slice(2),v=n=>a[a.indexOf(n)+1];const p=${JSON.stringify(make())};p.deck.pages[0].objects[0].content='<p>本期标题</p>';p.deck.pages[0].objects=p.deck.pages[0].objects.filter(o=>o.attributes['data-object-id']!=='missing');fs.mkdirSync(v('--out'),{recursive:true});setTimeout(()=>fs.writeFileSync(path.join(v('--out'),'draft.json'),JSON.stringify({project:p})),50);`);
 try{
 const core=createCore({dataDir:path.join(dir,'data'),publicUrl:'http://localhost:4320',toolkitDir:toolkit});
 const source=core.importProject({project:make(),month:'2026-08'}).projectId;
 assert.equal((await core.call('list_templates')).length,3);
 const created=await core.call('create_template',{projectId:source,baseRevision:1,title:'测试模板'});assert.notEqual(created.projectId,source);
 await assert.rejects(core.call('generate_monthly_report',{month:'2026-08',data:{report_month:'2026-08'},templateId:created.templateId}),/已发布/);
 let detail=await core.call('get_template',{templateId:created.templateId});const rules=detail.rules;rules.objects.find(o=>o.id==='logo').mode='static';
 core.updateEditorContext(created.projectId,{sessionId:'operator',pageIndex:0,dirty:true});
 await assert.rejects(core.call('publish_template',{templateId:created.templateId,baseRevision:0,projectRevision:1,rules}),e=>e.status===409);
 core.updateEditorContext(created.projectId,{sessionId:'operator',pageIndex:0,dirty:false});
 assert.equal((await core.call('publish_template',{templateId:created.templateId,baseRevision:0,projectRevision:1,rules})).revision,1);
 await assert.rejects(core.call('publish_template',{templateId:created.templateId,baseRevision:0,projectRevision:1,rules}),e=>e.status===409);
 const task=await core.call('generate_monthly_report',{month:'2026-08',data:{report_month:'2026-08'},templateId:created.templateId});
 await core.call('apply_object_patch',{projectId:created.projectId,baseRevision:1,requirement:'修改编辑稿',changes:[{id:'title',style:{color:'#ff0000'}}]});
 const done=await wait(core,task.id);assert.equal(done.status,'succeeded',done.error);
 const output=core.project(done.projectId).project,items=output.deck.pages[0].objects;
 assert.equal(items[0].content,'<p>本期标题</p>');assert.equal(items[0].style.color,'#123456');
 assert.equal(items[1].content,'<p></p>');assert.equal(items[2].content,'<p>品牌</p>');assert.equal(items[3].content,'<p></p>');
 assert.ok(output.deck.notes.issues.some(i=>i.code==='template_binding_missing'));assert.equal(output.deck.notes.template.revision,1);assert.equal(core.project(source).revision,1);
 detail=await core.call('get_template',{templateId:created.templateId});
 await core.call('publish_template',{templateId:created.templateId,baseRevision:1,projectRevision:2,rules:detail.rules});assert.equal(output.deck.notes.template.revision,1);
 const reopened=createCore({dataDir:path.join(dir,'data'),publicUrl:'http://localhost:4320',toolkitDir:toolkit});assert.equal((await reopened.call('get_template',{templateId:created.templateId})).revision,2);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('new highlight data replaces prior selection without duplicate IDs or CSS',()=>{
 const fresh=make();fresh.deck.pages[0].objects=[object('movement-card-0-name','new','fixed','head.highlights.2.name')];
 const layout=make();layout.deck.pages[0].objects=[object('movement-card-0-name','old','fixed','head.highlights.1.name')];
 const result=applyTemplate(fresh,{project:layout,rules:{objects:[]}},{id:'custom',revision:1});
 assert.equal(result.deck.pages[0].objects.length,1);assert.equal(result.deck.pages[0].objects[0].content,'new');assert.equal(result.deck.css,layout.deck.css);
});
test('template typography and renamed binding keep new values and stable object IDs',()=>{
 const fresh=make();fresh.deck.pages[0].objects=[object('title','<p><span>本期数据</span></p>')];
 const layout=make();layout.deck.pages[0].objects=[object('custom-title','<p id="my-p"><span style="font-size:32px">旧样例</span></p>')];
 const result=applyTemplate(fresh,{project:layout,rules:{objects:[{id:'custom-title',mode:'auto',binding:'title'}]}},{id:'t',revision:1});
 const title=result.deck.pages[0].objects[0];assert.match(title.content,/本期数据/);assert.doesNotMatch(title.content,/旧样例/);assert.match(title.content,/font-size:32px/);assert.equal(title.attributes.id,'custom-title');
});
