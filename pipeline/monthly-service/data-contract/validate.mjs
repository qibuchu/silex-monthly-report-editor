import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

const monthPattern=/^\d{4}-(0[1-9]|1[0-2])$/;
const datePattern=/^\d{4}-\d{2}-\d{2}$/;
const idPattern=/^[a-z][a-z0-9_.-]{0,159}$/;
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const lastDay=month=>new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10);
const parseDay=value=>{
 if(typeof value!=='string'||!datePattern.test(value))return null;
 const day=new Date(value+'T00:00:00Z');return Number.isNaN(day.getTime())||day.toISOString().slice(0,10)!==value?null:day;
};
const pointer=(root,path)=>path.split('/').slice(1).reduce((value,key)=>value?.[key.replace(/~1/g,'/').replace(/~0/g,'~')],root);
const valueType=(type,value)=>value===null||(['count','money','ratio','rank'].includes(type)?typeof value==='number'&&Number.isFinite(value):type==='boolean'?typeof value==='boolean':typeof value==='string');

export function validateMonthlyData(data){
 const errors=[],fail=message=>errors.push(message);
 if(!isObject(data))return ['数据包必须是 JSON 对象'];
 if(data.contract_version!=='1.0')fail('contract_version 必须为 1.0');
 if(!monthPattern.test(data.report_month||''))fail('report_month 必须为 YYYY-MM');
 if(!['complete','partial'].includes(data.status))fail('status 必须为 complete 或 partial');
 if(!isObject(data.producer)||!idPattern.test(data.producer.data_source_id||'')||!Number.isInteger(data.producer.data_source_revision)||data.producer.data_source_revision<1||!data.producer.source_snapshot_id||!data.producer.adapter_version||!['source','operator-confirmed'].includes(data.producer.window_evidence))fail('producer 缺少来源、快照或窗口证据');
 if(!isObject(data.scope)||!data.scope.platform||!data.scope.region||!data.scope.population)fail('scope 须明确平台、地区和统计人群');
 const windows=new Map();
 if(!Array.isArray(data.windows)||!data.windows.length)fail('windows 至少包含目标月窗口');
 else for(const [i,w] of data.windows.entries()){
  if(!isObject(w)||!idPattern.test(w.id||'')||windows.has(w.id)) {fail(`windows[${i}] ID 无效或重复`);continue;}
  const start=parseDay(w.start),end=parseDay(w.end);if(!start||!end||end<start)fail(`windows[${i}] 日期无效`);
  if(!w.timezone||!w.purpose)fail(`windows[${i}] 缺少时区或用途`);
  if(w.kind==='monthly'&&start&&end&&(w.start.slice(0,7)!==w.end.slice(0,7)||w.start!==w.start.slice(0,7)+'-01'||w.end!==lastDay(w.start.slice(0,7))))fail(`windows[${i}] 月度窗口不是完整自然月`);
  else if(w.kind==='release_d0_d13'&&start&&end&&(w.release_date!==w.start||Math.round((end-start)/86400000)!==13))fail(`windows[${i}] 14 日窗口必须为发售日 D0 至 D13`);
  else if(!['monthly','release_d0_d13','custom'].includes(w.kind))fail(`windows[${i}] kind 无效`);
  if(w.observed_as_of&&!parseDay(w.observed_as_of))fail(`windows[${i}] observed_as_of 无效`);
  windows.set(w.id,w);
 }
 const report=windows.get('report_month');if(!report||report.kind!=='monthly'||report.start!==data.report_month+'-01'||report.end!==lastDay(data.report_month||'0000-01'))fail('report_month 窗口必须覆盖目标月完整自然月');
 const nullPaths=[],metricIds=new Set(),tableIds=new Set();
 if(!Array.isArray(data.metrics)||!Array.isArray(data.tables))fail('metrics 和 tables 必须为数组');
 else {
  for(const [i,m] of data.metrics.entries()){
   if(!isObject(m)||!idPattern.test(m.id||'')||metricIds.has(m.id)){fail(`metrics[${i}] ID 无效或重复`);continue;}metricIds.add(m.id);
   if(!windows.has(m.window_id)||!m.label||!m.unit||!isObject(m.origin)||!m.origin.path)fail(`metrics[${i}] 缺少窗口、单位或来源`);
   if(!valueType(m.type,m.value))fail(`metrics[${i}] 值与类型不符`);
   if(m.value===null)nullPaths.push(`/metrics/${i}/value`);
  }
  for(const [i,t] of data.tables.entries()){
   if(!isObject(t)||!idPattern.test(t.id||'')||tableIds.has(t.id)){fail(`tables[${i}] ID 无效或重复`);continue;}tableIds.add(t.id);
   if(!windows.has(t.window_id)||!t.label||!t.source_path||!t.row_key||!Array.isArray(t.columns)||!t.columns.length||!Array.isArray(t.rows)){fail(`tables[${i}] 结构或窗口不完整`);continue;}
   const columns=new Map();for(const [j,c] of t.columns.entries()){
    if(!isObject(c)||!idPattern.test(c.key||'')||columns.has(c.key)||!c.label||!c.unit||!c.source_field||c.window_id&&!windows.has(c.window_id))fail(`tables[${i}].columns[${j}] 无效或重复`);
    else columns.set(c.key,c);
   }
   const rowIds=new Set();for(const [j,row] of t.rows.entries()){
    if(!isObject(row)||typeof row.id!=='string'||!row.id||rowIds.has(row.id)||!isObject(row.values)){fail(`tables[${i}].rows[${j}] ID 或值无效`);continue;}rowIds.add(row.id);
    for(const [key,c] of columns){if(!Object.hasOwn(row.values,key))fail(`tables[${i}].rows[${j}] 缺少列 ${key}`);else{const value=row.values[key];if(!valueType(c.type,value))fail(`tables[${i}].rows[${j}].${key} 类型不符`);if(value===null)nullPaths.push(`/tables/${i}/rows/${j}/values/${key}`);}}
    for(const key of Object.keys(row.values))if(!columns.has(key))fail(`tables[${i}].rows[${j}] 未声明列 ${key}`);
   }
  }
 }
 if(!Array.isArray(data.missing))fail('missing 必须为数组');
 else {
  const reasons=new Set(['not_provided','window_unavailable','credential_expired','ambiguous_definition','source_error']),paths=new Set();
  for(const [i,m] of data.missing.entries()){
   if(!isObject(m)||typeof m.path!=='string'||!/^\/(metrics|tables)\//.test(m.path)||!reasons.has(m.reason)||!m.detail||paths.has(m.path)||pointer(data,m.path)!==null)fail(`missing[${i}] 路径、原因或空值不正确`);
   else paths.add(m.path);
  }
  for(const path of nullPaths)if(!paths.has(path))fail(`空值缺少 missing 记录：${path}`);
  if(data.status==='complete'&&data.missing.length)fail('complete 状态不能包含 missing');
  if(data.status==='partial'&&!data.missing.length)fail('partial 状态须列出缺失项');
 }
 return errors;
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 const file=process.argv[2];if(!file){process.stderr.write('用法：node validate.mjs 数据包.json\n');process.exitCode=2;}
 else{try{const errors=validateMonthlyData(JSON.parse(fs.readFileSync(file,'utf8')));if(errors.length){process.stderr.write(errors.join('\n')+'\n');process.exitCode=1;}else process.stdout.write('月报数据契约 1.0 校验通过\n');}catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}}
}
