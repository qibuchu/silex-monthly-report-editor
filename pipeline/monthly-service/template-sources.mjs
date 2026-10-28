// Source registration is metadata, not an executable connector or a business formula.
export function sourceNeeds(template){
 const d=template.recognition?.dataSource;
 return d&&d.status!=='existing-source'?d.sources:[{name:'SteamAuto',fields:'monthly-report schema 2.0，目标月榜单、大盘、新游数据'}];
}
export function describeSources(template,saved){
 const needs=sourceNeeds(template),changed=!!saved&&saved.projectRevision!==template.projectRevision;
 return {templateId:template.id,title:template.title,templateRevision:template.revision,projectRevision:template.projectRevision,revision:saved?.revision||0,
  needs,entries:saved?.entries||[],updatedAt:saved?.updatedAt||null,needsReview:changed,
  status:changed?'needs-review':saved?'registered':template.recognition?.dataSource?.status==='existing-source'||template.builtin?'existing-source':'unmatched',
  message:'登记来源和样例用于字段适配，不会执行接口/Skill，不等于已接通自动填充。模板规则和发布版本保持独立。'};
}
export function normalizeSources(entries,needs){
 const fail=m=>{throw Object.assign(Error(m),{status:400});};
 if(!Array.isArray(entries)||!entries.length||entries.length>20)fail('请至少登记一个数据源，最多20个');
 const seen=new Set(),allowed=new Set(needs.map(n=>n.name));
 const text=(v,max,required=false)=>{if(typeof v!=='string'||v.length>max||required&&!v.trim())fail('数据源名称、说明或字段格式不正确');return v.trim();};
 return entries.map(e=>{
  if(!e||typeof e!=='object')fail('数据源格式不正确');
  const requirement=text(e.requirement,200,true);if(!allowed.has(requirement)||seen.has(requirement))fail('数据需求已变化或重复，请重新读取匹配面板');seen.add(requirement);
  if(!['steamauto','json','skill','api'].includes(e.kind))fail('不支持的数据源类型');
  const result={requirement,name:text(e.name,200,true),kind:e.kind,reference:text(e.reference||'',2000),notes:text(e.notes||'',4000),status:'pending-adapter'};
  if(e.kind==='steamauto'&&requirement!=='SteamAuto')fail('新业务数据不能匹配为SteamAuto');
  if(e.sample!==undefined){
   if(e.kind!=='json'||!e.sample||typeof e.sample!=='object'||Buffer.byteLength(JSON.stringify(e.sample))>2*1024*1024)fail('JSON样例须为对象或数组，最大2MB');
   result.filename=text(e.filename||'sample.json',200,true);result.sample=structuredClone(e.sample);
   const fields=new Set();let count=0;const walk=(v,p,depth)=>{if(++count>10000||depth>8)return;if(Array.isArray(v)){if(v.length)walk(v[0],p+'[]',depth+1);}else if(v&&typeof v==='object'){for(const [k,x] of Object.entries(v)){const next=p?p+'.'+k:k;fields.add(next);walk(x,next,depth+1);}}};walk(e.sample,'',0);
   result.fields=[...fields].slice(0,300);result.reportMonth=typeof e.sample.report_month==='string'?e.sample.report_month:null;
  }else if(e.kind==='json')fail('请选择JSON数据样例');
  if(['skill','api'].includes(e.kind)&&!result.reference)fail('请填写接口地址或Skill说明');
  return result;
 });
}
