import {dataTargets,fillTemplateData} from './template-data.mjs';
import {applyStructure} from './project-operations.mjs';
import {analyzePptxTemplate,refreshPeriodText} from './template-recognition.mjs';
import {blankContent} from './image-slot.mjs';
const fail=m=>{throw Object.assign(Error(m),{status:400});};
const oid=o=>o.attributes['data-object-id'];
export function validateVisualRules(rules,project){
 const targets=dataTargets(project),ids=new Set(targets.map(t=>t.id)),objectIds=new Set(project.deck.pages.flatMap(p=>p.objects.map(oid))),pages=new Set(),regions=new Set(),classified=new Set();
 for(const p of rules.pages||[]){if(!Number.isInteger(p.pageIndex)||!project.deck.pages[p.pageIndex]||pages.has(p.pageIndex)||!['always','if-data','exclude'].includes(p.mode)||typeof p.purpose!=='string'||p.purpose.length>120)fail('页面规则无效或重复');pages.add(p.pageIndex);if(p.continuation&&(!ids.has(p.continuation)||targets.find(t=>t.id===p.continuation).kind!=='table'||targets.find(t=>t.id===p.continuation).capacity<2))fail('续页须选择本页的多行表格');if(p.continuation&&targets.find(t=>t.id===p.continuation).pageIndex!==p.pageIndex)fail('续页表格不在此页面');}
 for(const r of rules.regions||[]){if(!ids.has(r.id)||regions.has(r.id)||!['auto','static','blank'].includes(r.mode))fail('数据区域规则无效或重复');regions.add(r.id);}
 for(const c of rules.classifications||[]){if(!objectIds.has(c.id)||classified.has(c.id)||!['decorative','fixed','data','date','manual','review'].includes(c.type)||c.confirmed!==true)fail('对象分类无效或重复');classified.add(c.id);}
 if(rules.visual!==undefined&&rules.visual!==true)fail('可视化规则标记无效');
 return rules;
}
export function recognitionClass(row){return row.binding==='report.period_text'?'date':row.mode==='auto'?'data':row.mode==='static'&&['shape','image'].includes(row.kind)&&!row.sample?'decorative':row.mode==='static'?'fixed':'review';}
export function pendingVisualReviews(rules,project,aiSuggestions=[]){const decisions=new Map((rules.classifications||[]).map(c=>[c.id,c])),ai=new Map(aiSuggestions.map(s=>[s.id,s]));return analyzePptxTemplate(project).objects.filter(row=>{if(['decorative','fixed','data','date','manual'].includes(decisions.get(row.id)?.type))return false;const suggestion=ai.get(row.id);return suggestion? suggestion.confidence!=='high'||suggestion.type==='review':row.confidence==='review';});}
export function fillVisualTemplate(project,sources,mappings,month,renderChart,rules){
 if(!rules?.visual)return fillTemplateData(project,sources,mappings,month,renderChart);
 validateVisualRules(rules,project);
 let layout=structuredClone(project);delete layout.silexState;
 let expanded=structuredClone(mappings),policies={...structuredClone(rules),regions:structuredClone(rules.regions||[])};const continued=new Set();
 const classifications=new Map(analyzePptxTemplate(project).objects.filter(r=>r.confidence==='high'&&recognitionClass(r)==='date').map(r=>[r.id,'date']));for(const c of rules.classifications||[])classifications.set(c.id,c.type);
 policies.objects=(policies.objects||[]).map(o=>({...o,...(!['chart','bar'].includes(o.mode)&&classifications.has(o.id)?{mode:classifications.get(o.id)==='decorative'||classifications.get(o.id)==='fixed'||classifications.get(o.id)==='date'?'static':classifications.get(o.id)==='data'?'auto':'blank'}:{})}));
 const targets=dataTargets(layout),tables=new Map(sources.flatMap(s=>s.tables.map(t=>[t.id,t]))),pageOrigins=layout.deck.pages.map((_,i)=>i);
 // Only the explicitly selected table drives continuation; retain fixed row height.
 for(const p of [...(rules.pages||[])].sort((a,b)=>b.pageIndex-a.pageIndex)){
  if(!p.continuation||p.mode==='exclude')continue;
  const t=targets.find(t=>t.id===p.continuation),m=mappings.find(m=>m.id===t.id),table=m&&tables.get(m.sourceId);
  if(!m||!table||(rules.regions||[]).some(r=>r.id===t.id&&r.mode!=='auto'))continue;
  const count=Math.ceil(Math.max(0,table.rows.length-(m.rowOffset||0))/t.capacity);if(count>50)fail('单表续页超过50页，请缩小数据范围');
  if(count>1)continued.add(t.id);for(let n=count-1;n>=1;n--){const sourcePage=layout.deck.pages[p.pageIndex],copied=applyStructure(layout,[{op:'duplicate_page',pageIndex:p.pageIndex,index:p.pageIndex+1,name:sourcePage.name+' · 续'+n}]).project;const clone=copied.deck.pages[p.pageIndex+1],map=new Map(sourcePage.objects.map((o,i)=>[oid(o),oid(clone.objects[i])]));
   const remap=id=>id.startsWith('ppt-region:')?'ppt-region:'+map.get(id.slice(11)):map.get(id);
   continued.add(remap(t.id));for(const target of targets.filter(x=>x.pageIndex===p.pageIndex)){const original=mappings.find(x=>x.id===target.id);if(original)expanded.push({...original,id:remap(target.id),...(target.id===t.id?{rowOffset:(m.rowOffset||0)+n*t.capacity}:{})});const region=(rules.regions||[]).find(x=>x.id===target.id);if(region)policies.regions.push({...region,id:remap(region.id)});}
   for(const o of [...policies.objects].filter(o=>map.has(o.id)))policies.objects.push({...o,id:map.get(o.id)});
   for(const [oldId,newId]of map)if(classifications.has(oldId))classifications.set(newId,classifications.get(oldId));
   layout=copied;pageOrigins.splice(p.pageIndex+1,0,p.pageIndex);
  }
 }
 const result=fillTemplateData(layout,sources,expanded,month,renderChart,policies);
 const targetIds=new Set(dataTargets(layout,policies).map(t=>t.id));for(const page of result.project.deck.pages)for(const object of page.objects){const id=oid(object),type=classifications.get(id);if(type==='date')object.content=refreshPeriodText(object.content,month);if(type==='data'&&!targetIds.has(id)&&!object.attributes['data-source-field']){object.content=blankContent(object);result.issues.push({objectId:id,message:'已标记为外部数据，但无对应字段，已留空'});}}
 result.issues=result.issues.filter(i=>!(continued.has(i.objectId)&&/数据共.*(?:超出|剩余)/.test(i.message)));
 const excluded=new Set((rules.pages||[]).filter(p=>p.mode==='exclude'||p.mode==='if-data'&&!targets.filter(t=>t.pageIndex===p.pageIndex).some(t=>{const m=mappings.find(m=>m.id===t.id);return m&&((tables.get(m.sourceId)?.rows.length||0)>(m.rowOffset||0)||sources.some(s=>s.scalars.some(v=>v.id===m.sourceId&&v.value!=='')));})).map(p=>p.pageIndex));
 result.project.deck.pages=result.project.deck.pages.filter((_,i)=>!excluded.has(pageOrigins[i]));if(!result.project.deck.pages.length)fail('页面规则排除了全部页面，请至少保留一页');
 result.project.deck.notes={...result.project.deck.notes,visual_template_rules:rules};return result;
}
