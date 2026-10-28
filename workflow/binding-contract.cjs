const CONTRACT_VERSION='monthly-report-project/1.0';

const fixedBindings={
 s1o3:'report.period_label',s1o4:'report.title',s1o10:'report.version',
 s2o2:'head.title',s2o9:'head.top20',
 s4o2:'market.title',s4o8:'market.kpi.release_total',s4o9:'market.kpi.release_growth',s4o10:'market.kpi.review_total',s4o11:'market.kpi.positive_rate',
 s4o15:'market.chart.release_total',s4o16:'market.chart.daily_average',s4o24:'market.month_1.total',s4o25:'market.month_2.total',s4o26:'market.month_3.total',s4o43:'market.review_trend',
 'market-chart-key':'market.chart.legend',
 s5o2:'new_releases.tier_title',s5o8:'new_releases.gold',s5o9:'new_releases.silver',
 s6o5:'topics.hot.title',s6o6:'topics.hot.0.name',s6o7:'topics.hot.0.metrics',s6o10:'topics.hot.1.name',s6o22:'topics.hot.2.name',s6o26:'topics.hot.2.metrics',s6o27:'topics.hot.1.metrics',
 s7o4:'topics.indie.0.title',s7o14:'topics.indie.0.sales',s7o15:'topics.indie.0.revenue',s7o16:'topics.indie.0.reviews',s7o17:'topics.indie.0.window',s7o18:'topics.indie.0.chart',s7o19:'topics.indie.0.pcu',
 s8o6:'topics.indie.1.title',s8o14:'topics.indie.1.chart',s8o16:'topics.indie.1.pcu',s8o19:'topics.indie.1.sales',s8o20:'topics.indie.1.revenue',s8o21:'topics.indie.1.reviews',s8o22:'topics.indie.1.window',
 s9o2:'new_releases.bronze_title',s9o10:'new_releases.bronze'
};

const researchPages=new Set([5,6,7]);

function layerFor(object,pageIndex){
 const a=object.attributes||{},id=a['data-object-id']||'';
 if(fixedBindings[id])return {layer:'fixed',policy:'replace',binding:fixedBindings[id]};
 if(a['data-continuation-of']&&fixedBindings[a['data-continuation-of']])return {layer:'fixed',policy:'replace',binding:`${fixedBindings[a['data-continuation-of']]}.continuation.${a['data-page-part']}`};
 if(id.startsWith('movement-card-')){
  const role=a['data-card-role'];
  if(role==='icon'&&a['data-template-slot']==='manual-image')return {layer:'manual',policy:'preserve'};
  if(role==='name'||role==='icon')return {layer:'fixed',policy:'replace',binding:`head.highlights.${a['data-appid']||'unknown'}.${role}`};
  return {layer:'manual',policy:'preserve'};
 }
 const slot=a['data-template-slot']||'';
 if(slot==='data')return {layer:'fixed',policy:'replace',binding:`object.${id}`};
 if(slot.startsWith('manual-')){
  return researchPages.has(pageIndex)?{layer:'research',policy:'preserve',binding:`research.${id}`}:{layer:'manual',policy:'preserve'};
 }
 return {layer:'template',policy:'template'};
}

function applyBindingContract(deck){
 for(const [pageIndex,page] of deck.pages.entries())for(const object of page.objects){
  object.attributes=object.attributes||{};
  const meta=layerFor(object,pageIndex),a=object.attributes;
  a['data-content-layer']=meta.layer;
  a['data-refresh-policy']=meta.policy;
  if(meta.binding)a['data-binding-id']=meta.binding;else delete a['data-binding-id'];
 }
 deck.notes={...deck.notes,contract_version:CONTRACT_VERSION};
 return validateBindingContract({format:'steam-grapesjs-v2',deck});
}

function validateBindingContract(input){
 const project=input.project||input,deck=project.deck,issues=[],ids=new Set(),bindings=new Set();
 if(project.format!=='steam-grapesjs-v2')issues.push({code:'invalid_format',message:'format必须为steam-grapesjs-v2'});
 if(!Array.isArray(deck?.pages)||!deck.pages.length)return {contract_version:CONTRACT_VERSION,valid:false,issues:[...issues,{code:'missing_pages',message:'缺少页面'}]};
 let objectCount=0;
 for(const [pageIndex,page] of deck.pages.entries()){
  if(!page.name)issues.push({code:'missing_page_name',page:pageIndex+1});
  for(const object of page.objects||[]){
   objectCount++;const a=object.attributes||{},id=a['data-object-id'],layer=a['data-content-layer'],policy=a['data-refresh-policy'],binding=a['data-binding-id'];
   if(!id)issues.push({code:'missing_object_id',page:pageIndex+1});
   else if(ids.has(id))issues.push({code:'duplicate_object_id',page:pageIndex+1,id});else ids.add(id);
   if(!['fixed','research','manual','template'].includes(layer))issues.push({code:'invalid_content_layer',page:pageIndex+1,id,layer});
   if(!['replace','preserve','template'].includes(policy))issues.push({code:'invalid_refresh_policy',page:pageIndex+1,id,policy});
   if(layer==='fixed'&&!binding)issues.push({code:'missing_binding_id',page:pageIndex+1,id});
   if(policy==='replace'&&layer!=='fixed')issues.push({code:'unsafe_replace_policy',page:pageIndex+1,id,layer});
   if(binding){if(bindings.has(binding))issues.push({code:'duplicate_binding_id',page:pageIndex+1,id,binding});else bindings.add(binding);}
  }
 }
 const counts={fixed:0,research:0,manual:0,template:0};
 for(const page of deck.pages)for(const object of page.objects||[])if(counts[object.attributes?.['data-content-layer']]!==undefined)counts[object.attributes['data-content-layer']]++;
 return {contract_version:CONTRACT_VERSION,valid:issues.length===0,pageCount:deck.pages.length,objectCount,counts,issues};
}

module.exports={CONTRACT_VERSION,applyBindingContract,validateBindingContract};
