import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createAssetStore } from './asset-store.mjs';
import {syncNativePatch, applyStructure} from './project-operations.mjs';
import {builtinTemplates,profiles,inspectTemplate,validateRules,applyTemplate,newTemplateId} from './templates.mjs';
import {analyzePptxTemplate,bindingLabels} from './template-recognition.mjs';
import {createTemplateAiTasks,templateAiPrompt,validateTemplateAiDecisions} from './template-ai.mjs';
import {sourceNeeds,describeSources,normalizeSources} from './template-sources.mjs';
import {jsonSource,validateDataSources,matchTemplateData,fillTemplateData,normalizeMappings} from './template-data.mjs';
import {renderImportedChart} from './template-chart-render.mjs';
import {fetchDataInterface} from './data-interface.mjs';
import {matchSourceViews} from './minigame-data-fields.mjs';
import {validateVisualRules,fillVisualTemplate,recognitionClass,pendingVisualReviews} from './visual-template-rules.mjs';
const require = createRequire(import.meta.url);

export class ServiceError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const idSchema = { type: 'string', minLength: 1 };
function tool(name, description, properties, required = [], readOnly = false) {
  return { name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false }, annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: false } };
}
export const tools = [
  tool('list_projects', '列出月报项目及当前版本', {}, [], true),
  tool('delete_project', '把月报草稿移入回收站（不物理删除，可恢复）；按版本检查，模板编辑稿、AI正在编辑的草稿和未保存的草稿会被拒绝', { projectId: idSchema, baseRevision: { type: 'integer', minimum: 1 } }, ['projectId', 'baseRevision']),
  tool('list_deleted_projects', '列出回收站中的月报草稿', {}, [], true),
  tool('restore_deleted_project', '把回收站中的月报草稿恢复到项目列表', { projectId: idSchema }, ['projectId']),
  tool('generate_monthly_report', '按所选已发布模板创建独立月报，记录模板版本；数据仍来自目标月数据包', { month: idSchema, templateId:idSchema,templateRevision:{type:'integer',minimum:1}, data: { type: 'object' }, full: { type: 'boolean' }, profile: { type:'string', enum:['data-supported','finished-eight','full'] }, selection: { type:'object', properties:{ movement_appid:{type:'integer'}, indie_appids:{type:'array',maxItems:2,items:{type:'integer'}} }, additionalProperties:false } }, ['month']),
  tool('get_task', '读取生成任务状态和结果', { taskId: idSchema }, ['taskId'], true),
  tool('get_project', '读取项目；默认只返回页面和对象摘要，指定 pageIndex 或 objectIds 获取内容', { projectId: idSchema, pageIndex: { type: 'integer', minimum: 0 }, objectIds: { type: 'array', items: idSchema } }, ['projectId'], true),
  tool('propose_object_patch', '按对象 ID 提交修改方案，暂不修改项目。处理标记需求时传 requestId；content 为对象内部 HTML，style 为 CSS 属性', { projectId: idSchema, baseRevision: { type: 'integer', minimum: 1 }, requestId: idSchema, requirement: { type: 'string' }, changes: { type: 'array', minItems: 1, items: { type: 'object', properties: { id: idSchema, content: { type: 'string' }, style: { type: 'object', additionalProperties: { type: ['string', 'number'] } }, name: { type: 'string' } }, required: ['id'], additionalProperties: false } } }, ['projectId', 'baseRevision', 'changes']),
  tool('apply_proposal', '应用指定方案；版本变化时返回冲突，必须重新读取和合并', { proposalId: idSchema }, ['proposalId']),
  tool('get_preview_link', '获取服务器预览、网页编辑及修改方案链接', { projectId: idSchema }, ['projectId'], true),
  tool('list_versions', '列出项目历史版本', { projectId: idSchema }, ['projectId'], true),
  tool('export_project', '生成独立演示 HTML 和可编辑 JSON 的下载链接', { projectId: idSchema }, ['projectId'], true),
  tool('list_ai_requests', '列出用户标记需求；默认仅待处理与待确认，status=all 包含历史', { projectId: idSchema, status: { type: 'string', enum: ['all', 'pending', 'proposed', 'applied', 'cancelled'] } }, [], true),
  tool('get_ai_request', '读取需求、标记对象 ID 与项目版本，再用 get_project 读取对象', { requestId: idSchema }, ['requestId'], true),
  tool('reject_proposal', '放弃尚未应用的方案，保留历史记录；关联需求重新等待处理', { proposalId: idSchema }, ['proposalId']),
  tool('cancel_ai_request', '取消未完成的标记需求，关联待确认方案一并关闭，保留历史', { requestId: idSchema }, ['requestId']),
  tool('rename_project', '重命名月报项目，按版本检查并保留编辑内容', { projectId: idSchema, baseRevision: { type: 'integer', minimum: 1 }, title: { type: 'string', minLength: 1, maxLength: 120 } }, ['projectId', 'baseRevision', 'title']),
  tool('get_editing_target', '读取这台电脑明确选择的AI编辑草稿；选择标识不是访问凭据', {editingTargetId:idSchema}, ['editingTargetId'], true),
  tool('clear_editing_target', '取消本电脑AI草稿选择；不删除月报，后续AI必须重新选择目标', {editingTargetId:idSchema,baseRevision:{type:'integer',minimum:0}}, ['editingTargetId','baseRevision']),
  tool('set_editing_target', '用户明确选择草稿后设置本电脑AI目标，保留选择版本检查；不修改月报', {editingTargetId:idSchema,projectId:idSchema,baseRevision:{type:'integer',minimum:0}}, ['editingTargetId','projectId','baseRevision']),
  tool('get_editing_context', '聊天修改前读取明确选择的草稿或网页当前项目、页面、选中对象和未保存状态；每次修改前重读，多个项目无法判定时不能猜测', { projectId: idSchema,editingTargetId:idSchema }, [], true),
  tool('apply_object_patch', '用户在聊天中要求修改时，按对象ID直接保存并同步网页，无需另建提案；必须使用刚读取的版本。未保存的人工编辑会阻止写入', { projectId: idSchema, baseRevision: { type: 'integer', minimum: 1 }, requirement: { type: 'string', minLength: 1 }, changes: toolsPatchSchema() }, ['projectId', 'baseRevision', 'requirement', 'changes']),
  tool('restore_project_version', '按当前版本检查恢复历史内容，形成新版本。撤销前确认历史版本及后续人工修改，不能强制覆盖', { projectId: idSchema, baseRevision: { type: 'integer', minimum: 1 }, targetRevision: { type: 'integer', minimum: 1 } }, ['projectId', 'baseRevision', 'targetRevision']),
  tool('apply_structure_patch', '按版本直接增删、复制或移动页面与顶层对象；页码及位置从0开始，复制会生成新ID。网页未保存时拒绝执行', {projectId:idSchema,baseRevision:{type:'integer',minimum:1},requirement:{type:'string',minLength:1},operations:{type:'array',minItems:1,maxItems:100,items:{oneOf:[
    {type:'object',properties:{op:{const:'add_object'},pageIndex:{type:'integer',minimum:0},index:{type:'integer',minimum:0},object:{type:'object',properties:{content:{type:'string'},style:{type:'object',additionalProperties:{type:['string','number']}},attributes:{type:'object',additionalProperties:{type:'string'}},classes:{type:'array',items:{type:'string'}},tagName:{type:'string',enum:['div','table','section','p']}},required:['content','style'],additionalProperties:false}},required:['op','pageIndex','object'],additionalProperties:false},
    ...['remove_object','move_object','duplicate_object'].map(op=>({type:'object',properties:{op:{const:op},id:idSchema,...(op==='remove_object'?{}:{pageIndex:{type:'integer',minimum:0},index:{type:'integer',minimum:0},...(op==='duplicate_object'?{style:{type:'object',additionalProperties:{type:['string','number']}}}:{})})},required:op==='move_object'?['op','id','pageIndex']:['op','id'],additionalProperties:false})),
    ...['add_page','remove_page','move_page','duplicate_page'].map(op=>({type:'object',properties:{op:{const:op},...(op==='add_page'?{width:{type:'integer',minimum:1,maximum:8192},height:{type:'integer',minimum:1,maximum:8192},background:{type:'string'}}:{pageIndex:{type:'integer',minimum:0}}),...(op==='remove_page'?{}:{index:{type:'integer',minimum:0}}),...(['add_page','duplicate_page'].includes(op)?{name:{type:'string',minLength:1}}:{})},required:op==='add_page'?['op']:op==='move_page'?['op','pageIndex','index']:['op','pageIndex'],additionalProperties:false}))
  ]}}},['projectId','baseRevision','requirement','operations']),
];
tools.push(
  tool('import_template_data','实际导入临时Excel解析结果/CSV/JSON或GET JSON接口的数据，并按字段及模板对象生成匹配建议。接口请求头只用于本次请求，不保存',{templateId:idSchema,baseRevision:{type:'integer',minimum:0},templateRevision:{type:'integer',minimum:0},projectRevision:{type:'integer',minimum:1},month:idSchema,confirmedWindow:{type:'boolean'},sources:{type:'array',maxItems:20,items:{type:'object'}},interface:{type:'object',properties:{url:idSchema,name:{type:'string'},headers:{type:'object',additionalProperties:{type:'string'}}},required:['url'],additionalProperties:false}},['templateId','baseRevision','templateRevision','projectRevision','month','confirmedWindow']),
  tool('get_template_data_matches','读取已导入的真实数据、模板目标对象、字段匹配建议及已确认映射',{templateId:idSchema},['templateId'],true),
  tool('generate_template_data_preview','确认选择的字段和列映射后生成独立可编辑预览稿，不覆盖模板；保存映射用于发布和后续生成',{templateId:idSchema,baseRevision:{type:'integer',minimum:1},templateRevision:{type:'integer',minimum:0},projectRevision:{type:'integer',minimum:1},mappings:{type:'array',minItems:1,maxItems:5000,items:{type:'object',properties:{id:idSchema,kind:{type:'string',enum:['text','table','chart']},sourceId:idSchema,columnMap:{type:'array',items:{type:'integer',minimum:-1}},rowOffset:{type:'integer',minimum:0,maximum:10000},sourcePath:{type:'string'},sourceTable:{type:'string'},columnNames:{type:'array',items:{type:['string','null']}}},required:['id','kind','sourceId'],additionalProperties:false}}},['templateId','baseRevision','templateRevision','projectRevision','mappings']),
  tool('list_templates','列出内置模板和可编辑自定义模板；只有已发布版本可以生成草稿',{},[],true),
  tool('get_template','查看模板数据绑定、产出规则、编辑稿链接和已发布版本',{templateId:idSchema},['templateId'],true),
  tool('delete_template','从模板库移除自定义模板，按模板与编辑稿版本检查；已有月报及相关编辑数据保留',{templateId:idSchema,baseRevision:{type:'integer',minimum:0},projectRevision:{type:'integer',minimum:1}},['templateId','baseRevision','projectRevision']),
  tool('get_visual_rule_canvas','读取模板单页及可点击对象、数据区域和待发布规则草稿',{templateId:idSchema,pageIndex:{type:'integer',minimum:0}},['templateId'],true),
  tool('get_template_ai_task','读取PPT上传后待分析的对象批次；本地AI可直接读取并返回结构化分类',{templateId:idSchema,mode:{type:'string',enum:['local','server']}},[],true),
  tool('submit_template_ai_task','保存PPT对象的AI识别建议，逐项校验对象ID；结果仍需在可视化画布核对',{taskId:idSchema,projectRevision:{type:'integer',minimum:1},decisions:{type:'array',items:{type:'object'}}},['taskId','projectRevision','decisions']),
  tool('fail_template_ai_task','记录PPT AI分析失败以便在画布中显示并重试',{taskId:idSchema,error:{type:'string',maxLength:400}},['taskId','error']),
  tool('retry_template_ai_task','重试失败的PPT AI识别批次，可切换服务器或本地AI',{templateId:idSchema,mode:{type:'string',enum:['local','server']}},['templateId','mode']),
  tool('save_visual_rule_draft','按版本保存画布上配置的页面、对象、表格与字段规则，不发布模板',{templateId:idSchema,baseRevision:{type:'integer',minimum:0},projectRevision:{type:'integer',minimum:1},templateRevision:{type:'integer',minimum:0},dataRevision:{type:'integer',minimum:0},rules:{type:'object'},mappings:{type:'array'}},['templateId','baseRevision','projectRevision','templateRevision','dataRevision','rules','mappings']),
  tool('preview_visual_rule_draft','从规则草稿及已导入的本月数据生成独立可编辑预览',{templateId:idSchema,draftRevision:{type:'integer',minimum:1}},['templateId','draftRevision']),
  tool('publish_visual_rule_draft','发布已保存且核对通过的画布规则及数据映射，按模板/编辑稿/数据版本检查',{templateId:idSchema,draftRevision:{type:'integer',minimum:1},recognitionReviewed:{type:'boolean'}},['templateId','draftRevision']),
  tool('set_visual_rule_selection','网页同步当前可视化模板、页面及选中对象；同时报告未保存状态',{editingTargetId:idSchema,templateId:idSchema,pageIndex:{type:'integer',minimum:0},selectionType:{type:'string',enum:['page','object','region']},selectionId:idSchema,dirty:{type:'boolean'},sessionId:idSchema,sequence:{type:'integer',minimum:1}},['editingTargetId','templateId','pageIndex','selectionType','selectionId','dirty','sessionId','sequence']),
  tool('get_template_ai_target','读取本机全局AI连接当前选中的模板；切换模板无需重新配置MCP',{editingTargetId:idSchema},[],true),
  tool('get_visual_rule_context','本地AI读取网页当前选中的模板页面或区域、规则版本和数据映射；每次修改前调用',{editingTargetId:idSchema,templateId:idSchema},[],true),
  tool('apply_visual_rule_patch','本地AI按选中模板及草稿版本修改页面、对象或数据区域规则；不发布模板',{editingTargetId:idSchema,templateId:idSchema,baseRevision:{type:'integer',minimum:0},projectRevision:{type:'integer',minimum:1},templateRevision:{type:'integer',minimum:0},dataRevision:{type:'integer',minimum:0},requirement:{type:'string',minLength:1},changes:{type:'array',minItems:1,maxItems:100,items:{type:'object'}}},['editingTargetId','templateId','baseRevision','projectRevision','templateRevision','dataRevision','requirement','changes']),
  tool('apply_visual_template_patch','本地AI按选中模板修改画布文字或样式，保留对象版本检查；规则与版式分别保存',{editingTargetId:idSchema,templateId:idSchema,baseRevision:{type:'integer',minimum:1},requirement:{type:'string',minLength:1},changes:toolsPatchSchema()},['editingTargetId','templateId','baseRevision','requirement','changes']),
  tool('get_template_data_sources','重新匹配已有模板的数据需求，读取已登记来源和JSON样例；不会执行接口',{templateId:idSchema},['templateId'],true),
  tool('configure_template_data_sources','按版本登记模板数据来源及JSON样例，供后续字段适配；不修改PPT或发布规则',{templateId:idSchema,baseRevision:{type:'integer',minimum:0},templateRevision:{type:'integer',minimum:0},projectRevision:{type:'integer',minimum:1},entries:{type:'array',minItems:1,maxItems:20,items:{type:'object',properties:{requirement:idSchema,name:idSchema,kind:{type:'string',enum:['steamauto','json','skill','api']},reference:{type:'string'},notes:{type:'string'},filename:{type:'string'},sample:{type:['object','array']}},required:['requirement','name','kind'],additionalProperties:false}}},['templateId','baseRevision','templateRevision','projectRevision','entries']),
  tool('create_template','从已保存月报创建独立模板编辑稿，不修改来源项目',{projectId:idSchema,baseRevision:{type:'integer',minimum:1},title:{type:'string',minLength:1,maxLength:120},profile:{type:'string',enum:profiles}},['projectId','baseRevision','title']),
  tool('publish_template','发布模板编辑稿与产出规则为不可变版本，未保存或版本冲突时拒绝',{templateId:idSchema,baseRevision:{type:'integer',minimum:0},projectRevision:{type:'integer',minimum:1},rules:{type:'object',properties:{profile:{type:'string',enum:profiles},description:{type:'string',maxLength:4000},objects:{type:'array',items:{type:'object',properties:{id:idSchema,mode:{type:'string',enum:['auto','static','blank','chart','bar']},binding:{type:'string'},chart:{type:'object'},bar:{type:'object'},textTemplate:{type:'string'},sentence:{type:'object'}},required:['id','mode'],additionalProperties:false}}},required:['profile','description','objects'],additionalProperties:false}},['templateId','baseRevision','projectRevision','rules'])
);
function toolsPatchSchema() {
  return { type: 'array', minItems: 1, items: { type:'object', properties: { id:idSchema, content:{type:'string'}, style:{type:'object',additionalProperties:{type:['string','number']}}, name:{type:'string'} }, required:['id'], additionalProperties:false } };
}
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function render(project) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Steam 月报</title><style>${project.deck.css}\nbody{margin:0;background:#e5e7eb}.report-page{position:relative;width:var(--page-width,1920px);height:var(--page-height,1080px);overflow:hidden;margin:24px auto;zoom:min(1,calc((100vw - 48px) / var(--page-width,1920px)))}.report-page>.object{position:absolute;box-sizing:border-box}.chartbox{width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#eef1f4;border:2px dashed #9aa8b7;box-sizing:border-box;color:#536579;font:18px "Microsoft YaHei",sans-serif}.chartbox::after{content:attr(data-message)}${project.deck.pages.map((page,index)=>`@page report-${index}{size:${Number(page.width)||1920}px ${Number(page.height)||1080}px;margin:0}`).join('')}@media print{body{background:white}.report-page{zoom:1;margin:0;break-after:page}.chartbox[data-print-hint="hide"]{background:transparent;border:0}.chartbox[data-print-hint="hide"]::after{content:none}}</style>${project.deck.pages.map((page,index) => `<section class="slide report-page" style="page:report-${index};--page-width:${Number(page.width)||1920}px;--page-height:${Number(page.height)||1080}px;background:${escape(page.background || '#fff')}">${page.objects.map(o => `<${o.tagName === 'table' ? 'table' : 'div'} ${Object.entries(o.attributes).map(([k,v]) => `${k}="${escape(v)}"`).join(' ')} class="${escape((o.classes || ['object']).join(' '))}" style="${escape(Object.entries(o.style).map(([k,v]) => `${k}:${v}`).join(';'))}">${o.content}</${o.tagName === 'table' ? 'table' : 'div'}>`).join('')}</section>`).join('')}</html>`;
}
function validate(project) {
  if (project?.format !== 'steam-grapesjs-v2' || !Array.isArray(project.deck?.pages) || !project.deck.pages.length || typeof project.deck.css !== 'string') throw new ServiceError('Invalid project');
  const ids = new Set();
  for (const page of project.deck.pages) {
    if (!Array.isArray(page.objects)) throw new ServiceError('Invalid page');
    for (const object of page.objects) {
      const id = object.attributes?.['data-object-id'];
      if (!id || ids.has(id) || !object.style || typeof object.content !== 'string') throw new ServiceError('Invalid/duplicate object ID');
      ids.add(id);
    }
  }
}
export function createCore(config) {
  const assets = createAssetStore(config);
  const dir = path.resolve(config.dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, 'store.json');
  const db = fs.existsSync(dbPath) ? JSON.parse(fs.readFileSync(dbPath)) : { projects: {}, tasks: {}, proposals: {} };
  db.requests ||= {};
  db.templates ||= {};
  db.deletedTemplates ||= {};
  db.deletedProjects ||= {};
  db.templateSources ||= {};
  db.templateData ||= {};
  db.visualRuleDrafts ||= {};
  db.visualRuleSelections ||= {};
  db.templateAi ||= {};
  db.editingTargets ||= {};
  const persist = () => { fs.writeFileSync(dbPath + '.tmp', JSON.stringify(db)); fs.renameSync(dbPath + '.tmp', dbPath); };
  for (const task of Object.values(db.tasks)) if (task.status === 'running') { task.status = 'failed'; task.error = 'Service restarted; task interrupted'; }
  persist();
  const project = id => { if (!Object.hasOwn(db.projects, id)) throw new ServiceError('Project not found', 404); return db.projects[id]; };
  // Browser presence is transient. Never restore stale tab selections after restart.
  const sessions = new Map();
  const liveSessions = () => {
    for (const [id, value] of sessions) if (Date.now() - value.seenAt > 20000) sessions.delete(id);
    return [...sessions.values()];
  };
  const assertEditorsSaved = id => {
    if (liveSessions().some(s => s.projectId === id && (s.dirty || s.saving))) throw new ServiceError('网页存在未保存或正在保存的人工修改，请等待保存完成后重新读取。', 409);
  };
  const links = id => ({ preview: `${config.publicUrl}/preview/${id}`, editor: `${config.publicUrl}/editor?project=${id}`, proposals: `${config.publicUrl}/api/projects/${id}/proposals` });
  const aiFor=id=>db.templateAi[id]||null;
  const aiSummary=id=>{const ai=aiFor(id);if(!ai)return {status:'not-started',revision:0,total:0,done:0,failed:0};const done=ai.tasks.filter(t=>t.status==='done').length,failed=ai.tasks.filter(t=>t.status==='failed').length;return {status:done===ai.tasks.length?'completed':failed?'needs-attention':'analyzing',revision:ai.revision,mode:ai.mode,total:ai.tasks.length,done,failed,error:ai.tasks.find(t=>t.status==='failed')?.error||''};};
  const aiSuggestions=id=>aiFor(id)?.tasks.flatMap(t=>t.decisions||[])||[];
  const persistTemplateData=(id,value)=>{const folder=path.join(dir,'history','template-data-'+id);fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,value.revision+'.json'),JSON.stringify(value));db.templateData[id]=value;persist();};
  const sourceDraft=(template,value,sources,mappings,month,rules)=>{
    const filled=rules?.visual?fillVisualTemplate(value,sources,mappings,month,renderImportedChart,rules):fillTemplateData(value,sources,mappings,month,renderImportedChart),id=randomUUID();validate(filled.project);
    const earlier=Object.values(db.projects).filter(p=>p.month===month&&p.template?.id===template.id&&p.template?.revision===template.revision&&p.kind!=='template-draft').sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
    if(earlier){const imgSrc=html=>{const src=(String(html||'').match(/<img\b[^>]*\bsrc="([^"]*)"/i)||[])[1]||'';const asset=src.match(/\/assets\/([^/?#"]+)/);return asset?'asset:'+asset[1]:src;};const original=new Map(value.deck.pages.flatMap(p=>p.objects).map(o=>[o.attributes?.['data-object-id'],imgSrc(o.content)]));const saved=new Map(earlier.project.deck.pages.flatMap(p=>p.objects).filter(o=>o.attributes?.['data-refresh-policy']==='preserve'&&/<img\b/i.test(o.content)&&!o.attributes?.['data-source-field']&&imgSrc(o.content)&&imgSrc(o.content)!==original.get(o.attributes?.['data-object-id'])).map(o=>[o.attributes['data-object-id'],o]));for(const page of filled.project.deck.pages)for(const object of page.objects){const prior=saved.get(object.attributes?.['data-object-id']);if(prior&&/<div\b[^>]*data-image-slot=|<p><\/p>/i.test(object.content)){object.content=prior.content;object.attributes={...object.attributes,'data-kind':'image','data-refresh-policy':'preserve'};}}}
    db.projects[id]={id,revision:1,month,title:`${template.title} · ${month} 数据草稿`,template:{id:template.id,title:template.title,revision:template.revision},project:filled.project,updatedAt:new Date().toISOString(),author:'generator'};return {projectId:id,...links(id),filled:filled.filled,filledCells:filled.filledCells,issues:filled.issues};
  };
  function save(id, baseRevision, value, author = 'operator', lastChange) {
    const current = project(id);
    validate(value);
    if (current.revision !== baseRevision) {
      const conflictId = randomUUID();
      const conflictDir = path.join(dir, 'conflicts'); fs.mkdirSync(conflictDir, { recursive: true });
      fs.writeFileSync(path.join(conflictDir, conflictId + '.json'), JSON.stringify({ projectId: id, baseRevision, project: value }));
      throw new ServiceError(`Version conflict: latest=${current.revision}; saved=${conflictId}`, 409);
    }
    const history = path.join(dir, 'history', id); fs.mkdirSync(history, { recursive: true });
    fs.writeFileSync(path.join(history, `${current.revision}.json`), JSON.stringify(current));
    db.projects[id] = { ...current, revision: current.revision + 1, project: value, author, lastChange, updatedAt: new Date().toISOString() };
    persist(); return db.projects[id];
  }
  function patch(current, changes) {
    if (!Array.isArray(changes) || !changes.length) throw new ServiceError('Changes required');
    const value = structuredClone(current.project);
    const objects = new Map(value.deck.pages.flatMap(p => p.objects).map(o => [o.attributes['data-object-id'], o]));
    const seen = new Set();
    for (const change of changes) {
      const object = objects.get(change.id);
      if (!object || seen.has(change.id)) throw new ServiceError('Unknown/duplicate object ID');
      seen.add(change.id);
      if (Object.keys(change).some(k => !['id', 'content', 'style', 'name'].includes(k))) throw new ServiceError('Only content/style/name changes allowed');
      if (change.content !== undefined) {
        if (typeof change.content !== 'string' || /<script\b|\bon\w+\s*=|javascript:/i.test(change.content)) throw new ServiceError('Invalid HTML content');
        object.content = change.content;
      }
      if (change.style !== undefined) {
        if (!change.style || Array.isArray(change.style) || typeof change.style !== 'object') throw new ServiceError('Invalid style');
        for (const [key, val] of Object.entries(change.style)) {
          if (!/^[a-z][a-z-]*$/.test(key) || !['string', 'number'].includes(typeof val)) throw new ServiceError('Invalid CSS property');
          object.style[key] = val;
        }
        if (['left', 'top', 'width', 'height'].some(key => Object.hasOwn(change.style, key))) {
          const [x, y, w, h] = ['left', 'top', 'width', 'height'].map(key => Number.parseFloat(object.style[key]));
          const page = value.deck.pages.find(p => p.objects.includes(object));
          if (![x,y,w,h].every(Number.isFinite) || x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > (Number(page.width)||1920) || y + h > (Number(page.height)||1080)) throw new ServiceError('Object geometry outside slide bounds');
        }
      }
      if (change.name !== undefined) { if (typeof change.name !== 'string') throw new ServiceError('Invalid name'); object.attributes['data-name'] = change.name; }
    }
    syncNativePatch(value,changes);
    validate(value); return value;
  }
  function generate(args) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(args.month || '')) throw new ServiceError('Invalid month');
    if (args.data && args.data.report_month !== args.month) throw new ServiceError('Input month mismatch');
    const requested=args.templateId||(builtinTemplates.find(t=>t.profile===(args.profile||(args.full?'full':config.defaultProfile||'finished-eight')))?.id);
    const template=builtinTemplates.find(t=>t.id===requested)||db.templates[requested];
    if(!template||!template.revision)throw new ServiceError('请选择已发布模板');
    const templateRevision=args.templateRevision||template.revision;
    if(!Number.isInteger(templateRevision)||templateRevision<1||templateRevision>template.revision)throw new ServiceError('模板版本不存在');
    const snapshot=template.builtin?undefined:JSON.parse(fs.readFileSync(path.join(dir,'history','template-'+template.id,templateRevision+'.json'),'utf8'));
    if(snapshot?.externalDataRevision){
      if(args.data)throw new ServiceError('此模板使用已确认的外部数据映射，请从“导入数据并匹配”更新本期数据，不能混入Steam数据包');
      const data=JSON.parse(fs.readFileSync(path.join(dir,'history','template-data-'+template.id,snapshot.externalDataRevision+'.json'),'utf8'));
      if(data.month!==args.month)throw new ServiceError('已导入数据月份为'+data.month+'，请先导入目标月数据并确认映射后发布');
      const result=sourceDraft({...template,revision:templateRevision},snapshot.project,data.sources,data.mappings,args.month,snapshot.rules),id=randomUUID();db.tasks[id]={id,status:'succeeded',month:args.month,template:{id:template.id,title:template.title,revision:templateRevision},projectId:result.projectId,links:links(result.projectId),startedAt:new Date().toISOString(),finishedAt:new Date().toISOString()};persist();return db.tasks[id];
    }
    const templateMeta={id:template.id,title:template.title,revision:templateRevision};
    const selectedProfile=snapshot?.rules.structure==='pptx'?'full':snapshot?.rules.profile||template.profile;
    if(args.templateId&&args.profile&&args.profile!==selectedProfile)throw new ServiceError('页面结构与模板不一致，请在模板规则中设置');
    const id = randomUUID(); const taskDir = path.join(dir, 'tasks', id); fs.mkdirSync(taskDir, { recursive: true });
    const argv = [path.join(config.toolkitDir, 'run.cjs'), '--month', args.month, '--out', path.join(taskDir, 'output')];
    if (args.data) { fs.writeFileSync(path.join(taskDir, 'input.json'), JSON.stringify(args.data)); argv.push('--data', path.join(taskDir, 'input.json')); }
    else if (config.generationConfig) argv.push('--config', config.generationConfig);
    else throw new ServiceError('Provide data from your local skill, or configure server generationConfig');
    const profile = selectedProfile;
    if (!['data-supported','finished-eight','full'].includes(profile)) throw new ServiceError('Unknown page profile');
    argv.push('--profile',profile);
    if (args.selection) {
      if (typeof args.selection !== 'object' || Array.isArray(args.selection) || Object.keys(args.selection).some(k=>!['movement_appid','indie_appids'].includes(k))) throw new ServiceError('Invalid research selection');
      const file = path.join(taskDir,'selection.json'); fs.writeFileSync(file,JSON.stringify(args.selection)); argv.push('--selection',file);
    }
    db.tasks[id] = { id, status: 'running', month: args.month, template:templateMeta,startedAt: new Date().toISOString() }; persist();
    const process = spawn(globalThis.process.execPath, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    let errorLog = ''; process.stderr.on('data', c => { errorLog = (errorLog + c).slice(-2000); }); process.stdout.resume();
    process.on('error', error => { db.tasks[id].status = 'failed'; db.tasks[id].error = error.message; persist(); });
    process.on('close', code => {
      try {
        if (code === 3) {
          Object.assign(db.tasks[id], { status: 'awaiting_credentials', error: errorLog, message: '凭据失效：已暂停。请用户续期并明确确认后，重新获取数据启动任务。禁止自动重试或生成空榜。', stoppedAt: new Date().toISOString() });
          persist(); return;
        }
        if (code !== 0) throw Error(errorLog || `Generator exited ${code}`);
        const generatedEnvelope=JSON.parse(fs.readFileSync(path.join(taskDir, 'output/draft.json')));
        let projectValue = generatedEnvelope.project;
        projectValue=applyTemplate(projectValue,snapshot,templateMeta);
        fs.writeFileSync(path.join(taskDir,'output','template-issues.json'),JSON.stringify((projectValue.deck.notes.issues||[]).filter(i=>i.code==='template_binding_missing'),null,2));
        fs.writeFileSync(path.join(taskDir,'output','模板绑定缺失.md'),'# 模板绑定缺失\n\n'+(projectValue.deck.notes.issues||[]).filter(i=>i.code==='template_binding_missing').map(i=>`- ${i.objectId}：${i.binding} 无匹配，已留空。`).join('\n'));
        projectValue.deck.notes={...projectValue.deck.notes,template:{...templateMeta,rules:snapshot?.rules||{profile,description:template.description}}};
        validate(projectValue);
        generatedEnvelope.project=projectValue;
        fs.writeFileSync(path.join(taskDir,'output','draft.json'),JSON.stringify(generatedEnvelope));
        fs.writeFileSync(path.join(taskDir,'output','draft.html'),render(projectValue));
        const projectId = randomUUID();
        db.projects[projectId] = { id: projectId, revision: 1, month: args.month, title: `Steam ${args.month} 月报 · ${template.title}`,template:templateMeta, project: projectValue, updatedAt: new Date().toISOString(), author: 'generator' };
        Object.assign(db.tasks[id], { status: 'succeeded', projectId, links: links(projectId), finishedAt: new Date().toISOString() });
      } catch (error) { Object.assign(db.tasks[id], { status: 'failed', error: error.message }); }
      persist();
    });
    return db.tasks[id];
  }
  async function call(name, args = {}) {
    switch (name) {
      case 'get_template_ai_task': {
        const entries=args.templateId?[[args.templateId,aiFor(args.templateId)]]:Object.entries(db.templateAi);
        for(const [templateId,ai]of entries){if(!ai||!db.templates[templateId])continue;const task=ai.tasks.find(t=>t.status==='pending'&&(!args.mode||t.mode===args.mode));if(!task)continue;
          const template=db.templates[templateId],current=template&&project(template.projectId);
          if(!template||current.revision!==ai.projectRevision)return {status:'stale',templateId,message:'模板版式已变化，请重新导入或刷新AI识别任务'};
          return {status:'pending',taskId:task.id,templateId,projectRevision:ai.projectRevision,mode:task.mode,prompt:templateAiPrompt(task),task:{id:task.id,pageIndex:task.pageIndex,pageName:task.pageName,pageRole:task.pageRole,objects:task.objects},summary:aiSummary(templateId)};
        }
        return {status:'empty'};
      }
      case 'submit_template_ai_task': {
        const ai=Object.values(db.templateAi).find(a=>a.tasks.some(t=>t.id===args.taskId)),task=ai?.tasks.find(t=>t.id===args.taskId);
        if(!task)throw new ServiceError('AI识别任务不存在',404);
        const t=db.templates[task.templateId];if(!t||project(t.projectId).revision!==args.projectRevision||ai.projectRevision!==args.projectRevision)throw new ServiceError('模板版式已变化，请重新分析',409);
        if(task.status==='done')throw new ServiceError('该批次已完成，请读取最新结果',409);
        const decisions=validateTemplateAiDecisions(task,{decisions:args.decisions});
        task.decisions=decisions;task.status='done';task.error='';task.finishedAt=new Date().toISOString();ai.revision++;persist();return {templateId:task.templateId,taskId:task.id,summary:aiSummary(task.templateId)};
      }
      case 'fail_template_ai_task': {
        const ai=Object.values(db.templateAi).find(a=>a.tasks.some(t=>t.id===args.taskId)),task=ai?.tasks.find(t=>t.id===args.taskId);if(!task)throw new ServiceError('AI识别任务不存在',404);
        if(task.status==='done')throw new ServiceError('该批次已完成',409);
        task.status='failed';task.error=String(args.error||'AI识别失败').slice(0,400);ai.revision++;persist();return {templateId:task.templateId,summary:aiSummary(task.templateId)};
      }
      case 'retry_template_ai_task': {
        const ai=aiFor(args.templateId);if(!ai)throw new ServiceError('模板AI识别任务不存在',404);
        if(args.mode==='server')throw new ServiceError('服务器模型尚未启用；请使用本地AI');
        for(const task of ai.tasks)if(task.status==='failed'){task.status='pending';task.error='';task.mode=args.mode;}
        ai.mode=args.mode;ai.revision++;persist();return {templateId:args.templateId,summary:aiSummary(args.templateId)};
      }
      case 'set_visual_rule_selection': {
        if(!/^[a-zA-Z0-9_-]{16,100}$/.test(args.editingTargetId||''))throw new ServiceError('AI连接标识格式不正确');
        const t=db.templates[args.templateId];if(!t||t.origin!=='pptx')throw new ServiceError('请选择PPT导入模板',404);
        const p=project(t.projectId).project.deck.pages[args.pageIndex];if(!p)throw new ServiceError('页面不存在',404);
        if(args.selectionType==='page'&&String(args.selectionId)!==String(args.pageIndex)||args.selectionType==='object'&&!p.objects.some(o=>o.attributes['data-object-id']===args.selectionId)||args.selectionType==='region'&&!matchTemplateData(project(t.projectId).project,db.templateData[t.id]?.sources||[]).some(v=>v.pageIndex===args.pageIndex&&v.id===args.selectionId))throw new ServiceError('选中的页面或对象不存在',409);
        const prior=db.visualRuleSelections[args.editingTargetId];if(prior?.sessionId===args.sessionId&&args.sequence<prior.sequence)return prior;
        const next={editingTargetId:args.editingTargetId,templateId:t.id,pageIndex:args.pageIndex,selectionType:args.selectionType,selectionId:args.selectionId,dirty:args.dirty===true,sessionId:args.sessionId,sequence:args.sequence,updatedAt:new Date().toISOString()};db.visualRuleSelections[args.editingTargetId]=next;persist();return next;
      }
      case 'get_template_ai_target': {
        if(!/^[a-zA-Z0-9_-]{16,100}$/.test(args.editingTargetId||''))throw new ServiceError('请提供有效的AI连接标识');
        const selected=db.visualRuleSelections[args.editingTargetId],template=selected&&db.templates[selected.templateId];
        return template?{status:'selected',...selected,title:template.title,projectId:template.projectId,templateRevision:template.revision}:{status:'no_selection',editingTargetId:args.editingTargetId};
      }
      case 'get_visual_rule_context': {
        const selected=args.editingTargetId?db.visualRuleSelections[args.editingTargetId]:null;
        if(args.editingTargetId&&!selected)return {status:'no_selection',message:'请先在可视化模板画布中选中页面或对象'};
        const templateId=args.templateId||selected?.templateId;if(!templateId)throw new ServiceError('请指定模板或在网页中选择模板',400);
        if(selected&&selected.templateId!==templateId)throw new ServiceError('网页当前模板与指定模板不同',409);
        const pageIndex=selected?.pageIndex||0,canvas=await call('get_visual_rule_canvas',{templateId,pageIndex}),item=selected?.selectionType==='region'?canvas.targets.find(v=>v.id===selected.selectionId):selected?.selectionType==='object'?canvas.objects.find(v=>v.id===selected.selectionId):canvas.pages[pageIndex];
        return {status:'ok',editingTargetId:args.editingTargetId||null,templateId,title:canvas.title,projectId:canvas.projectId,pageIndex,selectionType:selected?.selectionType||'page',selectionId:selected?.selectionId||String(pageIndex),selected:item||null,recognition:canvas.recognition.find(v=>v.id===selected?.selectionId)||null,classification:canvas.rules.classifications?.find(v=>v.id===selected?.selectionId)||null,pendingReviewCount:canvas.pendingReviewCount,dirty:!!selected?.dirty,projectRevision:canvas.projectRevision,templateRevision:canvas.templateRevision,dataRevision:canvas.dataRevision,draftRevision:canvas.draftRevision,dataMonth:canvas.dataMonth,dataNeedsReview:canvas.dataNeedsReview,rule:selected?.selectionType==='region'?canvas.rules.regions?.find(v=>v.id===selected.selectionId):selected?.selectionType==='object'?canvas.rules.objects?.find(v=>v.id===selected.selectionId):canvas.rules.pages?.find(v=>v.pageIndex===pageIndex),mapping:canvas.mappings.find(v=>v.id===selected?.selectionId)||null,sources:canvas.sources,canvas:`${config.publicUrl}/visual-rules?template=${templateId}`,editor:links(canvas.projectId).editor};
      }
      case 'apply_visual_rule_patch': {
        const selected=db.visualRuleSelections[args.editingTargetId];if(!selected||selected.templateId!==args.templateId)throw new ServiceError('网页AI目标已切换，请重新读取可视化规则上下文',409);
        if(selected.dirty)throw new ServiceError('网页有未保存的规则，请先保存后再由AI修改',409);
        const canvas=await call('get_visual_rule_canvas',{templateId:args.templateId,pageIndex:selected.pageIndex});
        if(canvas.draftRevision!==args.baseRevision||canvas.projectRevision!==args.projectRevision||canvas.templateRevision!==args.templateRevision||canvas.dataRevision!==args.dataRevision)throw new ServiceError('模板或规则已变化，请重新读取',409);
        const rules=structuredClone(canvas.rules),mappings=structuredClone(canvas.mappings);rules.pages||=[];rules.regions||=[];rules.objects||=[];rules.classifications||=[];
        const valid=new Set(canvas.allTargets.map(t=>t.id)),objects=new Set(project(canvas.projectId).project.deck.pages.flatMap(p=>p.objects.map(o=>o.attributes['data-object-id']))),sourceTables=new Map(canvas.sources.flatMap(s=>s.tables.map(t=>[t.id,t]))),sourceValues=new Set(canvas.sources.flatMap(s=>s.scalars.map(v=>v.id)));
        for(const c of args.changes){if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>!['scope','pageIndex','id','mode','purpose','continuation','binding','sourceId','columnMap','rowOffset','type','chart','bar','textTemplate','sentence'].includes(k)))throw new ServiceError('规则修改字段不受支持');
          if(c.scope==='page'){if(!Number.isInteger(c.pageIndex)||!canvas.pages[c.pageIndex])throw new ServiceError('页面不存在');let r=rules.pages.find(v=>v.pageIndex===c.pageIndex);if(!r){r={pageIndex:c.pageIndex,purpose:canvas.pages[c.pageIndex].name,mode:'always',continuation:''};rules.pages.push(r);}if(c.mode!==undefined)r.mode=c.mode;if(c.purpose!==undefined)r.purpose=c.purpose;if(c.continuation!==undefined)r.continuation=c.continuation;}
          else if(c.scope==='object'){if(!objects.has(c.id))throw new ServiceError('对象不存在',409);let r=rules.objects.find(v=>v.id===c.id);if(!r){r={id:c.id,mode:'blank'};rules.objects.push(r);}if(c.mode!==undefined)r.mode=c.mode;if(c.binding!==undefined)r.binding=c.binding;if(c.chart!==undefined)r.chart=c.chart;if(c.bar!==undefined)r.bar=c.bar;if(c.textTemplate!==undefined)r.textTemplate=c.textTemplate;if(c.sentence!==undefined)r.sentence=c.sentence;if(c.type!==undefined){if(!['decorative','fixed','data','date','manual'].includes(c.type))throw new ServiceError('对象分类不正确');rules.classifications=rules.classifications.filter(v=>v.id!==c.id);rules.classifications.push({id:c.id,type:c.type,confirmed:true});r.mode=['decorative','fixed','date'].includes(c.type)?'static':c.type==='data'?'auto':'blank';if(c.type==='date')r.binding='report.period_text';}}
          else if(c.scope==='region'){if(!valid.has(c.id))throw new ServiceError('数据区域不存在',409);let r=rules.regions.find(v=>v.id===c.id);if(!r){r={id:c.id,mode:'auto'};rules.regions.push(r);}if(c.mode!==undefined)r.mode=c.mode;if(c.sourceId!==undefined){const target=canvas.allTargets.find(v=>v.id===c.id),source=sourceTables.get(c.sourceId);if(c.sourceId&&!source&&!sourceValues.has(c.sourceId))throw new ServiceError('来源字段不存在');if(c.sourceId&&target.kind!=='text'&&!source||c.sourceId&&target.kind==='text'&&source)throw new ServiceError('来源类型与数据区域不匹配');const old=mappings.find(v=>v.id===c.id);mappings.splice(0,mappings.length,...mappings.filter(v=>v.id!==c.id));if(c.sourceId)mappings.push({id:c.id,kind:target.kind,sourceId:c.sourceId,...(target.kind==='text'?{}:{columnMap:c.columnMap||old?.columnMap||target.suggestion?.columnMap||target.columns.map(()=>-1)}),...(c.rowOffset!==undefined?{rowOffset:c.rowOffset}:old?.rowOffset!==undefined?{rowOffset:old.rowOffset}:{})});}else{const m=mappings.find(v=>v.id===c.id);if((c.columnMap!==undefined||c.rowOffset!==undefined)&&!m)throw new ServiceError('请先选择数据来源');if(c.columnMap!==undefined)m.columnMap=c.columnMap;if(c.rowOffset!==undefined)m.rowOffset=c.rowOffset;}}
          else throw new ServiceError('规则修改范围不受支持');
        }
        const saved=await call('save_visual_rule_draft',{templateId:args.templateId,baseRevision:args.baseRevision,projectRevision:args.projectRevision,templateRevision:args.templateRevision,dataRevision:args.dataRevision,rules,mappings});return {...saved,previousRevision:args.baseRevision,requirement:args.requirement};
      }
      case 'apply_visual_template_patch': {
        const selected=db.visualRuleSelections[args.editingTargetId];if(!selected||selected.templateId!==args.templateId)throw new ServiceError('网页AI目标已切换，请重新读取可视化规则上下文',409);
        if(selected.dirty)throw new ServiceError('网页有未保存的规则，请先保存后再由AI修改',409);
        const t=db.templates[args.templateId];if(!t||t.origin!=='pptx')throw new ServiceError('模板不存在',404);
        return call('apply_object_patch',{projectId:t.projectId,baseRevision:args.baseRevision,requirement:args.requirement,changes:args.changes});
      }
      case 'get_visual_rule_canvas': {
        const t=db.templates[args.templateId];if(!t||t.origin!=='pptx')throw new ServiceError('请选择PPT导入的可编辑模板',404);
        const current=project(t.projectId),pages=current.project.deck.pages,pageIndex=args.pageIndex??0;if(!pages[pageIndex])throw new ServiceError('页面不存在',404);
        const data=db.templateData[t.id],draft=db.visualRuleDrafts[t.id],targets=data?matchTemplateData(current.project,data.sources):[],recognized=analyzePptxTemplate(current.project);
        const ai=aiFor(t.id),suggestions=ai?.projectRevision===current.revision?aiSuggestions(t.id):[],suggested=new Map(suggestions.map(s=>[s.id,s]));
        for(const row of recognized.objects){const s=suggested.get(row.id);if(!s)continue;row.mode=s.type==='data'?'auto':['decorative','fixed','date'].includes(s.type)?'static':'blank';row.confidence=s.confidence==='high'&&s.type!=='review'?'high':'review';row.reason=`AI建议：${s.reason}`;row.binding=s.type==='date'?'report.period_text':s.binding;row.aiType=s.type;row.aiConfidence=s.confidence;}
        const suggestedRules=structuredClone(t.rules);
        if(!draft){suggestedRules.classifications||=[];for(const s of suggestions.filter(s=>s.confidence==='high'&&s.type!=='review')){suggestedRules.classifications.push({id:s.id,type:s.type,confirmed:true,source:'ai'});const rule=suggestedRules.objects?.find(o=>o.id===s.id);if(rule){rule.mode=s.type==='data'?'auto':['decorative','fixed','date'].includes(s.type)?'static':'blank';if(s.binding||s.type==='date')rule.binding=s.type==='date'?'report.period_text':s.binding;}}}
        const o=pages[pageIndex].objects;return {templateId:t.id,title:t.title,templateRevision:t.revision,projectId:t.projectId,projectRevision:current.revision,draftRevision:draft?.revision||0,dataRevision:data?.revision||0,dataMonth:data?.month||null,dataNeedsReview:!!data&&data.projectRevision!==current.revision,ai:aiSummary(t.id),pageIndex,pages:pages.map((p,i)=>({index:i,name:p.name,width:p.width||1920,height:p.height||1080})),objects:o.map(v=>({id:v.attributes['data-object-id'],name:v.attributes['data-name']||v.attributes['data-object-id'],kind:v.attributes['data-kind'],text:v.content.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,90),style:{left:v.style.left,top:v.style.top,width:v.style.width,height:v.style.height}})),recognition:recognized.objects.filter(v=>v.pageIndex===pageIndex).map(v=>({id:v.id,type:v.aiType||recognitionClass(v),source:v.aiType?'ai':'rules',aiConfidence:v.aiConfidence||null,confidence:v.confidence,reason:v.reason,binding:v.binding||v.suggestedBinding||'',sample:v.sample})),pendingReviewCount:pendingVisualReviews(draft?.rules||{},current.project,suggestions).length,targets:targets.filter(v=>v.pageIndex===pageIndex),allTargets:targets.map(v=>({id:v.id,kind:v.kind,pageIndex:v.pageIndex,name:v.name,capacity:v.capacity,columns:v.columns,sourceHint:v.sourceHint,representation:v.representation,suggestion:v.suggestion,rowOffset:v.rowOffset})),sources:data?matchSourceViews(data.sources).map(s=>({id:s.id,name:s.name,tables:s.tables.map(t=>({id:t.id,name:t.name,role:t.role,columns:t.columns,labels:t.columnLabels||t.columns,rows:t.rows.length})),scalars:s.scalars.map(v=>({id:v.id,path:v.path,label:v.label,value:v.value}))})):[],rules:draft?.rules||{...suggestedRules,visual:true,pages:pages.map((p,i)=>({pageIndex:i,purpose:p.name,mode:'always',continuation:''})),regions:targets.filter(v=>v.representation==='positioned-text').map(v=>({id:v.id,mode:'auto'}))},mappings:draft?.mappings||data?.mappings||targets.flatMap(v=>v.suggestion?[v.suggestion]:[]),canvas:`${config.publicUrl}/api/templates/${t.id}/canvas?pageIndex=${pageIndex}`};
      }
      case 'save_visual_rule_draft': {
        const t=db.templates[args.templateId];if(!t||t.origin!=='pptx')throw new ServiceError('请选择PPT导入的可编辑模板',404);
        const current=project(t.projectId);assertEditorsSaved(t.projectId);const data=db.templateData[t.id],prior=db.visualRuleDrafts[t.id];
        if((prior?.revision||0)!==args.baseRevision||t.revision!==args.templateRevision||current.revision!==args.projectRevision||(data?.revision||0)!==args.dataRevision)throw new ServiceError('模板、数据或画布规则已变化，请重新读取后合并',409);
        const rules=validateVisualRules(validateRules({...args.rules,visual:true,structure:'pptx'},current.project),current.project);
        if(!Array.isArray(args.mappings)||args.mappings.length>5000)throw new ServiceError('数据映射列表无效');
        const targets=new Set(data?matchTemplateData(current.project,data.sources).map(t=>t.id):[]);if(args.mappings.some(m=>!targets.has(m.id)))throw new ServiceError('数据位置已变化，请重新匹配',409);
        const next={revision:(prior?.revision||0)+1,templateRevision:t.revision,projectRevision:current.revision,dataRevision:data?.revision||0,rules,mappings:data?normalizeMappings(structuredClone(args.mappings),data.sources):structuredClone(args.mappings),updatedAt:new Date().toISOString()};db.visualRuleDrafts[t.id]=next;persist();return {templateId:t.id,revision:next.revision,projectRevision:current.revision,templateRevision:t.revision,dataRevision:next.dataRevision};
      }
      case 'preview_visual_rule_draft': {
        const t=db.templates[args.templateId],draft=db.visualRuleDrafts[args.templateId];if(!t||!draft||draft.revision!==args.draftRevision)throw new ServiceError('规则草稿已变化，请重新读取',409);
        const current=project(t.projectId),data=db.templateData[t.id];assertEditorsSaved(t.projectId);
        if(!data||data.projectRevision!==current.revision||draft.projectRevision!==current.revision||draft.templateRevision!==t.revision||draft.dataRevision!==data.revision)throw new ServiceError('需先导入并核对对应月份的数据，或重新匹配模板',409);
        const result=sourceDraft(t,current.project,data.sources,draft.mappings,data.month,draft.rules);draft.previewed={revision:draft.revision,projectId:result.projectId,at:new Date().toISOString()};persist();return {...result,draftRevision:draft.revision};
      }
      case 'publish_visual_rule_draft': {
        const t=db.templates[args.templateId],draft=db.visualRuleDrafts[args.templateId];if(!t||!draft||draft.revision!==args.draftRevision)throw new ServiceError('规则草稿已变化，请重新读取',409);
        const current=project(t.projectId),data=db.templateData[t.id];assertEditorsSaved(t.projectId);
        if(args.recognitionReviewed!==true)throw new ServiceError('请先核对页面、数据绑定与口径再发布');
        if(draft.previewed?.revision!==draft.revision||!db.projects[draft.previewed.projectId])throw new ServiceError('请先预览当前规则版本的填充结果');
        if(!data||data.projectRevision!==current.revision||draft.projectRevision!==current.revision||draft.templateRevision!==t.revision||draft.dataRevision!==data.revision)throw new ServiceError('模板或数据已变化，请重新预览',409);
        const rules=validateVisualRules(validateRules({...draft.rules,recognitionReviewed:true},current.project),current.project);validate(current.project);
        const pending=pendingVisualReviews(rules,current.project,aiFor(t.id)?.projectRevision===current.revision?aiSuggestions(t.id):[]);if(pending.length)throw new ServiceError(`还有${pending.length}个识别不确定的对象未在画布确认；请逐页核对后再发布`);
        fillVisualTemplate(current.project,data.sources,draft.mappings,data.month,renderImportedChart,rules);
        const dataVersion=data.revision+1,templateVersion=t.revision+1;
        const folder=path.join(dir,'history','template-'+t.id);fs.mkdirSync(folder,{recursive:true});
        const dataNext={...data,revision:dataVersion,mappings:draft.mappings,approved:true,updatedAt:new Date().toISOString()};
        fs.writeFileSync(path.join(dir,'history','template-data-'+t.id,dataVersion+'.json'),JSON.stringify(dataNext));
        fs.writeFileSync(path.join(folder,templateVersion+'.json'),JSON.stringify({project:current.project,rules,title:t.title,externalDataRevision:dataVersion}));
        db.templateData[t.id]=dataNext;Object.assign(t,{revision:templateVersion,rules,profile:rules.profile,publishedProjectRevision:current.revision,publishedAt:new Date().toISOString(),externalDataRevision:dataVersion,externalDataMonth:data.month});persist();return {templateId:t.id,revision:templateVersion,projectRevision:current.revision,dataRevision:dataVersion};
      }
      case 'get_template_data_matches': {
        const t=await call('get_template',{templateId:args.templateId}),data=db.templateData[t.id];
        return {templateId:t.id,title:t.title,templateRevision:t.revision,projectRevision:t.projectRevision,revision:data?.revision||0,month:data?.month||null,sources:data?matchSourceViews(data.sources):[],mappings:data?.mappings||[],approved:!!data?.approved,needsReview:!!data&&data.projectRevision!==t.projectRevision,targets:data?matchTemplateData(project(t.projectId).project,data.sources):[]};
      }
      case 'import_template_data': {
        const t=await call('get_template',{templateId:args.templateId});if(t.builtin)throw new ServiceError('请使用PPT生成的自定义模板');assertEditorsSaved(t.projectId);
        const check=()=>{const current=db.templates[t.id];if(args.baseRevision!==(db.templateData[t.id]?.revision||0)||args.templateRevision!==current.revision||args.projectRevision!==project(t.projectId).revision)throw new ServiceError('模板或导入数据已变化，请重读后再导入',409);};check();
        if(args.confirmedWindow!==true)throw new ServiceError('请确认导入数据的统计窗口与目标月份一致');
        const raw=[...(args.sources||[])];if(args.interface){raw.push(await fetchDataInterface(args.interface));check();assertEditorsSaved(t.projectId);}
        const sources=validateDataSources(raw.map(s=>Object.hasOwn(s,'json')?{...jsonSource(s.name,s.json),origin:s.origin||'upload'}:s),args.month);
        const previous=db.templateData[t.id],next={revision:(previous?.revision||0)+1,projectRevision:t.projectRevision,templateRevision:t.revision,month:args.month,sources,mappings:[],approved:false,updatedAt:new Date().toISOString()};
        persistTemplateData(t.id,next);return call('get_template_data_matches',{templateId:t.id});
      }
      case 'generate_template_data_preview': {
        const t=await call('get_template',{templateId:args.templateId}),data=db.templateData[t.id];assertEditorsSaved(t.projectId);
        if(!data||data.revision!==args.baseRevision||args.projectRevision!==t.projectRevision||args.templateRevision!==t.revision||data.projectRevision!==t.projectRevision)throw new ServiceError('模板或导入数据已变化，请重读后重新匹配',409);
        if(!args.mappings?.length)throw new ServiceError('请至少选择一个数据填充位置');
        const mappings=normalizeMappings(args.mappings,data.sources);const result=sourceDraft(t,project(t.projectId).project,data.sources,mappings,data.month);
        persistTemplateData(t.id,{...data,revision:data.revision+1,approved:true,mappings,updatedAt:new Date().toISOString()});return {...result,dataRevision:data.revision+1};
      }
      case 'get_template_data_sources': {
        const t=await call('get_template',{templateId:args.templateId});
        return describeSources(t,db.templateSources[t.id]);
      }
      case 'configure_template_data_sources': {
        const t=await call('get_template',{templateId:args.templateId});if(t.builtin)throw new ServiceError('内置模板使用现有SteamAuto数据源，无需登记');
        const saved=db.templateSources[t.id];assertEditorsSaved(t.projectId);
        if(args.baseRevision!==(saved?.revision||0)||args.templateRevision!==t.revision||args.projectRevision!==t.projectRevision)throw new ServiceError('模板或数据源配置已变化，请重新读取后匹配',409);
        const entries=normalizeSources(args.entries,sourceNeeds(t));
        const next={revision:(saved?.revision||0)+1,templateRevision:t.revision,projectRevision:t.projectRevision,entries,updatedAt:new Date().toISOString()};
        const folder=path.join(dir,'history','template-sources-'+t.id);fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,next.revision+'.json'),JSON.stringify(next));
        db.templateSources[t.id]=next;persist();return describeSources(t,next);
      }
      case 'list_templates': return [...builtinTemplates,...Object.values(db.templates)].map(({rules,...t})=>({...t,description:rules?.description||t.description||'',editor:t.projectId?links(t.projectId).editor:null,...(t.projectId?{pageCount:project(t.projectId).project.deck.pages.length}:{})}));
      case 'delete_template': {
        if(builtinTemplates.some(t=>t.id===args.templateId))throw new ServiceError('内置模板不能删除',400);
        const t=db.templates[args.templateId];if(!t)throw new ServiceError('自定义模板不存在或已删除',404);
        const draft=project(t.projectId);assertEditorsSaved(draft.id);
        if(t.revision!==args.baseRevision||draft.revision!==args.projectRevision)throw new ServiceError('模板或编辑稿已变化，请刷新后重试',409);
        if(Object.values(db.tasks).some(task=>task.status==='running'&&task.template?.id===t.id))throw new ServiceError('有月报正在使用该模板生成，请完成后再删除',409);
        if(Object.values(db.visualRuleSelections).some(s=>s.templateId===t.id&&s.dirty&&Date.now()-Date.parse(s.updatedAt)<20000))throw new ServiceError('模板画布有未保存的人工修改，请先保存',409);
        const reports=Object.values(db.projects).filter(p=>p.template?.id===t.id).length;
        db.deletedTemplates[t.id]={...t,deletedAt:new Date().toISOString(),retainedProjectId:t.projectId,existingReports:reports};
        delete db.templates[t.id];persist();
        return {templateId:t.id,deleted:true,existingReports:reports,projectRetained:true};
      }
      case 'get_template': {
        const t=builtinTemplates.find(t=>t.id===args.templateId)||db.templates[args.templateId];if(!t)throw new ServiceError('模板不存在',404);
        const generatedRules={data:'数据源：SteamAuto monthly-report schema 2.0。月份必须与report_month一致；缺失留空，不使用当前快照替代历史。',head:'头部榜：head.top20；重点游戏：head.highlights。选取名单来自上游标准数据包，模板不重新筛选或重算业务公式。',market:'大盘：market字段和历史数据窗口；数值直接取数，月报端只格式化和绘图。',releases:'新游金银铜榜：new_releases.gold/silver/bronze，沿用已有生成器的收入排序、D0至D13窗口和分页规则。',research:'专题游戏按selection指定；复杂活动分析与图片留给AI/人工后续补齐。补充写作要求不会自动联网研究。',manual:'人工文案与图片默认留空。固定内容会沿用模板样例，请勿将收入、排名或日期样例误设为固定。',overflow:'按绑定ID或对象ID匹配本期内容；自动对象无匹配时留空并记录独立任务文档。新入选游戏和超长表格保留动态对象及续页。'};
        if(t.builtin)return {...t,generatedRules,editable:false,message:'先生成草稿，再从已保存项目另存为可编辑模板。'};
        const draft=project(t.projectId);const pages=inspectTemplate(draft.project);
        const old=new Map((t.rules?.objects||[]).map(r=>[r.id,r]));for(const page of pages)for(const object of page.objects){Object.assign(object,old.get(object.id)||{});}
        const recognition=t.origin==='pptx'?{...analyzePptxTemplate(draft.project),projectRevision:draft.revision}:undefined;
        if(recognition)for(const page of pages)for(const object of page.objects)object.recognition=recognition.objects.find(row=>row.id===object.id);
        const result={...t,generatedRules,pages,bindingLabels,...(recognition?{recognition}:{}),projectRevision:draft.revision,editor:links(draft.id).editor,preview:links(draft.id).preview,rules:{profile:t.rules?.profile||t.profile,...(t.rules?.structure?{structure:t.rules.structure}:{}),description:t.rules?.description||'',objects:pages.flatMap(p=>p.objects).map(({id,mode})=>({id,mode,...(old.get(id)?.binding?{binding:old.get(id).binding}:{}),...(old.get(id)?.chart?{chart:old.get(id).chart}:{}),...(old.get(id)?.bar?{bar:old.get(id).bar}:{}),...(old.get(id)?.textTemplate?{textTemplate:old.get(id).textTemplate}:{}),...(old.get(id)?.sentence?{sentence:old.get(id).sentence}:{})}))}};
        if(db.templateData[t.id])Object.assign(generatedRules,{data:'使用实际上传文件或接口返回的数据，来源月份必须与目标月一致；已确认的外部映射随模板版本发布。',head:'表格根据确认的来源表及逐列映射填入；不自动套用Steam榜单筛选规则。',market:'指标按来源名称匹配文字对象，图表按来源列匹配分类和系列；不重算业务公式或单位。',releases:'数据行保持来源顺序；超过原表容量时列出缺失/容量问题，不强行撑高表格。',overflow:'外部映射在“导入数据并匹配”核对；下方旧Steam对象绑定不控制外部数据。未匹配的数据位置留空，版式变化后需重新匹配。'});
        const sourceMatch=describeSources(result,db.templateSources[t.id]);result.dataSourceMatch={...sourceMatch,entries:sourceMatch.entries.map(({sample,...e})=>e)};const data=db.templateData[t.id];result.importedData=data?{revision:data.revision,month:data.month,approved:data.approved,needsReview:data.projectRevision!==draft.revision}:null;return result;
      }
      case 'create_template': {
        const source=project(args.projectId);assertEditorsSaved(source.id);
        if(source.revision!==args.baseRevision)throw new ServiceError('来源版本变化，请重读后创建模板',409);
        if(typeof args.title!=='string'||!args.title.trim()||args.title.length>120)throw new ServiceError('请填写120字以内模板名称');
        const profile=args.profile||source.project.deck.notes?.template?.rules?.profile||'finished-eight';if(!profiles.includes(profile))throw new ServiceError('未知页面结构');
        const id=newTemplateId(),projectId=randomUUID(),title=args.title.trim();
        db.projects[projectId]={id:projectId,revision:1,month:source.month,kind:'template-draft',title:'模板编辑 · '+title,project:structuredClone(source.project),updatedAt:new Date().toISOString(),author:'template'};
        db.templates[id]={id,title,profile,revision:0,projectId,builtin:false,sourceProjectId:source.id,sourceRevision:source.revision};persist();
        return {templateId:id,projectId,revision:0,editor:links(projectId).editor};
      }
      case 'publish_template': {
        const t=db.templates[args.templateId];if(!t)throw new ServiceError('自定义模板不存在',404);
        const draft=project(t.projectId);assertEditorsSaved(draft.id);
        if(t.revision!==args.baseRevision||draft.revision!==args.projectRevision)throw new ServiceError('模板或编辑稿已变化，请重读后发布',409);
        validate(draft.project);const rules=validateRules(args.rules,draft.project);
        if(t.origin==='pptx'&&rules.recognitionReviewed!==true)throw new ServiceError('请先核对PPT页面识别、数据绑定及待确认项，再勾选识别确认后发布');
        const revision=t.revision+1,folder=path.join(dir,'history','template-'+t.id);fs.mkdirSync(folder,{recursive:true});
        const imported=db.templateData[t.id];if(imported?.approved&&imported.projectRevision!==draft.revision)throw new ServiceError('版式已变化，请重新匹配导入数据后再发布',409);
        fs.writeFileSync(path.join(folder,revision+'.json'),JSON.stringify({project:draft.project,rules,title:t.title,...(imported?.approved?{externalDataRevision:imported.revision}:{})}));
        Object.assign(t,{revision,rules,profile:rules.profile,publishedProjectRevision:draft.revision,publishedAt:new Date().toISOString(),externalDataRevision:imported?.approved?imported.revision:undefined,externalDataMonth:imported?.approved?imported.month:undefined});persist();
        return {templateId:t.id,revision,projectRevision:draft.revision};
      }
      case 'delete_project': {
        const current = project(args.projectId);
        if (current.kind === 'template-draft') throw new ServiceError('模板编辑稿不能移入回收站，请在模板库中管理模板', 400);
        if (Object.values(db.templates).some(t => t.projectId === current.id) || Object.values(db.deletedTemplates).some(t => t.retainedProjectId === current.id || t.projectId === current.id)) throw new ServiceError('该项目是模板的编辑稿，不能移入回收站', 400);
        if (Object.values(db.editingTargets).some(t => t.projectId === current.id)) throw new ServiceError('该草稿是当前AI编辑目标，请先在网页切换到其他草稿', 409);
        assertEditorsSaved(current.id);
        if (current.revision !== args.baseRevision) throw new ServiceError(`版本已变化（最新为 ${current.revision}），请重新读取后再删除`, 409);
        db.deletedProjects[current.id] = { ...current, deletedAt: new Date().toISOString(), deletedFromRevision: current.revision };
        delete db.projects[current.id];
        persist();
        return { projectId: current.id, title: current.title, revision: current.revision, deleted: true, restorable: true };
      }
      case 'list_deleted_projects': return Object.values(db.deletedProjects).map(({ project: value, ...meta }) => ({ ...meta, pageCount: value?.deck?.pages?.length ?? 0 }));
      case 'restore_deleted_project': {
        if (!Object.hasOwn(db.deletedProjects, args.projectId)) throw new ServiceError('回收站中没有该草稿', 404);
        if (Object.hasOwn(db.projects, args.projectId)) throw new ServiceError('项目列表中已存在同编号的草稿', 409);
        const { deletedAt, deletedFromRevision, ...restored } = db.deletedProjects[args.projectId];
        db.projects[args.projectId] = restored; delete db.deletedProjects[args.projectId];
        persist();
        return { projectId: restored.id, title: restored.title, revision: restored.revision, restored: true };
      }
      case 'list_projects': return Object.values(db.projects).map(({ project: value, ...meta }) => ({ ...meta, pageCount: value.deck.pages.length }));
      case 'get_editing_target': {
        if(!/^[a-zA-Z0-9_-]{16,100}$/.test(args.editingTargetId||''))throw new ServiceError('AI连接标识格式不正确');
        const selected=Object.hasOwn(db.editingTargets,args.editingTargetId)?db.editingTargets[args.editingTargetId]:null;
        return selected?.projectId?{...selected,title:project(selected.projectId).title,...links(selected.projectId)}:selected||{editingTargetId:args.editingTargetId,revision:0,projectId:null};
      }
      case 'clear_editing_target': {
        const previous=await call('get_editing_target',{editingTargetId:args.editingTargetId});
        if(previous.revision!==args.baseRevision)throw new ServiceError('AI目标已变化，请刷新后重试',409);
        db.editingTargets[args.editingTargetId]={editingTargetId:args.editingTargetId,projectId:null,revision:previous.revision+1};persist();return call('get_editing_target',{editingTargetId:args.editingTargetId});
      }
      case 'set_editing_target': {
        const previous=await call('get_editing_target',{editingTargetId:args.editingTargetId});
        if(previous.revision!==args.baseRevision)throw new ServiceError('AI目标已在另一个窗口切换，请刷新后重试',409);
        const target=project(args.projectId);if(target.kind==='template-draft')throw new ServiceError('请选择月报草稿，而不是模板编辑稿');
        assertEditorsSaved(target.id);
        db.editingTargets[args.editingTargetId]={editingTargetId:args.editingTargetId,projectId:target.id,revision:previous.revision+1,selectedAt:new Date().toISOString()};persist();
        return call('get_editing_target',{editingTargetId:args.editingTargetId});
      }
      case 'get_editing_context': {
        let selection;
        if(args.editingTargetId){selection=await call('get_editing_target',{editingTargetId:args.editingTargetId});if(!selection.projectId)return {status:'no_selection',editingTargetId:args.editingTargetId,message:'请先在我的月报中选择AI编辑草稿'};if(args.projectId&&args.projectId!==selection.projectId)throw new ServiceError('指定项目与网页已选择的AI草稿不同，请重新读取选择',409);args={...args,projectId:selection.projectId};}
        const all = liveSessions().filter(s => !args.projectId || s.projectId === args.projectId);
        const focused = all.filter(s => s.focused);
        const pool = focused.length ? focused : all;
        const ids = [...new Set(pool.map(s => s.projectId))];
        if (!args.projectId && ids.length !== 1) return { status: ids.length ? 'ambiguous' : 'no_editor', candidates: pool.map(s => ({projectId:s.projectId,title:project(s.projectId).title,pageIndex:s.pageIndex,dirty:s.dirty})) };
        const current = project(args.projectId || ids[0]);
        const session = pool.filter(s=>s.projectId===current.id).sort((a,b)=>b.seenAt-a.seenAt)[0];
        const pageIndex = session?.pageIndex ?? 0;
        const objects = current.project.deck.pages[pageIndex]?.objects || [];
        return { status: 'ok', ...(selection?{editingTargetId:selection.editingTargetId,selectionRevision:selection.revision,targetSource:'explicit-selection'}:{}), projectId: current.id, title: current.title, revision: current.revision, editorConnected: Boolean(session), dirty: all.some(s=>s.projectId===current.id&&(s.dirty||s.saving)), pageIndex, pageName:current.project.deck.pages[pageIndex]?.name, pageWidth:current.project.deck.pages[pageIndex]?.width||1920,pageHeight:current.project.deck.pages[pageIndex]?.height||1080,selectedObjectIds:session?.objectIds || [], objects:objects.map(o=>({id:o.attributes['data-object-id'],name:o.attributes['data-name'],kind:o.attributes['data-kind'],text:o.content.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,180)})), ...links(current.id) };
      }
      case 'apply_object_patch': {
        if (typeof args.requirement !== 'string' || !args.requirement.trim()) throw new ServiceError('请提供本次聊天修改需求');
        const current=project(args.projectId);
        assertEditorsSaved(current.id);
        const next=save(current.id,args.baseRevision,patch(current,args.changes),'ai-chat',{requirement:args.requirement,objectIds:args.changes.map(c=>c.id)});
        return { projectId:current.id, revision:next.revision, previousRevision:args.baseRevision, ...links(current.id) };
      }
      case 'apply_structure_patch': {
        if(typeof args.requirement!=='string'||!args.requirement.trim())throw new ServiceError('请提供本次聊天修改需求');
        const current=project(args.projectId);assertEditorsSaved(current.id);
        if(current.revision!==args.baseRevision)throw new ServiceError('Version conflict; read latest project',409);
        const result=applyStructure(current.project,args.operations);
        const next=save(current.id,args.baseRevision,result.project,'ai-structure',{requirement:args.requirement,operations:args.operations.map(({op,id,pageIndex})=>({op,id,pageIndex}))});
        return {projectId:current.id,revision:next.revision,previousRevision:args.baseRevision,addedObjectIds:result.addedObjectIds,...links(current.id)};
      }
      case 'restore_project_version': {
        const current=project(args.projectId);
        assertEditorsSaved(current.id);
        if(!Number.isInteger(args.targetRevision)||args.targetRevision<1||args.targetRevision>=current.revision) throw new ServiceError('请选择已有历史版本');
        const file=path.join(dir,'history',current.id,`${args.targetRevision}.json`);
        if(!fs.existsSync(file)) throw new ServiceError('历史版本不存在',404);
        const previous=JSON.parse(fs.readFileSync(file,'utf8'));
        const next=save(current.id,args.baseRevision,previous.project,'ai-restore');
        return {projectId:current.id,revision:next.revision,restoredFrom:args.targetRevision,...links(current.id)};
      }
      case 'generate_monthly_report': return generate(args);
      case 'get_task': if (!Object.hasOwn(db.tasks, args.taskId)) throw new ServiceError('Task not found', 404); return db.tasks[args.taskId];
      case 'get_project': {
        const value = project(args.projectId);
        return { id: value.id, revision: value.revision, month: value.month, template:value.project.deck.notes?.template||null,pages: value.project.deck.pages.map((page, index) => ({ index, name: page.name,width:page.width||1920,height:page.height||1080,background:page.background||'#ffffff',objects: page.objects.filter(o => !args.objectIds || args.objectIds.includes(o.attributes['data-object-id'])).map(o => args.pageIndex === index || args.objectIds ? o : { id: o.attributes['data-object-id'], name: o.attributes['data-name'], kind: o.attributes['data-kind'], style: o.style }) })) };
      }
      case 'propose_object_patch': {
        const current = project(args.projectId);
        if (current.revision !== args.baseRevision) throw new ServiceError('Version conflict; read latest project', 409);
        const request = args.requestId ? db.requests[args.requestId] : undefined;
        if (args.requestId && (!request || request.projectId !== args.projectId || !['pending', 'proposed'].includes(request.status))) throw new ServiceError('Active request for this project not found');
        patch(current, args.changes);
        const id = randomUUID(); db.proposals[id] = { id, projectId: args.projectId, baseRevision: args.baseRevision, changes: args.changes, requestId: request?.id, requirement: args.requirement || request?.requirement || '', status: 'pending', createdAt: new Date().toISOString() };
        if (request) Object.assign(request, { status: 'proposed', updatedAt: new Date().toISOString() });
        persist();
        return { ...db.proposals[id], preview: `${config.publicUrl}/preview/${args.projectId}?proposal=${id}` };
      }
      case 'apply_proposal': {
        const proposal = db.proposals[args.proposalId];
        if (!proposal || proposal.status !== 'pending') throw new ServiceError('Pending proposal not found');
        assertEditorsSaved(proposal.projectId);
        const next = save(proposal.projectId, proposal.baseRevision, patch(project(proposal.projectId), proposal.changes), 'ai-proposal');
        Object.assign(proposal, { status: 'applied', appliedRevision: next.revision, updatedAt: new Date().toISOString() });
        if (proposal.requestId && db.requests[proposal.requestId]) {
          Object.assign(db.requests[proposal.requestId], { status: 'applied', proposalId: proposal.id, appliedRevision: next.revision, updatedAt: new Date().toISOString() });
          for (const other of Object.values(db.proposals)) if (other.requestId === proposal.requestId && other.status === 'pending') other.status = 'superseded';
        }
        persist(); return { projectId: next.id, revision: next.revision, ...links(next.id) };
      }
      case 'reject_proposal': {
        const proposal = db.proposals[args.proposalId];
        if (!proposal || proposal.status !== 'pending') throw new ServiceError('Pending proposal not found');
        Object.assign(proposal, { status: 'rejected', updatedAt: new Date().toISOString() });
        const request = db.requests[proposal.requestId];
        if (request && request.status === 'proposed' && !Object.values(db.proposals).some(p => p.requestId === request.id && p.status === 'pending')) Object.assign(request, { status: 'pending', updatedAt: new Date().toISOString() });
        persist(); return { proposalId: proposal.id, status: proposal.status };
      }
      case 'cancel_ai_request': {
        const request = db.requests[args.requestId];
        if (!request || !['pending', 'proposed'].includes(request.status)) throw new ServiceError('Active request not found');
        Object.assign(request, { status: 'cancelled', updatedAt: new Date().toISOString() });
        for (const proposal of Object.values(db.proposals)) if (proposal.requestId === request.id && proposal.status === 'pending') proposal.status = 'rejected';
        persist(); return { requestId: request.id, status: request.status };
      }
      case 'rename_project': {
        if (typeof args.title !== 'string' || !args.title.trim() || args.title.trim().length > 120) throw new ServiceError('项目名称须为1到120个字符');
        const current = project(args.projectId);
        const next = save(current.id, args.baseRevision, current.project, 'operator-rename');
        next.title = args.title.trim(); persist();
        return { projectId: current.id, revision: next.revision, title: next.title };
      }
      case 'get_preview_link': project(args.projectId); return links(args.projectId);
      case 'list_versions': { const current = project(args.projectId); const history = path.join(dir, 'history', current.id); return { currentRevision: current.revision, revisions: fs.existsSync(history) ? fs.readdirSync(history).map(f => Number(f.replace('.json', ''))).sort((a,b) => b-a) : [] }; }
      case 'export_project': { const current = project(args.projectId); return { revision: current.revision, html: `${config.publicUrl}/api/projects/${current.id}/export.html`, editableJson: `${config.publicUrl}/api/projects/${current.id}/export.json` }; }
      case 'list_ai_requests': return Object.values(db.requests).filter(request => (!args.projectId || request.projectId === args.projectId) && (args.status === 'all' || (args.status ? request.status === args.status : ['pending', 'proposed'].includes(request.status))));
      case 'get_ai_request': if (!Object.hasOwn(db.requests, args.requestId)) throw new ServiceError('Request not found', 404); return db.requests[args.requestId];
      default: throw new ServiceError('Unknown tool', 404);
    }
  }
  return { call, project, save, db, putAsset(id,input) { project(id); return assets.put(id,input.data); }, getAsset(id,file) { project(id); return assets.get(id,file); }, archive(id) {
    const result=assets.pack(project(id));
    return { ...result.value, assets:result.assets };
  }, updateEditorContext(id, input) {
    const current=project(id);
    if(typeof input.sessionId!=='string'||input.sessionId.length>100||!input.sessionId) throw new ServiceError('Invalid editor session');
    if(input.closed){sessions.delete(input.sessionId);return {ok:true};}
    if(!Number.isInteger(input.pageIndex)||input.pageIndex<0||input.pageIndex>=current.project.deck.pages.length) throw new ServiceError('Invalid current page');
    const ids=new Set(current.project.deck.pages.flatMap(p=>p.objects).map(o=>o.attributes['data-object-id']));
    const objectIds=Array.isArray(input.objectIds)?input.objectIds.filter(id=>ids.has(id)):[];
    sessions.set(input.sessionId,{sessionId:input.sessionId,projectId:id,pageIndex:input.pageIndex,objectIds:[...new Set(objectIds)],dirty:input.dirty===true,saving:input.saving===true,focused:input.focused===true,seenAt:Date.now()});
    return {ok:true,revision:current.revision};
  }, importPptxTemplate(input) {
    if(typeof input?.title!=='string'||!input.title.trim()||input.title.length>120)throw new ServiceError('请填写120字以内模板名称');
    if(input.profile!==undefined&&!profiles.includes(input.profile))throw new ServiceError('未知页面结构');
    const aiMode=input.aiMode||'local';
    if(!['server','local'].includes(aiMode))throw new ServiceError('AI识别执行方式无效');
    if(aiMode==='server')throw new ServiceError('服务器模型尚未启用；请使用本地AI');
    validate(input.project);
    if(input.project.deck.notes?.template_origin!=='pptx'||!input.project.deck.notes?.pptx_imports?.length)throw new ServiceError('缺少PPTX导入记录');
    const projectId=randomUUID(),id=newTemplateId(),title=input.title.trim();
    // Deduplicate embedded images once, retaining editable markup and an isolated draft.
    let serialized=JSON.stringify(input.project);
    for(const data of new Set(serialized.match(/data:image\/[a-z+]+;base64,[A-Za-z\d+/=]+/g)||[]))serialized=serialized.split(data).join(assets.put(projectId,data).src);
    const value=JSON.parse(serialized);
    const recognition=analyzePptxTemplate(value);
    const rules={profile:'full',structure:'pptx',description:'按上传PPT的页面和对象生成；已按标题、表头和图表系列匹配常见数据字段。未知区域留空，公式与筛选沿用上游数据规则；发布前需核对识别结果。',objects:recognition.objects.map(({id,mode,binding})=>({id,mode,...(binding?{binding}:{})}))};
    db.projects[projectId]={id:projectId,revision:1,month:'imported',kind:'template-draft',title:'模板编辑 · '+title,project:value,updatedAt:new Date().toISOString(),author:'pptx-template-import'};
    db.templates[id]={id,title,profile:'full',revision:0,projectId,builtin:false,origin:'pptx',rules};
    db.templateAi[id]={revision:1,projectRevision:1,mode:aiMode,tasks:createTemplateAiTasks(id,value,aiMode)};persist();
    return {templateId:id,projectId,revision:0,editor:links(projectId).editor,preview:links(projectId).preview,pages:value.deck.pages.length,recognition,ai:aiSummary(id)};
  }, importProject(input) {
    const id = randomUUID();
    const value = assets.unpack(id,input?.project || input,input?.assets);
    validate(value);
    const month = /^\d{4}-\d{2}$/.test(input?.month || '') ? input.month : 'imported';
    db.projects[id] = { id, revision: 1, month, title: (input?.title || '导入的月报') + '（导入副本）', project: value, updatedAt: new Date().toISOString(), author: 'import' };
    persist();
    return { projectId: id, ...links(id) };
  }, submitRequest(id, input) {
    const current = project(id);
    if (current.revision !== input.baseRevision) throw new ServiceError('Version conflict; reload before marking', 409);
    const ids = new Set(current.project.deck.pages.flatMap(p => p.objects).map(o => o.attributes['data-object-id']));
    if (!Array.isArray(input.objectIds) || !input.objectIds.length || input.objectIds.some(value => !ids.has(value))) throw new ServiceError('Unknown marked object');
    if (typeof input.requirement !== 'string' || !input.requirement.trim()) throw new ServiceError('Requirement required');
    const request = { id: randomUUID(), projectId: id, baseRevision: current.revision, objectIds: [...new Set(input.objectIds)], requirement: input.requirement, status: 'pending', createdAt: new Date().toISOString() };
    db.requests[request.id] = request; persist(); return request;
  }, silex(id) {
    const current = project(id);
    const { silexState, ...canonical } = current.project;
    let editorData = silexState;
    if (!editorData) {
      const result = require(path.join(config.toolkitDir, 'lib/silex-adapter.cjs')).createSilexProject(current.project);
      editorData = { ...result.website, pages: result.pages };
    }
    // The editor state is already sent as editorData. Do not duplicate every
    // embedded font and image a second time inside project.silexState.
    return { revision: current.revision, project: canonical, editorData };
  }, preview(id, proposalId, embedAssets = false) {
    const current = project(id);
    if (!proposalId) return render(embedAssets ? assets.pack(current.project,true).value : current.project);
    const proposal = db.proposals[proposalId];
    if (!proposal || proposal.projectId !== id) throw new ServiceError('Proposal not found', 404);
    if (proposal.baseRevision !== current.revision) throw new ServiceError('Proposal is stale', 409);
    return render(patch(current, proposal.changes));
  } };
}
