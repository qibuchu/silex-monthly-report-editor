import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {createGateway} from './gateway.mjs';
test('all editor routes require the service session or bearer token and reject foreign origins',async()=>{
 const token='test-only-'+ 'x'.repeat(40);
 const backend=http.createServer((req,res)=>res.end('editor '+req.url));await new Promise(r=>backend.listen(0,'127.0.0.1',r));
 const g=createGateway({token,editor:true,targetPort:backend.address().port,publicUrl:'http://localhost:14320/',editorUrl:'http://localhost:16805/'});await new Promise(r=>g.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+g.address().port;
 try{
  for(const path of ['/','/js/main.js','/api/website/','/download/a.zip'])assert.equal((await fetch(url+path)).status,401);
  assert.equal((await fetch(url+'/',{headers:{Authorization:'Bearer '+token}})).status,200);
  const cookie='monthly_session='+createHash('sha256').update(token).digest('hex');
  assert.equal(await (await fetch(url+'/api/website/',{headers:{Cookie:cookie}})).text(),'editor /api/website/');
  assert.equal((await fetch(url+'/',{headers:{Cookie:cookie,Origin:'https://other.invalid'}})).status,403);
 }finally{await new Promise(r=>g.close(r));await new Promise(r=>backend.close(r));}
});
