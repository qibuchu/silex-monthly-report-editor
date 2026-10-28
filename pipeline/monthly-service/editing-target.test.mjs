import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createCore} from './core.mjs';
import {createService} from './server.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
test('explicit draft selection is isolated, durable, scoped over MCP and blocks stale-target edits',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'monthly-target-'));
 const config={dataDir:dir,host:'127.0.0.1',publicUrl:'http://127.0.0.1:1',token:'test-only'};
 const p={format:'steam-grapesjs-v2',deck:{css:'',pages:[{name:'封面',width:1920,height:1080,objects:[{attributes:{'data-object-id':'title','data-kind':'text'},style:{left:'10px',top:'10px',width:'300px',height:'100px'},content:'<p>原标题</p>'}]}]}};
 let service,client;
 try{
  let core=createCore(config);const a=core.importProject({project:p,month:'2026-08'}).projectId,b=core.importProject({project:p,month:'2026-09'}).projectId;
  const one='computer-one-123456',two='computer-two-123456';
  assert.equal((await core.call('get_editing_context',{editingTargetId:one})).status,'no_selection');
  await core.call('set_editing_target',{editingTargetId:one,projectId:a,baseRevision:0});
  await core.call('set_editing_target',{editingTargetId:two,projectId:b,baseRevision:0});
  await assert.rejects(core.call('set_editing_target',{editingTargetId:one,projectId:b,baseRevision:0}),e=>e.status===409);
  core.updateEditorContext(b,{sessionId:'unrelated-tab',pageIndex:0,focused:true});
  assert.equal((await core.call('get_editing_context',{editingTargetId:one})).projectId,a);
  assert.equal((await core.call('get_editing_context',{editingTargetId:two})).projectId,b);
  core.updateEditorContext(b,{sessionId:'dirty-tab',pageIndex:0,dirty:true});
  await assert.rejects(core.call('set_editing_target',{editingTargetId:one,projectId:b,baseRevision:1}),e=>e.status===409);
  core=createCore(config);assert.equal((await core.call('get_editing_context',{editingTargetId:one})).projectId,a);
  service=createService(config);await new Promise(r=>service.server.listen(0,'127.0.0.1',r));config.publicUrl='http://127.0.0.1:'+service.server.address().port;
  client=new Client({name:'selection-test',version:'1'});await client.connect(new StreamableHTTPClientTransport(new URL(config.publicUrl+'/mcp?editingTargetId='+one),{requestInit:{headers:{Authorization:'Bearer test-only'}}}));
  const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});return {error:r.isError,value:JSON.parse(r.content[0].text)};};
  assert.equal((await call('get_editing_context')).value.projectId,a);
  assert.equal((await call('get_template_ai_target')).value.status,'no_selection');
  assert.equal((await call('get_template_ai_target',{editingTargetId:two})).value.status,409);
  const patch={projectId:a,baseRevision:1,requirement:'改标题',changes:[{id:'title',content:'<p>新标题</p>'}]};
  assert.equal((await call('apply_object_patch',patch)).value.revision,2);
  await call('set_editing_target',{editingTargetId:one,projectId:b,baseRevision:1});
  assert.equal((await call('apply_object_patch',{...patch,baseRevision:2})).value.status,409);
  assert.equal((await call('get_editing_context')).value.projectId,b);
  assert.equal((await call('get_editing_context',{projectId:a})).value.status,409);
  // The original per-object/baseRevision write guard remains active independently of selection.
  assert.equal((await call('apply_object_patch',{...patch,projectId:b,baseRevision:999})).value.status,409);
  const api=await fetch(config.publicUrl+'/api/call',{method:'POST',headers:{Authorization:'Bearer test-only','Content-Type':'application/json'},body:JSON.stringify({name:'get_editing_context',arguments:{},editingTargetId:two})});
  assert.equal((await api.json()).projectId,b);
  await call('clear_editing_target',{editingTargetId:one,baseRevision:2});assert.equal((await call('get_editing_context')).value.status,'no_selection');assert.equal((await call('apply_object_patch',{...patch,baseRevision:2})).value.status,409);
  assert.equal((await call('get_editing_target',{editingTargetId:two})).value.projectId,b);
 }finally{await client?.close();if(service)await new Promise(r=>service.server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
