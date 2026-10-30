import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import os from 'node:os';
import {fetchDataInterface} from './data-interface.mjs';import {jsonSource,validateDataSources} from './template-data.mjs';
test('mobile monthly meta month is checked against the selected report month',()=>{
 const source=jsonSource('移动游戏',{data:[{game_id:'g1',game_name:'游戏',revenue:'100549991',revenue_growth_pct:'5.84'}],meta:{month:'2026-09',snapshot:{version:2}}});
 assert.equal(source.reportMonth,'2026-09');assert.equal(source.tables.find(t=>t.name==='data').rows[0][2],'100549991');
 assert.throws(()=>validateDataSources([source],'2026-08'),/月份与目标月份不一致/);
});
test('GET JSON interface returns actual values, uses transient headers, stops on expired credentials and rejects redirects',async t=>{
 const host=Object.values(os.networkInterfaces()).flat().find(x=>x.family==='IPv4'&&!x.internal)?.address;if(!host){t.skip('No intranet interface available');return;}
 const server=http.createServer((req,res)=>{if(req.url==='/expired'){res.writeHead(401);res.end();return;}if(req.url==='/redirect'){res.writeHead(302,{Location:'/data'});res.end();return;}assert.equal(req.headers['x-qa-auth'],'temporary-test-header');res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({report_month:'2026-08',上新总量:321,rows:[{游戏名:'接口验收',收入:123}]}));});
 await new Promise(resolve=>server.listen(0,host,resolve));const url='http://'+host+':'+server.address().port;
 try{const result=await fetchDataInterface({url:url+'/data',headers:{'X-QA-Auth':'temporary-test-header'}}),sources=validateDataSources([jsonSource(result.name,result.json)],'2026-08');assert.equal(sources[0].scalars.find(v=>v.label==='上新总量').value,'321');assert.equal(result.origin,'api:'+url+'/data');assert.ok(!JSON.stringify(result).includes('temporary-test-header'));
 await assert.rejects(fetchDataInterface({url:url+'/expired'}),e=>e.status===424);await assert.rejects(fetchDataInterface({url:url+'/redirect'}),/302/);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
