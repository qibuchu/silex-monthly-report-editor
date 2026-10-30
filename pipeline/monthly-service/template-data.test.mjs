import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {createCore} from './core.mjs';import {jsonSource,validateDataSources,matchTemplateData,fillTemplateData} from './template-data.mjs';import {renderImportedChart} from './template-chart-render.mjs';import {fetchDataInterface} from './data-interface.mjs';
const tr=values=>'<tr>'+values.map(v=>'<td style="border:1px solid #ddd"><p style="color:#123456">'+v+'</p></td>').join('')+'</tr>';
const obj=(id,content,kind='text',extra={})=>({tagName:kind==='table'?'table':'div',attributes:{'data-object-id':id,'data-kind':kind,...extra},style:{left:'10px',top:'100px',width:'600px',height:'300px'},content});
const project=()=>({format:'steam-grapesjs-v2',deck:{css:'p{margin:0}',notes:{template_origin:'pptx',pptx_imports:[{filename:'模板.pptx'}]},pages:[{name:'榜单',width:1920,height:1080,objects:[obj('table',tr(['排名','游戏名','收入'])+tr(['9','旧名','0'])+tr(['10','旧名2','0']),'table'),obj('kpi','<p>上新总量 <span>9</span><b>99</b></p>'),obj('unknown','<p>DAU 123</p>'),obj('chart','<svg/>','chart',{'data-pptx-chart':JSON.stringify({title:'营收趋势',categories:['旧月'],series:[{name:'总收入',values:[999],color:'#002b5c'}],type:'line',stacked:false,legend:true})})]}]}});
const raw=()=>[{name:'8月数据',json:{report_month:'2026-08',上新总量:500,榜单:[{收入:'100万',游戏名:'新游戏A',排名:1},{收入:'50万',游戏名:'新游戏B',排名:2}],营收趋势:[{月份:'7月',总收入:100},{月份:'8月',总收入:150}]}}];
test('stored API header is encrypted, redacted and used only for the bound URL',async t=>{
 const host=Object.values(os.networkInterfaces()).flat().find(x=>x.family==='IPv4'&&!x.internal)?.address;if(!host){t.skip('No intranet interface');return;}
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'monthly-secret-'));let seen='';
 const server=http.createServer((req,res)=>{seen=req.headers['x-api-key']||'';res.writeHead(seen==='private-test-key'?200:401,{'Content-Type':'application/json'});res.end(JSON.stringify({data:[{game_id:'g1',game_name:'测试游戏'}],meta:{month:'2026-08'}}));});
 await new Promise(resolve=>server.listen(0,host,resolve));
 try{const core=createCore({dataDir:dir,publicUrl:'http://127.0.0.1:4320',token:'long-private-service-token-for-tests'}),reference=`http://${host}:${server.address().port}/monthly?month={month}`;
  const source=await core.call('save_data_source',{baseRevision:0,name:'手游接口',kind:'api',reference,secretHeaders:{'X-API-Key':'private-test-key'}});
  assert.equal(source.hasSecret,true);assert.equal((await core.call('list_data_sources',{})).find(s=>s.id===source.id).hasSecret,true);
  assert.equal(fs.readFileSync(path.join(dir,'store.json'),'utf8').includes('private-test-key'),false);
  const template=core.importPptxTemplate({title:'模板',project:project(),dataSourceId:source.id});
  const result=await core.call('import_template_data',{templateId:template.templateId,baseRevision:0,templateRevision:0,projectRevision:1,month:'2026-08',confirmedWindow:true,sources:[],interface:{url:reference.replace('{month}','2026-08')}});
  assert.equal(seen,'private-test-key');assert.equal(result.month,'2026-08');
 }finally{await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
});
test('real sources match table columns, scalar and chart series; ambiguous sources stay unselected and dates cannot drift',()=>{
 const sources=validateDataSources(raw().map(s=>jsonSource(s.name,s.json)),'2026-08'),p=project(),targets=matchTemplateData(p,sources);const mappings=targets.flatMap(t=>t.suggestion?[t.suggestion]:[]);assert.equal(mappings.length,3);
 const filled=fillTemplateData(p,sources,mappings,'2026-08',renderImportedChart);const objects=filled.project.deck.pages[0].objects;
 assert.match(objects[0].content,/新游戏A/);assert.match(objects[0].content,/100万/);assert.match(objects[0].content,/#123456/);assert.ok(!objects[0].content.includes('旧名'));assert.match(objects[1].content,/500/);assert.ok(!objects[1].content.includes('99'));assert.ok(!objects[2].content.includes('123'));assert.match(objects[3].content,/<svg/);assert.deepEqual(JSON.parse(objects[3].attributes['data-pptx-chart']).series[0].values,[100,150]);assert.equal(p.deck.pages[0].objects[0].content.includes('旧名'),true);
 const ambiguous=matchTemplateData(p,[...sources,{...sources[0],id:'different',tables:[],scalars:sources[0].scalars.map(v=>({...v,id:'duplicate-'+v.id}))}]);assert.equal(ambiguous.find(t=>t.id==='kpi').suggestion,null);
 assert.throws(()=>validateDataSources([jsonSource('旧月',{report_month:'2026-07'})],'2026-08'),/月份/);
 assert.throws(()=>fillTemplateData(p,sources,[{id:'kpi',kind:'text',sourceId:'missing'}],'2026-08',renderImportedChart),/字段不存在/);
});
test('actual data import, preview, publication and generation work without Steam generator or altering original template',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'monthly-actual-data-'));try{const core=createCore({dataDir:dir,publicUrl:'http://localhost:4320'}),t=core.importPptxTemplate({title:'自定义月报',project:project()}),before=JSON.stringify(core.project(t.projectId));
 const imported=await core.call('import_template_data',{templateId:t.templateId,baseRevision:0,templateRevision:0,projectRevision:1,month:'2026-08',confirmedWindow:true,sources:[...raw(),{name:'口径参考',tables:[],scalars:[],referenceSheets:[{name:'口径说明',reason:'参考材料',rows:[['收入不含广告估算'],['指标与统计窗口需核对']]}]}]});assert.equal(imported.targets.length,4);assert.equal(imported.sources[1].referenceSheets[0].rows[0][0],'收入不含广告估算');
 const args={templateId:t.templateId,baseRevision:imported.revision,templateRevision:0,projectRevision:1,mappings:imported.targets.flatMap(t=>t.suggestion?[t.suggestion]:[])};
 const preview=await core.call('generate_template_data_preview',args);assert.equal(preview.filled,3);assert.equal(JSON.stringify(core.project(t.projectId)),before);assert.match(core.preview(preview.projectId),/新游戏A/);
 await assert.rejects(core.call('generate_template_data_preview',args),e=>e.status===409);
 const detail=await core.call('get_template',{templateId:t.templateId});await core.call('publish_template',{templateId:t.templateId,baseRevision:0,projectRevision:1,rules:{...detail.rules,recognitionReviewed:true}});
 const task=await core.call('generate_monthly_report',{month:'2026-08',templateId:t.templateId});assert.equal(task.status,'succeeded');assert.match(core.preview(task.projectId),/新游戏B/);
 await assert.rejects(core.call('generate_monthly_report',{month:'2026-09',templateId:t.templateId}),/目标月/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('data interfaces reject local metadata targets without issuing a request',async()=>{
 await assert.rejects(fetchDataInterface({url:'http://127.0.0.1/api'}),/本机/);await assert.rejects(fetchDataInterface({url:'http://169.254.169.254/'}),/元数据/);await assert.rejects(fetchDataInterface({url:'file:///etc/passwd'}),/HTTP/);
});
test('monthly API month and notes are preserved and conflicting ranges are rejected',()=>{
 const source=jsonSource('月报接口',{month:'2026-09',range:{start:'2026-09-01',end:'2026-09-30'},notes:['月均排名按上榜天数计算']});
 const saved=validateDataSources([source],'2026-09')[0];assert.equal(saved.reportMonth,'2026-09');assert.equal(saved.windowEvidence,'source');assert.equal(saved.referenceSheets[0].rows[0][0],'月均排名按上榜天数计算');
 assert.throws(()=>validateDataSources([source],'2026-08'),/月份/);assert.throws(()=>jsonSource('错误窗口',{month:'2026-09',range:{start:'2026-10-01'}}),/范围/);assert.throws(()=>jsonSource('失败',{success:false}),/业务失败/);
});
