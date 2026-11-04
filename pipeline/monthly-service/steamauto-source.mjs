import {createRequire} from 'node:module';
import {fetchDataInterface} from './data-interface.mjs';

const require=createRequire(import.meta.url);
const {prepareMonthlyData}=require('../../workflow/data-quality.cjs');

export async function fetchSteamMonthly(month,source,headers={},request=fetchDataInterface){
  if(source?.kind!=='api'||!source.reference?.includes('{month}'))throw Error('SteamAuto 自动取数尚未配置接口地址，请在数据源库配置月报接口');
  const url=new URL(source.reference.replaceAll('{month}',encodeURIComponent(month)));
  if(!/^\/api\/v1\/monthly-dashboard\/?$/.test(url.pathname))throw Error('SteamAuto 月报接口路径不正确');
  const preflight=new URL('/api/v1/databrain/preflight',url);
  let checked;
  try{checked=(await request({url:preflight.toString(),headers,timeoutMs:30000})).json;}
  catch(error){throw Error(`SteamAuto 凭据预检失败，请先续期凭据再生成：${error.message}`);}
  const state=checked?.data||checked;
  if(state?.pat_ok!==true||state?.jwt_ok!==true)throw Error('DataBrain PAT 或 JWT 已过期；暂停取数和生成，请续期凭据后重试');
  let response;
  try{response=(await request({url:url.toString(),headers,timeoutMs:600000,maxBytes:30*1024*1024})).json;}
  catch(error){throw Error(`SteamAuto 取数失败；本次生成已暂停：${error.message}`);}
  if(response?.error||response?.code!==0)throw Error(`SteamAuto 月报接口失败：${String(response?.error||response?.message||'未知错误').slice(0,250)}`);
  const raw=response.data;
  const errors=[];
  for(const field of ['schema_version','report_month','previous_month','snapshot_id','calculation_version','status','issues','head','market','new_releases'])if(raw?.[field]==null)errors.push(`缺少 ${field}`);
  if(raw?.schema_version!=='2.0')errors.push('月报数据契约版本不是 2.0');
  if(raw?.report_month!==month)errors.push('月报数据统计月份与所选月份不一致');
  if(!Array.isArray(raw?.head?.top20)||!Array.isArray(raw?.head?.highlights))errors.push('头部榜单格式不正确');
  if(!Array.isArray(raw?.issues))errors.push('上游问题清单格式不正确');
  if(errors.length)throw Error(`SteamAuto 数据包校验失败：${errors.join('；')}`);
  let prepared;
  try{prepared=prepareMonthlyData(raw);}catch(error){throw Error(`SteamAuto 时间窗口核验失败：${error.message}`);}
  const audit={month,snapshot_id:raw.snapshot_id,data_cutoff:raw.data_cutoff||null,computed_at:raw.computed_at||null,
    status:raw.status,contract_errors:[],excluded:prepared.blocked,issues:raw.issues};
  return {data:prepared.data,audit};
}
