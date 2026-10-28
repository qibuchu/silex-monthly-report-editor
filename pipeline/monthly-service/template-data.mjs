import {refreshPeriodText} from './template-recognition.mjs';
import {renderSentence} from './data-sentence.mjs';
import {detectPptDataRegions} from './ppt-data-regions.mjs';
import {matchSourceViews} from './minigame-data-fields.mjs';
import {blankContent,isImageSlot} from './image-slot.mjs';
const fail=m=>{throw Object.assign(Error(m),{status:400});};
export const plain=s=>String(s??'').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
const norm=s=>plain(s).toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cell=v=>v===null||v===undefined?'':typeof v==='object'?JSON.stringify(v):String(v);
export function matrixTable(name,matrix,headerRow){
 if(!Array.isArray(matrix)||matrix.length>10001)fail('单个数据表最多10000行');
 const rows=matrix.map(r=>Array.isArray(r)?r.map(cell):[]);
 const h=headerRow??rows.findIndex(r=>r.filter(v=>v.trim()).length>=2&&r.some(v=>v&&!/^[-+\d.,%]+$/.test(v)));
 if(h<0||!rows[h])fail('没有找到表头，请提供带字段名称的数据表');
 const columns=rows[h].map(v=>v.trim());if(columns.length>100)fail('单表最多100列');
 if(columns.some((v,i)=>v&&columns.indexOf(v)!==i))fail('表头字段重复，请先区分列名：'+name);
 return {name,columns,rows:rows.slice(h+1).filter(r=>r.some(Boolean)).map(r=>columns.map((_,i)=>r[i]||'')),headerRow:h+1};
}
export function jsonSource(name,data){
 const tables=[],scalars=[],referenceSheets=[];let visited=0;
 if(data?.success===false)fail('数据接口返回业务失败，未导入数据');
 const months=[data?.report_month,data?.month].filter(v=>typeof v==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(v));if(new Set(months).size>1)fail('接口月份字段互相冲突');const reportMonth=months[0]||null;
 if(reportMonth&&data?.range&&[data.range.start,data.range.end].some(v=>typeof v==='string'&&!v.startsWith(reportMonth+'-')))fail('接口统计范围与月份不一致');
 function walk(v,p,depth){if(++visited>20000||depth>10)fail('JSON结构过大或嵌套过深');
  if(Array.isArray(v)){
   if(v.length&&v.every(x=>x&&typeof x==='object'&&!Array.isArray(x))){const columns=[...new Set(v.flatMap(x=>Object.keys(x)))];tables.push({name:p||name,columns,rows:v.map(x=>columns.map(k=>cell(x[k])))});}
   else if(v.length&&v.every(Array.isArray))tables.push(matrixTable(p||name,v));
   else if(v.length&&v.every(x=>typeof x==='string')&&/(?:^|\.)(?:notes|说明|口径说明)$/i.test(p))referenceSheets.push({name:p,reason:'接口返回的口径/参考说明，不参与数值字段匹配',rows:v.map(x=>[x])});
  }else if(v&&typeof v==='object')for(const [k,x]of Object.entries(v))walk(x,p?p+'.'+k:k,depth+1);
  else if(p)scalars.push({path:p,label:p.split('.').pop(),value:cell(v)});
 }walk(data,'',0);return {name,tables,scalars,referenceSheets,reportMonth};
}
export function validateDataSources(sources,month){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))fail('请选择目标月份');
 if(!Array.isArray(sources)||!sources.length||sources.length>20||Buffer.byteLength(JSON.stringify(sources))>15*1024*1024)fail('请导入1至20份数据，总大小不超过15MB');
 return sources.map((s,i)=>{
  if(typeof s.name!=='string'||s.name.length>200)fail('数据源名称不正确');
  if(s.reportMonth&&s.reportMonth!==month)fail('数据源月份与目标月份不一致：'+s.name);
  if(!Array.isArray(s.tables)||!Array.isArray(s.scalars)||s.tables.length>100||s.scalars.length>5000)fail('数据源最多100张表、5000个独立指标');
  const tables=s.tables.map((t,j)=>{if(typeof t.name!=='string'||!Array.isArray(t.columns)||!t.columns.length||t.columns.length>100||!t.columns.every(v=>typeof v==='string')||!Array.isArray(t.rows)||t.rows.length>10000||t.rows.some(r=>!Array.isArray(r)||r.length>100||r.some(v=>!['string','number','boolean'].includes(typeof v)&&v!==null)))fail('数据表格式或行列数量不正确');return {...t,id:`s${i}t${j}`,rows:t.rows.map(r=>t.columns.map((_,k)=>cell(r[k])))};});
  const scalars=s.scalars.map((v,j)=>{if(typeof v.path!=='string'||typeof v.label!=='string'||!['string','number','boolean'].includes(typeof v.value)&&v.value!==null)fail('指标字段格式不正确');return {...v,id:`s${i}v${j}`,value:cell(v.value)};});
  // A two-column metric/value sheet is also a source of explicitly labelled scalar values.
  for(const t of tables)if(t.columns.length===2&&/指标|项目|名称|metric|name/i.test(t.columns[0])&&/数值|值|数量|value/i.test(t.columns[1]))for(const r of t.rows)if(r[0])scalars.push({id:`${t.id}v${scalars.length}`,path:t.name+'.'+r[0],label:r[0],value:r[1]});
  const referenceSheets=s.referenceSheets||[];if(!Array.isArray(referenceSheets)||referenceSheets.length>100||referenceSheets.some(r=>typeof r.name!=='string'||typeof r.reason!=='string'||!Array.isArray(r.rows)||r.rows.length>10001||r.rows.some(row=>!Array.isArray(row)||row.length>100||row.some(v=>typeof v!=='string'))))fail('说明工作表格式不正确');
  return {id:'s'+i,name:s.name,origin:s.origin||'upload',reportMonth:s.reportMonth||month,windowEvidence:s.reportMonth?'source':'operator-declared',warnings:Array.isArray(s.warnings)?s.warnings.map(String).slice(0,50):[],tables,scalars,referenceSheets:structuredClone(referenceSheets)};
 });
}
function htmlRows(o){return [...o.content.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].map(m=>({html:m[0],cells:[...m[0].matchAll(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/gi)].map(c=>plain(c[0]))}));}
function header(o){const rows=htmlRows(o);const i=rows.findIndex(r=>r.cells.length>1&&r.cells.filter(Boolean).length>1);return i<0?null:{index:i,columns:rows[i].cells,capacity:rows.length-i-1};}
const periodHeading=value=>{const text=value.replace(/^[—–-]+\s*/, '').replace(/^I\s*A\s*[PA]\s*/i,'');return text.length<100&&(!/[，。；;：:]/.test(text)||/^(?:DATE|数据[:：])/i.test(text))&&(/月报|月度报告/.test(text)||/^(?:20\d{2}年)?\d{1,2}月$/.test(text)||/^(?:\d{1,2}\s*[—–~]\s*)?\d{1,2}\s*月[^，。；;：:]{0,32}(?:总览|榜|新游|关注|异动|大盘|供给变化|小游戏)/i.test(text)||/^(?:20\d{2}年)?\d{1,2}月[^，。；;：:]{0,20}(?:月报|月度报告)/.test(text)||/^(?:DATE|数据[:：])\s*/i.test(text)||/^MiniGames.*20\d{2}/i.test(text));};
export function dataTargets(project,rules={}){
 const detected=detectPptDataRegions(project),targets=[...detected.regions];
 const chartRules=new Map((rules.objects||[]).filter(r=>r.mode==='chart').map(r=>[r.id,r.chart]));
 project.deck.pages.forEach((p,pageIndex)=>p.objects.forEach(o=>{
  const a=o.attributes||{},kind=a['data-kind'],text=plain(o.content),id=a['data-object-id'];
  if(chartRules.has(id)){const chart=chartRules.get(id);targets.push({id,pageIndex,page:p.name,name:a['data-name']||id,kind:'chart',columns:[chart.category,...chart.series.map(s=>s.column)],series:chart.series.map(s=>s.name),label:chart.title||p.name,declared:true});return;}
  if(detected.excludedIds.has(id)||detected.occludedIds.has(id))return;
  if(a['data-pptx-chart']){let chart;try{chart=JSON.parse(a['data-pptx-chart']);}catch{return;}if(chart.series?.length)targets.push({id,pageIndex,page:p.name,name:a['data-name']||chart.title||id,kind:'chart',columns:[chart.categories?.[0]||'分类',...chart.series.map(s=>s.name)],series:chart.series.map(s=>s.name),label:chart.title||p.name});return;}
  if(kind==='table'||o.tagName==='table'){const h=header(o);if(h)targets.push({id,pageIndex,page:p.name,name:a['data-name']||id,kind:'table',...h,label:p.name});return;}
  if(kind==='image'||kind==='shape'||kind==='container'||text.length>100||parseFloat(o.style.height)>80&&!/^[^\d]{2,20}[ :：]*[-+\d.,%万亿元$\s]+$/.test(text)||/DATA\b|DATE\b|局限|口径|\/\s*\d{1,3}\s*$|月报|月度报告|\d\s*月.*(?:总览|榜|新游|关注|异动|大盘)|MiniGames.*20\d{2}/i.test(text))return;
  if(!text||!/\d|待填|\{\{/.test(text)||periodHeading(text)||/^TOP\s*\d+\s*.*(?:分布|概览|分析)$/i.test(text))return;
  if(text.length>30&&[...text.matchAll(/\d[\d.,]*/g)].length>1)return;
  let label=text.replace(/[\d.,+%$¥￥]+\s*[万亿元]*|20\d{2}年\d+月/g,'').trim();
  if(norm(label).length<2){const x=parseFloat(o.style.left)||0,y=parseFloat(o.style.top)||0;const near=p.objects.filter(n=>n!==o&&!detected.occludedIds.has(n.attributes['data-object-id'])&&plain(n.content).length>1&&plain(n.content).length<35&&!/\d/.test(plain(n.content))).map(n=>({n,d:Math.abs((parseFloat(n.style.top)||0)-y)*5+Math.abs((parseFloat(n.style.left)||0)-x)})).filter(v=>Math.abs((parseFloat(v.n.style.top)||0)-y)<18&&(parseFloat(v.n.style.left)||0)<x&&v.d<550).sort((a,b)=>a.d-b.d);if(near.length&&(!near[1]||near[1].d>near[0].d))label=plain(near[0].n.content);else if(/^\d{1,2}$/.test(text))return;}
  targets.push({id,pageIndex,page:p.name,name:a['data-name']||id,kind:'text',label,sample:text});
 }));return targets;
}
const fieldKey=s=>{if(String(s).trim()==='#')return '#';const n=norm(s);return ['游戏名','产品名'].includes(n)?'游戏':['排名','序号'].includes(n)?'#':n;};
const equivalent=(a,b)=>fieldKey(a)&&fieldKey(a)===fieldKey(b);
export function matchTemplateData(project,sources){
 sources=matchSourceViews(sources);const targets=dataTargets(project),tables=sources.flatMap(s=>s.tables.map(t=>({...t,source:s.name}))),values=sources.flatMap(s=>s.scalars.map(v=>({...v,source:s.name})));
 return targets.map(t=>{
  let candidates=[];
  if(t.kind==='text')candidates=values.filter(v=>equivalent(t.label,v.label)||equivalent(t.label,v.path)).map(v=>({sourceId:v.id,score:1,label:v.source+' / '+v.path,value:v.value}));
  else for(const table of tables){const wanted=t.kind==='chart'?t.series:t.columns;const map=wanted.map(c=>{const matches=table.columns.map((s,i)=>equivalent(c,table.columnLabels?.[i]||s)?i:-1).filter(i=>i>=0);return matches.length===1?matches[0]:-1;});const coverage=map.filter(c=>c>=0).length/Math.max(1,wanted.length);if(coverage>0)candidates.push({sourceId:table.id,score:coverage,label:table.source+' / '+table.name,columns:table.columns,rows:table.rows.length,columnMap:t.kind==='chart'?[table.columns.findIndex((_,i)=>!map.includes(i)),...map]:map,context:t.sourceHint?table.role===t.sourceHint:equivalent(t.page,table.name)||equivalent(t.label,table.name)});}
  candidates.sort((a,b)=>Number(b.context||false)-Number(a.context||false)||b.score-a.score);
  const top=candidates[0],unique=top&&(!candidates[1]||Number(top.context)>Number(candidates[1].context)||top.score>candidates[1].score);
  const strong=unique&&(top.score===1||t.representation==='positioned-text'&&top.context&&top.score>=.6);
  return {...t,candidates:candidates.slice(0,8),suggestion:strong?{id:t.id,kind:t.kind,sourceId:top.sourceId,...(top.columnMap?{columnMap:top.columnMap}:{}),...(t.rowOffset?{rowOffset:t.rowOffset}:{})}:null,status:strong?'suggested':candidates.length?'review':'unmatched',reason:strong?(t.representation==='positioned-text'?`按可见文字坐标识别${t.capacity}行${t.columns.length}列；${top.columnMap.filter(i=>i<0).length}列无对应来源，将留空。原对象位置和样式保留。`:'字段名称一致，仍需核对月份、单位与统计口径'):candidates.length?'字段不完整或存在多个候选，请选择来源及列映射':'未找到同名字段，可手动匹配或留空'};
 });
}
function replaceText(html,value){let done=false;return html.split(/(<[^>]*>)/g).map(s=>{if(s.startsWith('<')||!s.trim())return s;if(done)return '';done=true;return esc(value);}).join('')||'<p>'+esc(value)+'</p>';}
function pptValue(value,column,old,month){
 if(value==='')return '';
 if(['first_buying_date','first_entry_date'].includes(column)&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&/^\d{1,2}\.\d{1,2}$/.test(plain(old).replace(/\s/g,''))){const [year,m,d]=value.split('-');return (year!==month.slice(0,4)?year.slice(-2)+'.':'')+Number(m)+'.'+Number(d);}
 if(column.endsWith('_pct')&&/%/.test(plain(old))&&Number.isFinite(Number(value)))return (Number(value)>0?'+':'')+value+'%';
 if(['avg_plan','avg_material','avg_rank','rank_delta','douyin_bestseller_avg_rank'].includes(column)&&Number.isFinite(Number(value))){if(column==='rank_delta'&&Number(value)>0)return '+'+value;if(plain(old).includes(','))return Number(value).toLocaleString('en-US',{maximumFractionDigits:10});}
 return value;
}
function replaceMetric(html,value){const parts=html.split(/(<[^>]*>)/g),nodes=[];let text='';parts.forEach((p,i)=>{if(!p.startsWith('<')){nodes.push({i,start:text.length,end:text.length+p.length});text+=p;}});const match=[...text.matchAll(/[-+]?\d[\d.,]*\s*[%万亿元$]*/g)].at(-1);if(!match)return replaceText(html,value);const start=match.index,end=start+match[0].length;for(const n of nodes)if(n.end>start&&n.start<end){const l=Math.max(0,start-n.start),r=Math.min(n.end-n.start,end-n.start);parts[n.i]=parts[n.i].slice(0,l)+(start>=n.start?esc(value):'')+parts[n.i].slice(r);}return parts.join('');}
function replaceMetricSequence(html,values){
 const parts=html.split(/(<[^>]*>)/g),positions=[];
 for(let i=0;i<parts.length;i++)if(!parts[i].startsWith('<'))for(const m of parts[i].matchAll(/[-+]?\d[\d.,]*\s*[%万亿元$]*/g))positions.push({i,start:m.index,end:m.index+m[0].length});
 if(positions.length!==values.length)return replaceText(html,values.join(' '));
 for(let n=positions.length-1;n>=0;n--){const p=positions[n];parts[p.i]=parts[p.i].slice(0,p.start)+esc(values[n])+parts[p.i].slice(p.end);}
 return parts.join('');
}
function chartPlaceholder(role,showOnExport=false){return `<div class="chartbox" data-message="${esc('图表数据待补：缺少 '+role)}" data-print-hint="${showOnExport?'show':'hide'}" aria-label="${esc('图表数据待补：缺少 '+role)}"></div>`;}
// Mappings are saved with stable names (scalar path, table name, column names) next to the
// import-time ids, so that re-imported data with added/reordered fields still fills the same field.
export function annotateMappings(mappings,sources){
 if(!Array.isArray(mappings))return mappings;
 sources=matchSourceViews(sources);
 const tables=new Map(sources.flatMap(s=>s.tables.map(t=>[t.id,t]))),values=new Map(sources.flatMap(s=>s.scalars.map(v=>[v.id,v])));
 return mappings.map(m=>{const out={...m};
  if(m.kind==='text'){const v=values.get(m.sourceId);if(v)out.sourcePath=v.path;}
  else{const t=tables.get(m.sourceId);if(t){out.sourceTable=t.name;if(Array.isArray(m.columnMap))out.columnNames=m.columnMap.map(i=>Number.isInteger(i)&&i>=0&&i<t.columns.length?t.columns[i]:null);}}
  return out;});
}
export function resolveMappings(mappings,sources){
 if(!Array.isArray(mappings))return mappings;
 const scalars=sources.flatMap(s=>s.scalars),tables=sources.flatMap(s=>s.tables);
 return mappings.map(m=>{
  if(m.kind==='text'&&typeof m.sourcePath==='string'){const v=scalars.find(x=>x.path===m.sourcePath);if(!v)fail('字段不存在：'+m.sourcePath);return {...m,sourceId:v.id};}
  if(m.kind!=='text'&&typeof m.sourceTable==='string'){const found=tables.filter(t=>t.name===m.sourceTable);if(!found.length)fail('数据表不存在：'+m.sourceTable);const t=found.find(x=>x.id===m.sourceId)||found[0];
   let columnMap=m.columnMap;if(Array.isArray(m.columnNames)){columnMap=m.columnNames.map(n=>{if(n===null||n===undefined)return -1;const i=t.columns.indexOf(n);if(i<0)fail('数据表“'+m.sourceTable+'”缺少字段：'+n);return i;});}
   return {...m,sourceId:t.id,columnMap};}
  return m;});
}
// Stored names win over stale ids (data may have been re-imported); then refresh names from the resolved ids.
export function normalizeMappings(mappings,sources){return annotateMappings(resolveMappings(mappings,matchSourceViews(sources)),sources);}
export function fillTemplateData(project,sources,mappings,month,renderChart,rules={}){
 if(!Array.isArray(mappings)||mappings.length>5000)fail('匹配配置不正确');
 sources=matchSourceViews(sources);mappings=resolveMappings(mappings,sources);const result=structuredClone(project);delete result.silexState;const targets=new Map(dataTargets(project,rules).map(t=>[t.id,t])),byObject=new Map(result.deck.pages.flatMap(p=>p.objects).map(o=>[o.attributes['data-object-id'],o]));
 const tables=new Map(sources.flatMap(s=>s.tables.map(t=>[t.id,t]))),values=new Map(sources.flatMap(s=>s.scalars.map(v=>[v.id,v]))),seen=new Set(),issues=[];
 const objectModes=new Map((rules.objects||[]).map(r=>[r.id,r])),regionModes=new Map((rules.regions||[]).map(r=>[r.id,r.mode])),controlled=new Set();
 if(rules.visual){for(const [id,t]of targets)if(t.representation==='positioned-text'){const mode=regionModes.get(id)||'auto';for(const child of [...t.headerObjectIds,...t.cellObjectIds.flat(),t.titleObjectId,...t.manualObjectIds].filter(Boolean))controlled.add(child);if(mode!=='auto'){targets.delete(id);if(mode==='blank')for(const child of [...t.cellObjectIds.flat(),t.titleObjectId,...t.manualObjectIds].filter(Boolean)){const o=byObject.get(child);if(o)o.content=isImageSlot(o)?blankContent(o):replaceText(o.content,'');}}}
 for(const [id,o]of byObject)if(!controlled.has(id)){const rule=objectModes.get(id),mode=rule?.sentence||rule?.textTemplate?'auto':rule?.mode;if(mode==='static')targets.delete(id);if(mode==='blank'){targets.delete(id);o.content=blankContent(o); }}
 mappings=mappings.filter(m=>targets.has(m.id));}
 for(const [id,rule] of objectModes)if(rule.mode==='bar'){
  const o=byObject.get(id),track=byObject.get(rule.bar?.trackId);if(!o||!track)continue;
  const raw=[...values.values()].find(v=>v.id===rule.bar.sourceId||v.path===rule.bar.sourceRole)?.value;
  const n=raw==null||raw===''?null:Number(String(raw).replace(/[% ,]/g,''));
  if(n!==null&&!Number.isFinite(n))fail('进度条来源不是数值：'+rule.bar.sourceRole);
  const max=Number(rule.bar.max||100),min=Number(rule.bar.minWidth??4),trackWidth=parseFloat(track.style.width);
  if(!Number.isFinite(max)||max<=0||!Number.isFinite(min)||min<0||!Number.isFinite(trackWidth)||trackWidth<0)fail('进度条规则尺寸不正确');
  o.style.width=(n===null?0:Math.min(trackWidth,Math.max(min,Math.min(Math.abs(n),max)/max*trackWidth)))+'px';
  if(n!==null&&n<0&&rule.bar.negativeColor)o.style['background-color']=rule.bar.negativeColor;
  o.attributes['data-source-field']=rule.bar.sourceRole||rule.bar.sourceId;seen.add(id);targets.delete(id);
 }
 for(const [id,rule] of objectModes)if(typeof rule.textTemplate==='string'&&rule.textTemplate){
  const o=byObject.get(id);if(!o)continue;
  const fields=[...rule.textTemplate.matchAll(/\{([a-zA-Z][a-zA-Z0-9_.]*)\}/g)].map(m=>m[1]);
  if(!fields.length)fail('文本模板缺少字段占位符');
  const replacement=fields.map(field=>[...values.values()].find(v=>v.path===field||v.path==='adx_kpi.'+field)?.value??'');
  o.content=replaceMetricSequence(o.content,replacement);o.attributes['data-source-field']='text-template';seen.add(id);targets.delete(id);
 }
 for(const [id,rule] of objectModes)if(rule.mode==='chart'){
  const o=byObject.get(id),spec=rule.chart;if(!o||!spec)continue;
  const table=[...tables.values()].find(t=>t.id===spec.sourceId||t.role===spec.sourceRole||t.name===spec.sourceRole);
  if(!table){o.content=chartPlaceholder(spec.sourceRole||spec.sourceId,rule.chart.missingHintOnExport);issues.push({objectId:id,message:'图表来源缺失，已留空：'+(spec.sourceRole||spec.sourceId)});targets.delete(id);continue;}
  const index=column=>table.columns.indexOf(column),needed=[spec.category,...spec.series.map(s=>s.column),spec.sort?.by,...spec.series.map(s=>s.label?.deltaColumn)].filter(Boolean);
  if(needed.some(c=>index(c)<0))fail('图表来源缺少字段：'+needed.filter(c=>index(c)<0).join('、'));
  let rows=table.rows.map(r=>[...r]);if(spec.sort){const n=index(spec.sort.by),direction=spec.sort.order==='asc'?1:-1;rows.sort((a,b)=>direction*((Number(a[n])||0)-(Number(b[n])||0)));}
  if(spec.limit!==undefined){if(!Number.isInteger(spec.limit)||spec.limit<1||spec.limit>2000)fail('图表取前N须为1至2000');rows=rows.slice(0,spec.limit);}
  if(!rows.length||spec.series.every(s=>rows.every(r=>r[index(s.column)]===''))){o.content=chartPlaceholder(spec.sourceRole||spec.sourceId,rule.chart.missingHintOnExport);issues.push({objectId:id,message:'图表来源没有可绘制数据：'+(spec.sourceRole||spec.sourceId)});targets.delete(id);continue;}
  const chart={type:spec.type,title:spec.title||'',legend:spec.legend!==false,stackTotals:spec.stackTotals===true,...(Number.isInteger(spec.totalDecimals)?{totalDecimals:spec.totalDecimals}:{}),categories:rows.map(r=>r[index(spec.category)]),series:spec.series.map(s=>({name:s.name||s.column,color:s.color||'#002b5c',render:s.render,axis:s.axis,stack:s.stack,values:rows.map(r=>{const raw=r[index(s.column)];if(raw==='')return null;const n=Number(String(raw).replace(/,/g,''));if(!Number.isFinite(n))fail('图表来源包含非数值：'+s.column);return n;}),labels:s.label?.show?rows.map(r=>{if(r[index(s.column)]==='')return '';const n=Number(String(r[index(s.column)]).replace(/,/g,'')),delta=s.label.deltaColumn?Number(r[index(s.label.deltaColumn)]):0;return String(s.label.format||'{value}').replace('{value}',n.toLocaleString('zh-CN')).replace('{delta:+d}',delta>0?'+'+delta:String(delta));}):[]}))};
  o.attributes['data-monthly-chart']=JSON.stringify(chart);o.content=renderChart(chart,parseFloat(o.style.width)||600,parseFloat(o.style.height)||300);o.attributes['data-source-field']=table.id;seen.add(id);targets.delete(id);
 }
 mappings=mappings.filter(m=>objectModes.get(m.id)?.mode!=='chart');
 let filledCells=0;for(const m of mappings){const target=targets.get(m.id),o=byObject.get(m.id);if(!target||seen.has(m.id)||m.kind!==target.kind)fail('对象已变化或匹配重复，请重新导入数据');seen.add(m.id);
  if(target.kind==='text'){const v=values.get(m.sourceId);if(!v)fail('指标字段不存在');o.content=/^[-+\d.,%万亿元$\s]+$/.test(plain(o.content))?replaceText(o.content,v.value):replaceMetric(o.content,v.value);}
  else{const table=tables.get(m.sourceId),expected=target.kind==='chart'?target.series.length+1:target.columns.length;if(!table||!Array.isArray(m.columnMap)||m.columnMap.length!==expected||m.columnMap.some(i=>!Number.isInteger(i)||i< -1||i>=table.columns.length))fail('表格/图表列映射不正确');
   if(target.kind==='table'&&target.representation==='positioned-text'){
    const offset=m.rowOffset??target.rowOffset??0;if(!Number.isInteger(offset)||offset<0||offset>10000)fail('来源起始行不正确');
    target.cellObjectIds.forEach((row,r)=>row.forEach((id,c)=>{if(!id)return;const object=byObject.get(id),value=table.rows[offset+r]&&m.columnMap[c]>=0?table.rows[offset+r][m.columnMap[c]]:'';object.content=replaceText(object.content,pptValue(value,table.columns[m.columnMap[c]]||'',object.content,month));object.attributes['data-source-field']=m.sourceId+':'+(offset+r)+':'+m.columnMap[c];object.attributes['data-source-value']=value;if(value!=='')filledCells++;else if(m.columnMap[c]>=0)issues.push({objectId:id,message:'来源第'+(offset+r+1)+'行“'+target.columns[c]+'”为空，已留空'});}));
    if(target.titleObjectId){const title=byObject.get(target.titleObjectId),name=table.columns.indexOf('game_name');title.content=replaceText(title.content,name>=0?table.rows[offset]?.[name]||'':'');for(const id of target.manualObjectIds){const manual=byObject.get(id);if(manual)manual.content=isImageSlot(manual)?blankContent(manual):'';}}
    m.columnMap.forEach((column,i)=>{if(column<0)issues.push({objectId:m.id,message:'来源没有“'+target.columns[i]+'”字段，已留空，不推算替代'});});
    if(!target.titleObjectId&&table.rows.length-offset>target.capacity)issues.push({objectId:m.id,message:`数据共${table.rows.length-offset}行，文字表格可容纳${target.capacity}行，超出部分未填入，请增加行或续页。`});
   }
   else if(target.kind==='table'){let row=-1;o.content=o.content.replace(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi,tr=>{row++;if(row<=target.index)return tr;const data=table.rows[(m.rowOffset||0)+row-target.index-1];let column=-1;return tr.replace(/(<t[dh]\b[^>]*>)([\s\S]*?)(<\/t[dh]>)/gi,(_,open,body,close)=>{column++;return open+replaceText(body,data&&m.columnMap[column]>=0?data[m.columnMap[column]]:'')+close;});});if(table.rows.length>target.capacity)issues.push({objectId:m.id,message:`数据共${table.rows.length}行，模板可容纳${target.capacity}行，剩余数据未填入；请增加行或续页后重新匹配。`});}
   else{if(m.columnMap.some(i=>i<0))fail('图表分类及每组系列都需要选择来源列');const chart=JSON.parse(o.attributes['data-pptx-chart']);chart.categories=table.rows.map(r=>r[m.columnMap[0]]);chart.series.forEach((s,j)=>{s.values=table.rows.map(r=>{const raw=r[m.columnMap[j+1]];if(raw==='')return null;const v=Number(String(raw).replace(/,/g,''));if(!Number.isFinite(v))fail('图表来源包含非数值，请先提供上游已计算数值，不能自动换算单位或百分比');return v;});});delete chart.minimum;delete chart.maximum;o.attributes['data-pptx-chart']=JSON.stringify(chart);o.content=renderChart(chart,parseFloat(o.style.width)||600,parseFloat(o.style.height)||300);}
  }if(o)o.attributes['data-source-field']=m.sourceId;
 }
 // Sentences run after table/card mappings, because card regions clear their manual children while filling.
 for(const [id,rule] of objectModes)if(rule.sentence&&typeof rule.sentence==='object'){
  const o=byObject.get(id);if(!o)continue;
  const out=renderSentence(rule.sentence,{tables:[...tables.values()],scalars:[...values.values()],month});
  // Card regions may already have emptied this object; keep the template's original text style.
  const original=project.deck.pages.flatMap(p=>p.objects).find(x=>x.attributes?.['data-object-id']===id);
  o.content=replaceText(original?.content||o.content,out.text);o.attributes['data-source-field']='sentence';o.attributes['data-sentence-template']=rule.sentence.template;seen.add(id);targets.delete(id);
  for(const message of out.issues)issues.push({objectId:id,message:'数据句子：'+message});
 }
 // Retain labels/table grids, but do not carry historical numeric examples into unfilled data slots.
 for(const [id,t]of targets)if(!seen.has(id)){const o=byObject.get(id);if(t.representation==='positioned-text'){for(const child of [...t.cellObjectIds.flat(),t.titleObjectId,...t.manualObjectIds].filter(Boolean)){const item=byObject.get(child);if(item)item.content=isImageSlot(item)?blankContent(item):replaceText(item.content,'');}}else if(t.kind==='table'){let row=-1;o.content=o.content.replace(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi,tr=>++row<=t.index?tr:tr.replace(/(<t[dh]\b[^>]*>)([\s\S]*?)(<\/t[dh]>)/gi,(_,a,b,c)=>a+replaceText(b,'')+c));}else if(t.kind==='chart'){o.content='';delete o.attributes['data-pptx-chart'];}else o.content=/\D{2,}/.test(plain(o.content))?replaceMetric(o.content,''):replaceText(o.content,'');issues.push({objectId:id,message:'未匹配数据，已留空'});}
 const detected=detectPptDataRegions(project);for(const id of detected.occludedIds){const item=byObject.get(id);if(item&&!/data-image-slot/.test(item.content))item.content='';}
 for(const p of result.deck.pages){p.name=refreshPeriodText(p.name,month);for(const o of p.objects){const id=o.attributes['data-object-id'],rule=objectModes.get(id);if(rule?.binding==='report.period_text'||!targets.has(id)&&rule?.mode!=='static'&&periodHeading(plain(o.content)))o.content=refreshPeriodText(o.content,month);}}
 result.deck.notes={...result.deck.notes,report_month:month,template_data_issues:issues,ppt_data_regions:detected.regions.map(r=>({id:r.id,pageIndex:r.pageIndex,rows:r.capacity,columns:r.columns,representation:r.representation,headerObjectIds:r.headerObjectIds,cellObjectIds:r.cellObjectIds,titleObjectId:r.titleObjectId,bounds:r.bounds}))};return {project:result,issues,filled:seen.size,filledCells};
}
