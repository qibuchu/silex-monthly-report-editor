import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createCore} from './core.mjs';
import {runServerTemplateAi} from './template-ai.mjs';

const project={format:'steam-grapesjs-v2',deck:{css:'',notes:{template_origin:'pptx',pptx_imports:[{filename:'sample.pptx',pages:[]}]},pages:[{name:'月报',width:800,height:450,background:'#fff',objects:[{tagName:'div',attributes:{'data-object-id':'heading','data-kind':'text','data-name':'标题'},style:{left:'0px',top:'0px',width:'400px',height:'50px'},content:'<p>2026年8月月报</p>'},{tagName:'div',attributes:{'data-object-id':'analysis','data-kind':'text','data-name':'分析'},style:{left:'0px',top:'60px',width:'400px',height:'50px'},content:'<p>人工分析</p>'}]}]}};
test('PPT upload creates local AI batches and retains manual review',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'template-ai-test-'));
 try{const core=createCore({dataDir:dir,publicUrl:'http://127.0.0.1:4320'}),created=core.importPptxTemplate({title:'AI模板',project,aiMode:'local'});assert.equal(created.ai.total,1);
 const task=await core.call('get_template_ai_task',{templateId:created.templateId,mode:'local'});assert.equal(task.status,'pending');assert.equal(task.task.objects.length,2);
 assert.equal(task.prompt.source.id,'steamauto');assert.ok(task.prompt.bindings.includes('report.period_text'));
 await assert.rejects(core.call('submit_template_ai_task',{taskId:task.taskId,projectRevision:1,decisions:[]}),/不完整/);
 await core.call('submit_template_ai_task',{taskId:task.taskId,projectRevision:1,decisions:[{id:'heading',type:'date',confidence:'high',reason:'包含月份',binding:'report.period_text'},{id:'analysis',type:'manual',confidence:'medium',reason:'需人工编写',binding:''}]});
 const canvas=await core.call('get_visual_rule_canvas',{templateId:created.templateId,pageIndex:0});assert.equal(canvas.ai.status,'completed');assert.equal(canvas.recognition.find(r=>r.id==='heading').source,'ai');assert.equal(canvas.recognition.find(r=>r.id==='analysis').confidence,'review');assert.ok(canvas.pendingReviewCount>=1);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('a new source is passed to AI without SteamAuto bindings',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'template-ai-source-'));
 try{const core=createCore({dataDir:dir,publicUrl:'http://127.0.0.1:4320'});
 const source=await core.call('save_data_source',{baseRevision:0,name:'其他业务月报',kind:'upload',description:'用户上传的业务文件',sample:{month:'2026-08',income:10}});
 const created=core.importPptxTemplate({title:'新业务模板',project,aiMode:'local',dataSourceId:source.id});
 const task=await core.call('get_template_ai_task',{templateId:created.templateId,mode:'local'});
 assert.deepEqual(task.prompt.bindings,[]);assert.deepEqual(task.prompt.source.sampleFields,['month','income']);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('server model adapter validates structured decisions without network',async()=>{
 const task={pageIndex:0,pageName:'月报',pageRole:'概览',objects:[{id:'a',text:'标题'}]};
 const decisions=await runServerTemplateAi(task,{url:'https://configured.example.test/chat',key:'test',model:'test-model',fetchImpl:async(url,options)=>{assert.equal(url,'https://configured.example.test/chat');assert.equal(JSON.parse(options.body).response_format.type,'json_schema');return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({decisions:[{id:'a',type:'fixed',confidence:'high',reason:'固定标题',binding:''}]})}}]})};}});
 assert.equal(decisions[0].type,'fixed');
});
