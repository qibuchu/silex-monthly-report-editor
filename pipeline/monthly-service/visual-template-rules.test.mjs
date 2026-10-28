import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createCore} from './core.mjs';
import {fillVisualTemplate} from './visual-template-rules.mjs';
const obj=(id,content,kind='text')=>({tagName:kind==='table'?'table':'div',attributes:{'data-object-id':id,'data-kind':kind,'data-name':id,'data-content-layer':kind==='text'&&id==='note'?'manual':'fixed'},style:{left:'20px',top:id==='board'?'80px':'10px',width:'600px',height:id==='board'?'260px':'40px'},content});
const project=()=>({format:'steam-grapesjs-v2',deck:{css:'.sample{color:#123456}',notes:{template_origin:'pptx',pptx_imports:[{filename:'test.pptx',pages:[]}]},pages:[{name:'8月榜单',width:800,height:450,background:'#f7f5f0',objects:[obj('heading','<p>8月榜单</p>'),obj('board','<tr><th>游戏</th><th>厂商</th></tr><tr><td>旧1</td><td>旧厂1</td></tr><tr><td>旧2</td><td>旧厂2</td></tr>','table'),obj('note','<p>旧月人工分析</p>')]}]}});
test('visual canvas rules save, preview continuation and publish with revision guards',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'monthly-visual-'));
 try{const core=createCore({dataDir:dir,publicUrl:'http://127.0.0.1:4320'}),created=core.importPptxTemplate({title:'PPT规则验收',project:project()}),templateId=created.templateId;
  const rows=Array.from({length:5},(_,i)=>['游戏'+(i+1),'厂商'+(i+1)]),source={name:'本月数据',reportMonth:'2026-09',tables:[{name:'榜单',columns:['游戏','厂商'],rows}],scalars:[]};
  const imported=await core.call('import_template_data',{templateId,baseRevision:0,templateRevision:0,projectRevision:1,month:'2026-09',confirmedWindow:true,sources:[source]});
  const canvas=await core.call('get_visual_rule_canvas',{templateId,pageIndex:0});assert.equal(canvas.pageIndex,0);assert.ok(canvas.objects.some(o=>o.id==='board'));
  const target=imported.targets.find(x=>x.id==='board');assert.ok(target);const rules={...canvas.rules,visual:true,pages:[{pageIndex:0,purpose:'畅销榜',mode:'always',continuation:'board'}],regions:[],objects:canvas.rules.objects.map(o=>({...o,mode:o.id==='note'?'blank':o.id==='heading'?'static':'auto'}))};
  const mapping={id:'board',kind:'table',sourceId:imported.sources[0].tables[0].id,columnMap:[0,1]};
  const draft=await core.call('save_visual_rule_draft',{templateId,baseRevision:0,projectRevision:1,templateRevision:0,dataRevision:imported.revision,rules,mappings:[mapping]});
  await assert.rejects(core.call('save_visual_rule_draft',{templateId,baseRevision:0,projectRevision:1,templateRevision:0,dataRevision:imported.revision,rules,mappings:[mapping]}),e=>e.status===409);
  await assert.rejects(core.call('publish_visual_rule_draft',{templateId,draftRevision:draft.revision,recognitionReviewed:true}),/先预览/);
  const preview=await core.call('preview_visual_rule_draft',{templateId,draftRevision:draft.revision});assert.equal(core.project(preview.projectId).project.deck.pages.length,3);assert.match(core.preview(preview.projectId),/游戏5/);assert.ok(!core.preview(preview.projectId).includes('旧月人工分析'));
  await assert.rejects(core.call('publish_visual_rule_draft',{templateId,draftRevision:draft.revision,recognitionReviewed:true}),/未在画布确认/);
  rules.classifications=canvas.recognition.filter(o=>o.confidence==='review').map(o=>({id:o.id,type:o.id==='board'?'data':o.id==='heading'?'date':'manual',confirmed:true}));
  const reviewed=await core.call('save_visual_rule_draft',{templateId,baseRevision:draft.revision,projectRevision:1,templateRevision:0,dataRevision:imported.revision,rules,mappings:[mapping]});
  await core.call('preview_visual_rule_draft',{templateId,draftRevision:reviewed.revision});
  const published=await core.call('publish_visual_rule_draft',{templateId,draftRevision:reviewed.revision,recognitionReviewed:true});assert.equal(published.revision,1);
  const generated=await core.call('generate_monthly_report',{templateId,month:'2026-09'});assert.equal(generated.status,'succeeded');assert.equal(core.project(generated.projectId).project.deck.pages.length,3);assert.match(core.preview(generated.projectId),/游戏5/);
  assert.equal(core.project(created.projectId).project.deck.pages.length,1,'template source remains a single editable page');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('local AI follows selected template, blocks unsaved rules, and patches only the selected draft',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'monthly-visual-ai-'));
 try{const core=createCore({dataDir:dir,publicUrl:'http://127.0.0.1:4320'}),created=core.importPptxTemplate({title:'AI规则验收',project:project()}),templateId=created.templateId,editingTargetId='local-visual-ai-test-12345';
  const select=(dirty,sequence)=>core.call('set_visual_rule_selection',{editingTargetId,templateId,pageIndex:0,selectionType:'object',selectionId:'note',dirty,sessionId:'canvas-test-session',sequence});
  await select(false,1);const context=await core.call('get_visual_rule_context',{editingTargetId});assert.equal(context.selectionId,'note');assert.equal(context.templateId,templateId);
  await select(true,2);await assert.rejects(core.call('apply_visual_rule_patch',{editingTargetId,templateId,baseRevision:0,projectRevision:1,templateRevision:0,dataRevision:0,requirement:'保留标题',changes:[{scope:'object',id:'heading',mode:'static'}]}),e=>e.status===409);
  await select(false,3);const patched=await core.call('apply_visual_rule_patch',{editingTargetId,templateId,baseRevision:0,projectRevision:1,templateRevision:0,dataRevision:0,requirement:'保留标题',changes:[{scope:'object',id:'heading',mode:'static'}]});assert.equal(patched.revision,1);
  assert.equal((await core.call('get_visual_rule_canvas',{templateId,pageIndex:0})).rules.objects.find(o=>o.id==='heading').mode,'static');
  await assert.rejects(core.call('apply_visual_rule_patch',{editingTargetId,templateId,baseRevision:0,projectRevision:1,templateRevision:0,dataRevision:0,requirement:'旧版本',changes:[{scope:'object',id:'heading',mode:'blank'}]}),e=>e.status===409);
  const layout=await core.call('apply_visual_template_patch',{editingTargetId,templateId,baseRevision:1,requirement:'调整标题字号',changes:[{id:'heading',style:{'font-size':'28px'}}]});assert.equal(layout.revision,2);assert.equal(core.project(created.projectId).project.deck.pages[0].objects[0].style['font-size'],'28px');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('one global AI connection switches templates without changing its MCP identity',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'monthly-global-ai-'));
 try{const core=createCore({dataDir:dir,publicUrl:'http://127.0.0.1:4320'}),a=core.importPptxTemplate({title:'模板A',project:project()}),b=core.importPptxTemplate({title:'模板B',project:project()}),editingTargetId='global-ai-connection-12345';
  const choose=(templateId,sequence)=>core.call('set_visual_rule_selection',{editingTargetId,templateId,pageIndex:0,selectionType:'page',selectionId:'0',dirty:false,sessionId:'dashboard-global-template',sequence});
  assert.equal((await core.call('get_template_ai_target',{editingTargetId})).status,'no_selection');
  await choose(a.templateId,1);assert.equal((await core.call('get_template_ai_target',{editingTargetId})).title,'模板A');
  await choose(b.templateId,2);assert.equal((await core.call('get_visual_rule_context',{editingTargetId})).templateId,b.templateId);
  await assert.rejects(core.call('get_visual_rule_context',{editingTargetId,templateId:a.templateId}),e=>e.status===409);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('explicit date, decoration, manual and unmatched external data policies preserve template semantics',()=>{
 const p=project();p.deck.pages[0].objects=[obj('date','<p>活动截止 2026.08.31</p>'),obj('logo','<p>固定品牌 8</p>'),obj('research','<p>上月人工分析</p>'),obj('metric','<p>上月收入 1234</p>')];
 const rules={profile:'full',structure:'pptx',description:'',visual:true,pages:[{pageIndex:0,purpose:'样例',mode:'always',continuation:''}],regions:[],objects:p.deck.pages[0].objects.map(o=>({id:o.attributes['data-object-id'],mode:'static'})),classifications:[{id:'date',type:'date',confirmed:true},{id:'logo',type:'decorative',confirmed:true},{id:'research',type:'manual',confirmed:true},{id:'metric',type:'data',confirmed:true}]};
 const result=fillVisualTemplate(p,[],[],'2026-09',()=>'',rules),byId=new Map(result.project.deck.pages[0].objects.map(o=>[o.attributes['data-object-id'],o]));
 assert.match(byId.get('date').content,/2026\.09\.30/);assert.match(byId.get('logo').content,/固定品牌 8/);assert.doesNotMatch(byId.get('research').content,/上月人工分析/);assert.doesNotMatch(byId.get('metric').content,/1234/);assert.ok(result.issues.some(i=>i.objectId==='metric'));
});
