import {validateSentence} from './data-sentence.mjs';
import {randomUUID} from 'node:crypto';
import {refreshPeriodText} from './template-recognition.mjs';
import {blankContent} from './image-slot.mjs';

export const builtinTemplates = [
  {id:'steam-standard',title:'标准月报',profile:'finished-eight',description:'8个基础页面，长表格自动续页。'},
  {id:'steam-data',title:'数据简版',profile:'data-supported',description:'封面、头部榜单、大盘、金银榜和铜榜，5个基础页面。'},
  {id:'steam-classic',title:'原PPT结构',profile:'full',description:'沿用原PPT的9页基础结构。'},
].map(value=>({...value,revision:1,builtin:true}));
export const profiles=['finished-eight','data-supported','full'];
const fail=message=>{throw Object.assign(Error(message),{status:400});};
export function inspectTemplate(project) {
  return project.deck.pages.map((page,pageIndex)=>({pageIndex,name:page.name,objects:page.objects.map(object=>{
    const a=object.attributes;const manual=['manual','research'].includes(a['data-content-layer']);
    return {id:a['data-object-id'],name:a['data-name']||a['data-object-id'],binding:a['data-binding-id']||'',mode:manual?'blank':'auto',layer:a['data-content-layer']||'manual'};
  })}));
}
export function validateRules(rules,project) {
  if(!profiles.includes(rules.profile))fail('未知页面结构');
  if(typeof rules.description!=='string'||rules.description.length>4000)fail('模板说明须在4000字以内');
  if(rules.structure!==undefined&&rules.structure!=='pptx')fail('未知模板页面结构');
  if(!Array.isArray(rules.objects))fail('缺少对象规则');
  const ids=new Set(project.deck.pages.flatMap(p=>p.objects).map(o=>o.attributes['data-object-id'])),seen=new Set();
  for(const row of rules.objects){
    if(!ids.has(row.id)||seen.has(row.id)||!['auto','static','blank','chart','bar'].includes(row.mode))fail('未知或重复的模板对象规则');
    if(row.binding!==undefined&&(typeof row.binding!=='string'||row.binding.length>180))fail('无效数据绑定');
    if(row.mode==='chart'&&(!row.chart||!['bar','hbar','line','combo'].includes(row.chart.type)||!Array.isArray(row.chart.series)||!row.chart.series.length||row.chart.series.length>20||typeof row.chart.category!=='string'||typeof (row.chart.sourceRole||row.chart.sourceId)!=='string'))fail('图表声明不完整');
    if(row.mode==='bar'&&(!row.bar||typeof (row.bar.sourceRole||row.bar.sourceId)!=='string'||!ids.has(row.bar.trackId)||!Number.isFinite(Number(row.bar.max??100))||Number(row.bar.max??100)<=0))fail('进度条声明不完整');
    if(row.textTemplate!==undefined&&(typeof row.textTemplate!=='string'||row.textTemplate.length>2000))fail('文本模板不正确');
    if(row.sentence!==undefined)validateSentence(row.sentence);
    seen.add(row.id);
  }
  return rules;
}
function blank(object){
  // Preserve an editable empty slot, never carry prior-month narrative or pictures.
  object.content=blankContent(object);
}
function textAppearance(layout,fresh){
  if(/<(?:table|svg|img|canvas)\b/i.test(layout+fresh))return fresh;
  const tags=new Map();
  for(const match of layout.matchAll(/<(p|span|div|strong|em|b|i)\b([^>]*)>/gi)){
    const list=tags.get(match[1].toLowerCase())||[];
    list.push((match[2].match(/\s(?:style|id|class)\s*=\s*(?:"[^"]*"|'[^']*')/gi)||[]).join(''));
    tags.set(match[1].toLowerCase(),list);
  }
  return fresh.replace(/<(p|span|div|strong|em|b|i)\b([^>]*)>/gi,(all,tag,attrs)=>{
    const style=tags.get(tag.toLowerCase())?.shift();
    if(style===undefined)return all;
    return '<'+tag+attrs.replace(/\s(?:style|id|class)\s*=\s*(?:"[^"]*"|'[^']*')/gi,'')+style+'>';
  });
}
export function applyTemplate(generated,snapshot,meta){
  if(!snapshot)return generated;
  const result=structuredClone(snapshot.project);delete result.silexState;result.current=0;
  const byId=new Map(),byBinding=new Map();
  for(const page of generated.deck.pages)for(const o of page.objects){byId.set(o.attributes['data-object-id'],o);if(o.attributes['data-binding-id'])byBinding.set(o.attributes['data-binding-id'],o);}
  const policies=new Map(snapshot.rules.objects.map(row=>[row.id,row]));
  const missing=[];
  for(const page of result.deck.pages)for(const object of page.objects){
    const a=object.attributes,id=a['data-object-id'];
    const policy=policies.get(id)||{mode:['manual','research'].includes(a['data-content-layer'])?'blank':'auto'};
    if(policy.mode==='blank'){blank(object);continue;}
    if(policy.mode==='static'){
      object.content=object.content.replaceAll('{{report.month}}',generated.deck.notes.report_month);
      a['data-content-layer']='template';a['data-refresh-policy']='template';delete a['data-binding-id'];continue;
    }
    if(policy.binding==='report.period_text'){
      object.content=refreshPeriodText(object.content,generated.deck.notes.report_month);
      a['data-binding-id']=policy.binding;a['data-content-layer']='fixed';a['data-refresh-policy']='replace';continue;
    }
    const source=policy.binding?byBinding.get(policy.binding):(byBinding.get(a['data-binding-id'])||byId.get(id));
    if(!source){blank(object);missing.push({code:'template_binding_missing',objectId:id,binding:policy.binding||a['data-binding-id']||id,message:'模板数据对象在本期生成结果中无匹配，已留空。'});continue;}
    const table=object.tagName==='table'&&source.content.match(/^\s*<table\b[^>]*>([\s\S]*)<\/table>\s*$/i);
    object.content=table?table[1]:a['data-kind']==='text'?textAppearance(object.content,source.content):source.content;
    object.attributes={...a,...source.attributes,id:a.id||id,'data-object-id':id,'data-name':a['data-name']||source.attributes['data-name']};
    if(a['data-pptx-chart']&&!source.attributes['data-pptx-chart']){delete object.attributes['data-pptx-chart'];delete object.attributes['data-pptx-kind'];}
  }
  // Newly selected games and overflow pages must not disappear behind an old example.
  const present=new Set(result.deck.pages.flatMap(p=>p.objects).map(o=>o.attributes['data-object-id']));
  for(const page of generated.deck.pages){
    const dynamic=page.objects.filter(o=>!present.has(o.attributes['data-object-id'])&&((snapshot.rules.structure!=='pptx'&&o.attributes['data-object-id'].startsWith('movement-card-'))||o.attributes['data-continuation-of']));
    if(!dynamic.length)continue;
    const target=result.deck.pages.find(p=>p.objects.some(o=>page.objects.some(s=>s.attributes['data-object-id']===o.attributes['data-object-id'])));
    if(page.objects.some(o=>o.attributes['data-continuation-of'])&&!page.objects.some(o=>present.has(o.attributes['data-object-id']))){
      const bindings=new Set(dynamic.map(o=>o.attributes['data-binding-id']?.split('.continuation.')[0]).filter(Boolean));
      const index=result.deck.pages.findLastIndex(p=>p.objects.some(o=>bindings.has(o.attributes['data-binding-id']?.split('.continuation.')[0])));
      if(snapshot.rules.structure==='pptx'&&index>=0)result.deck.pages.splice(index+1,0,structuredClone(page));else result.deck.pages.push(structuredClone(page));
    }
    else if(target)target.objects.push(...structuredClone(dynamic));
  }
  result.deck.css=result.deck.css||generated.deck.css;
  result.deck.pages.forEach((page,index)=>{for(const object of page.objects){if(/^\s*\d{2}\s*\/\s*\d+\s*$/.test(object.content.replace(/<[^>]*>/g,'')))object.content=object.content.replace(/\d{2}\s*\/\s*\d+/,`${String(index+1).padStart(2,'0')} / ${String(result.deck.pages.length).padStart(2,'0')}`);}});
  result.deck.notes={...generated.deck.notes,template:{id:meta.id,title:meta.title,revision:meta.revision,rules:snapshot.rules},issues:[...(generated.deck.notes.issues||[]),...missing]};
  return result;
}
export const newTemplateId=()=>randomUUID();
