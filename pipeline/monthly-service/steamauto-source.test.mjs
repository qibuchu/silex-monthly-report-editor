import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchSteamMonthly} from './steamauto-source.mjs';

const source={kind:'api',reference:'http://steam.example/api/v1/monthly-dashboard/?month={month}'};
const packet=()=>({schema_version:'2.0',report_month:'2026-09',previous_month:'2026-08',snapshot_id:'s1',calculation_version:'1',status:'partial',
  issues:[{code:'reviews_are_current_snapshot'}],head:{top20:[],highlights:[],month:'2026-09',previous_month:'2026-08'},market:{review_trend:[],review_distribution:[]},new_releases:{gold:[],silver:[],bronze:[]},
  kpis:{review_rate_all:{value:0.9}}});

test('SteamAuto PPT source checks credentials before any monthly read and excludes current reviews',async()=>{
  const calls=[];
  const request=async input=>{calls.push(input.url);return {json:calls.length===1?{data:{pat_ok:true,jwt_ok:true}}:{code:0,data:packet()}};};
  const result=await fetchSteamMonthly('2026-09',source,{'X-API-Key':'test'},request);
  assert.deepEqual(calls.map(url=>new URL(url).pathname),['/api/v1/databrain/preflight','/api/v1/monthly-dashboard/']);
  assert.equal(result.data.kpis.review_rate_all.value,null);
  assert.ok(result.audit.excluded.some(item=>item.path==='kpis.review_rate_all'));
  assert.equal(result.audit.snapshot_id,'s1');
});

test('expired DataBrain credentials stop the entire SteamAuto fetch',async()=>{
  let calls=0;
  await assert.rejects(fetchSteamMonthly('2026-09',source,{},async()=>{calls++;return {json:{data:{pat_ok:true,jwt_ok:false}}};}),/暂停取数和生成/);
  assert.equal(calls,1);
});

test('wrong month and failed monthly credentials cannot produce a PPT packet',async()=>{
  await assert.rejects(fetchSteamMonthly('2026-09',source,{},async input=>({json:input.url.includes('preflight')?{data:{pat_ok:true,jwt_ok:true}}:{code:0,data:{...packet(),report_month:'2026-08'}}})),/统计月份/);
  await assert.rejects(fetchSteamMonthly('2026-09',source,{},async input=>{if(input.url.includes('preflight'))return {json:{data:{pat_ok:true,jwt_ok:true}}};throw Error('401');}),/本次生成已暂停/);
});
