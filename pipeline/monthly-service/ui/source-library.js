'use strict';
let dataSources=[],editingSource=null;
const sourceLabel=id=>dataSources.find(s=>s.id===id)?.name||id||'未指定';
function sourceOptions(select,selected=''){
 select.innerHTML='<option value="">请选择已登记的数据源</option>'+dataSources.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name)+' · v'+s.revision+'</option>').join('');
 select.value=selected||'';
}
function renderDataSources(){
 $('sourceTotal').textContent=dataSources.length;
 $('dataSources').innerHTML=dataSources.map(s=>`<article class="template-card"><div class="card-body"><div class="template-version"><span class="published">● ${s.builtin?'内置':'自定义'} · v${s.revision}</span><span>${esc(s.kind==='api'?'JSON 接口':s.kind==='upload'?'上传文件':'本地 Skill')}</span></div><h3>${esc(s.name)}</h3><p class="template-description">${esc(s.description||s.reference||'未填写说明')}</p><p class="card-subtitle">${esc(s.reference||'按月上传文件')} · ${s.usedBy} 个模板使用${s.hasSample?' · 已保存字段样例':''}</p><div class="actions"><button class="button small" data-edit-source="${esc(s.id)}">编辑</button>${s.builtin?'':`<button class="button small" data-delete-source="${esc(s.id)}">删除</button>`}</div></div></article>`).join('')||empty('尚无数据源','新建数据源后即可绑定模板。');
 sourceOptions($('pptxDataSource'),$('pptxDataSource').value);
 sourceOptions($('projectDataSource'),$('projectDataSource').value);
}
async function refreshDataSources(){dataSources=await call('list_data_sources');state.dataSources=dataSources;renderDataSources();renderTemplates();}
window.refreshDataSources=refreshDataSources;
window.openTemplateSource=async id=>{
 const t=await call('get_template',{templateId:id});if(!t.projectId)throw Error('请先启用模板编辑');
 $('templateSourceTitle').textContent=t.title+' · 模板 v'+t.revision;
 sourceOptions($('templateSourceChoice'),t.dataSourceId);$('templateSourceForm').dataset.templateId=id;$('templateSourceForm').dataset.revision=t.revision;$('templateSourceForm').dataset.projectRevision=t.projectRevision;fieldError('templateSourceError','');openDialog('templateSourceDialog');
};
$('templateSourceForm').onsubmit=async event=>{
 event.preventDefault();const button=event.submitter;button.disabled=true;fieldError('templateSourceError','');
 try{const f=$('templateSourceForm');await call('bind_template_data_source',{templateId:f.dataset.templateId,dataSourceId:$('templateSourceChoice').value,baseRevision:Number(f.dataset.revision),projectRevision:Number(f.dataset.projectRevision)});f.closest('dialog').close();await Promise.all([loadTemplates(),refreshDataSources()]);message('模板数据源已绑定，请核对字段映射并发布新版本。');}
 catch(error){fieldError('templateSourceError',error);}finally{button.disabled=false;}
};
window.addEventListener('load',()=>{void refreshDataSources().catch(error=>message(error.message,true));});
$('addDataSource').onclick=()=>openSourceEditor();
document.addEventListener('click',event=>{if(event.target.closest('[data-go-sources]')){$('pptxTemplateDialog').close();location.hash='sources';}});
function openSourceEditor(id){
 editingSource=dataSources.find(s=>s.id===id)||null;
 $('dataSourceTitle').textContent=editingSource?'编辑数据源 · v'+editingSource.revision:'新建数据源';
 $('sourceName').value=editingSource?.name||'';$('sourceKind').value=editingSource?.kind||'api';$('sourceReference').value=editingSource?.reference||'';$('sourceDescription').value=editingSource?.description||'';$('sourceSample').value='';fieldError('sourceError','');openDialog('dataSourceDialog');
}
$('dataSources').onclick=async event=>{
 const edit=event.target.closest('[data-edit-source]'),remove=event.target.closest('[data-delete-source]');
 if(edit){openSourceEditor(edit.dataset.editSource);return;}
 if(remove){const source=dataSources.find(s=>s.id===remove.dataset.deleteSource);if(!source||!confirm(`删除数据源“${source.name}”？仅未被模板使用的数据源可删除。`))return;remove.disabled=true;try{await call('delete_data_source',{id:source.id,baseRevision:source.revision});await refreshDataSources();message('数据源已删除。');}catch(error){message(error.message,true);}finally{remove.disabled=false;}}
};
$('dataSourceForm').onsubmit=async event=>{
 event.preventDefault();const button=event.submitter;button.disabled=true;fieldError('sourceError','');
 try{
  const args={baseRevision:editingSource?.revision||0,name:$('sourceName').value.trim(),kind:$('sourceKind').value,reference:$('sourceReference').value.trim(),description:$('sourceDescription').value.trim()};
  if(editingSource)args.id=editingSource.id;
  const file=$('sourceSample').files[0];if(file){if(file.size>10*1024*1024)throw Error('样例文件最大10MB');if(/\.json$/i.test(file.name)){args.sample=JSON.parse(await file.text());}else{const reader=await loadMonthlyData(),parsed=await reader.read(file);args.sample={reportMonth:parsed.reportMonth||null,tables:(parsed.tables||[]).map(t=>({...t,rows:(t.rows||[]).slice(0,5)})),scalars:(parsed.scalars||[]).slice(0,100)};}}
  await call('save_data_source',args);$('dataSourceDialog').close();await refreshDataSources();message('数据源已保存。模板可选择此来源。');
 }catch(error){fieldError('sourceError',error);}finally{button.disabled=false;}
};
