import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createService} from './server.mjs';

test('explicit network mode opens API and MCP without a login token',async()=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'monthly-auth-'));
 const {server}=createService({host:'0.0.0.0',publicUrl:'http://127.0.0.1:4320',authMode:'network',encryptionKey:'existing-secret',dataDir,workspaceRoot:path.resolve('../..'),toolkitDir:path.resolve('../../releases/monthly-toolkit-portable'),backupIntervalHours:0});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port;
 try{
  const health=await (await fetch(url+'/api/health')).json();
  assert.equal(health.authMode,'network');
  assert.equal((await fetch(url+'/api/tools')).status,200);
  assert.notEqual((await fetch(url+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
  assert.equal((await fetch(url+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"token":"existing-secret"}'})).status,401);
 }finally{await new Promise(resolve=>server.close(resolve));fs.rmSync(dataDir,{recursive:true,force:true});}
});
