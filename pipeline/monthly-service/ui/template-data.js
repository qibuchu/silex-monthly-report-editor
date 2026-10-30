'use strict';
let templateDataState,monthlyDataReader;
function loadMonthlyData(){if(window.MonthlyData)return Promise.resolve(window.MonthlyData);if(!monthlyDataReader)monthlyDataReader=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/ui/monthly-data-reader.js';script.onload=()=>resolve(window.MonthlyData);script.onerror=()=>{monthlyDataReader=null;reject(Error('无法加载Excel解析组件'));};document.head.append(script);});return monthlyDataReader;}
async function openTemplateSources(templateId){
 const data=await call('get_template_data_matches',{templateId});templateDataState=data;
 $('templateSourcesTitle').textContent=data.title+' · 模板 v'+data.templateRevision;
 $('templateDataMonth').value=data.month||$('month').value||'';$('templateDataFiles').value='';$('templateDataUrl').value=data.dataSource?.kind==='api'?data.dataSource.reference.replaceAll('{month}',$('templateDataMonth').value):data.sources.find(s=>s.origin?.startsWith('api:'))?.origin.slice(4)||'';$('templateDataHeaders').value='';$('templateDataWindow').checked=false;
 $('templateDataResult').hidden=true;fieldError('templateSourcesError','');renderTemplateData();openDialog('templateSourcesDialog');
}
function sourceTables(){return templateDataState.sources.flatMap(s=>s.tables.map(t=>({...t,source:s.name})));}
function sourceValues(){return templateDataState.sources.flatMap(s=>s.scalars.map(v=>({...v,source:s.name})));}
const fieldNorm=s=>String(s).toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
function renderColumnMapping(target,sourceId,selected){
 const source=sourceTables().find(t=>t.id===sourceId);if(!source||target.kind==='text')return '';
 const labels=target.kind==='chart'?['图表分类',...target.series]:target.columns;
 return '<div class="source-column-map">'+labels.map((label,i)=>{const col=selected?.[i]??source.columns.findIndex((v,j)=>fieldNorm(source.columnLabels?.[j]||v)===fieldNorm(label));return '<label>'+esc(label)+' ← 数据列<select data-data-column="'+i+'"><option value="-1">留空 / 不匹配</option>'+source.columns.map((v,j)=>'<option value="'+j+'" '+(j===col?'selected':'')+'>'+esc((source.columnLabels?.[j]||v)+(source.columnLabels?.[j]&&source.columnLabels[j]!==v?' ('+v+')':''))+'</option>').join('')+'</select></label>';}).join('')+'</div><p class="muted">来源 '+source.rows.length+' 行'+(target.kind==='table'?'，模板可容纳 '+target.capacity+' 行；超出会列出待续页提示':'')+'。示例：'+esc(source.rows.slice(0,2).map(r=>r.join(' / ')).join('；'))+'</p>';
}
function renderTemplateData(){
 const d=templateDataState;
 $('templateSourcesStatus').textContent=(d.dataSource?'已绑定 '+d.dataSource.name+' v'+d.dataSource.revision+'。':'')+(d.needsReview?'模板版式已变，请重新导入数据并匹配。':d.revision?'已导入 '+d.sources.length+' 份真实数据，下一步核对填充位置。':'请上传目标月数据文件，或读取已绑定的JSON接口。');
 $('templateDataSummary').innerHTML=d.sources.map(s=>'<div class="rule-note"><strong>'+esc(s.name)+'</strong><p>'+s.tables.map(t=>esc(t.name)+'：'+t.rows.length+'行 / '+t.columns.length+'列（表头第'+(t.headerRow||1)+'行）').join('；')+' · '+s.scalars.length+'个指标</p>'+(s.warnings||[]).map(w=>'<p class="muted">'+esc(w)+'</p>').join('')+(s.referenceSheets||[]).map(r=>'<details><summary>'+esc(r.name)+'（参考材料，不参与字段匹配）</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(r.rows.map(row=>row.join('　')).join('\n'))+'</pre></details>').join('')+'</div>').join('');
 $('templateDataMatchSection').hidden=!d.revision;
 $('templateDataMatchCount').textContent=d.targets.filter(t=>t.suggestion).length+' 个对象有字段匹配建议，'+d.targets.filter(t=>!t.suggestion).length+' 个待手动匹配或留空。';
 $('templateSourcesRows').innerHTML=d.targets.map((t,i)=>{
  const chosen=d.mappings.find(m=>m.id===t.id)||t.suggestion,options=t.kind==='text'?sourceValues():sourceTables();
  return '<details class="rule-page" data-data-target="'+i+'" '+(t.kind==='text'?'':'open')+'><summary>第'+(t.pageIndex+1)+'页 · '+esc(t.page)+' · '+esc(t.representation==='positioned-text'?t.name+' · '+t.capacity+'行 / '+t.columns.length+'列':t.kind==='table'?'表格':t.kind==='chart'?'图表':t.label||t.name)+'</summary><p>'+esc(t.reason)+'</p><p class="muted">对象：'+esc(t.id)+(t.sample?' · 原示例：'+esc(t.sample):'')+'</p><label><input type="checkbox" data-data-enabled '+(chosen?'checked':'')+'> 将选定数据填入此对象</label><label>匹配的数据字段 / 数据表<select data-data-source><option value="">不匹配，生成时留空</option>'+options.map(s=>'<option value="'+s.id+'" '+(chosen?.sourceId===s.id?'selected':'')+'>'+esc(s.source+' / '+(s.path||s.name))+(t.kind==='text'?' = '+esc(s.value):'')+'</option>').join('')+'</select></label><div data-data-columns>'+renderColumnMapping(t,chosen?.sourceId,chosen?.columnMap)+'</div>'+(t.representation==='positioned-text'?'<label>来源起始行（第一条数据为第1行）<input data-data-row-offset type="number" min="1" max="10001" value="'+((chosen?.rowOffset??t.rowOffset??0)+1)+'"></label><p class="muted">保留原文字对象、位置、字体与尺寸。新游卡片读取指定行，研究文字和图片留空。</p>':'')+'</details>';
 }).join('');
 $('templateDataPreview').disabled=!d.targets.length||d.needsReview;
}
$('templateSourcesRows').onchange=event=>{if(!event.target.matches('[data-data-source]'))return;const row=event.target.closest('[data-data-target]'),t=templateDataState.targets[Number(row.dataset.dataTarget)],id=event.target.value;row.querySelector('[data-data-enabled]').checked=!!id;row.querySelector('[data-data-columns]').innerHTML=renderColumnMapping(t,id);};
$('templateDataMonth').onchange=()=>{if(templateDataState?.dataSource?.kind==='api')$('templateDataUrl').value=templateDataState.dataSource.reference.replaceAll('{month}',$('templateDataMonth').value);};
$('templateSourcesForm').onsubmit=async event=>{
 event.preventDefault();const button=$('importTemplateData');button.disabled=true;fieldError('templateSourcesError','');
 try{const d=templateDataState,month=$('templateDataMonth').value;if(!$('templateDataWindow').checked)throw Error('请确认数据统计窗口与所选月份一致');
  const files=[...$('templateDataFiles').files],sources=[];const reader=files.length?await loadMonthlyData():null;
  for(const file of files)sources.push(await reader.read(file));
  const args={templateId:d.templateId,baseRevision:d.revision,templateRevision:d.templateRevision,projectRevision:d.projectRevision,month,confirmedWindow:true,sources};
  const url=$('templateDataUrl').value.trim();if(url){let headers={};try{headers=JSON.parse($('templateDataHeaders').value.trim()||'{}');}catch{throw Error('接口请求头须为JSON对象');}args.interface={url,headers};}
  templateDataState=await call('import_template_data',args);$('templateDataHeaders').value='';$('templateDataResult').hidden=true;renderTemplateData();message('数据已实际导入，已生成填充位置和字段匹配建议。请核对下方映射。');
 }catch(error){fieldError('templateSourcesError',error);}finally{button.disabled=false;}
};
$('templateDataPreview').onclick=async()=>{
 const button=$('templateDataPreview');button.disabled=true;fieldError('templateSourcesError','');
 try{const d=templateDataState,mappings=[];
  for(const row of $('templateSourcesRows').querySelectorAll('[data-data-target]')){if(!row.querySelector('[data-data-enabled]').checked)continue;const target=d.targets[Number(row.dataset.dataTarget)],sourceId=row.querySelector('[data-data-source]').value;if(!sourceId)throw Error('已勾选的对象需要选择来源字段');mappings.push({id:target.id,kind:target.kind,sourceId,...(target.kind!=='text'?{columnMap:[...row.querySelectorAll('[data-data-column]')].map(e=>Number(e.value)),...(row.querySelector('[data-data-row-offset]')?{rowOffset:Number(row.querySelector('[data-data-row-offset]').value)-1}:{})}:{})});}
  const result=await call('generate_template_data_preview',{templateId:d.templateId,baseRevision:d.revision,templateRevision:d.templateRevision,projectRevision:d.projectRevision,mappings});
  templateDataState=await call('get_template_data_matches',{templateId:d.templateId});
  $('templateDataResult').innerHTML='<h3>已将真实数据填入 '+result.filled+' 个区域/对象'+(result.filledCells?'，含 '+result.filledCells+' 个文字单元格':'')+'</h3><p>已生成独立可编辑草稿，模板原稿保持不变。核对效果后，可回到“规则与发布”发布含映射的模板。</p><div class="actions"><a class="button primary" target="_blank" rel="noopener" href="'+esc(result.preview)+'">预览填入结果</a><a class="button" target="_blank" rel="noopener" href="'+esc(result.editor)+'">编辑草稿</a><button class="button" type="button" data-template-rules="'+esc(d.templateId)+'">规则与发布</button></div><details><summary>未匹配 / 容量问题 '+result.issues.length+' 项</summary>'+result.issues.map(i=>'<p>'+esc(i.objectId)+'：'+esc(i.message)+'</p>').join('')+'</details>';
  $('templateDataResult').hidden=false;await refreshProjects();await loadTemplates();message('真实数据预览稿已生成。');
 }catch(error){fieldError('templateSourcesError',error);}finally{button.disabled=false;}
};
