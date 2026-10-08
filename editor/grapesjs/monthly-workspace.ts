import { Component, Editor, Page } from 'grapesjs'
import { cmdOpenTableTools, cmdOpenGeometry, cmdToggleFreePosition, cmdToggleLock } from './presentation-mode'
import { cmdImportPptx } from './pptx-import'

export const cmdToggleWorkspaceMode = 'monthly-workspace:toggle-mode'
export const cmdSaveProject = 'monthly-workspace:save'
export const cmdUndo = 'monthly-workspace:undo'
export const cmdRedo = 'monthly-workspace:redo'
export const cmdCreateAiRequest = 'monthly-ai:create-request'
export const cmdApplyAiPatch = 'monthly-ai:apply-patch'
const cmdToggleBlocks = 'open-blocks'
const cmdToggleLayers = 'open-layers'

type WorkspaceMode = 'basic' | 'advanced'

export type AiObjectRequest = {
  id: string
  bindingId: string
  type: string
  name: string
  text: string
  html: string
  style: Record<string, string>
  parentId: string | null
  childIds: string[]
}

export type AiEditRequest = {
  schema: 'monthly-editor-ai-request/v1'
  page: { id: string, name: string }
  requirement: string
  objects: AiObjectRequest[]
  constraints: { modifyOnlyObjectIds: string[], preserveUnmarkedObjects: true }
}

export type AiObjectPatch = {
  id: string
  text?: string
  html?: string
  style?: Record<string, string | number>
  attributes?: Record<string, string>
}

export type AiPatch = {
  schema?: 'monthly-editor-ai-patch/v1'
  objects: AiObjectPatch[]
}

const stableAttributeNames = ['data-binding-id', 'data-object-id', 'id'] as const
const protectedAttributes = new Set(['id', 'data-binding-id', 'data-object-id'])
const keyStyleNames = [
  'position', 'left', 'top', 'width', 'height', 'display', 'color', 'background', 'background-color',
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'text-align', 'border', 'border-radius',
  'padding', 'margin', 'opacity', 'transform', 'object-fit', 'z-index',
]

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[char]!))
}

function componentAttributes(component: Component): Record<string, string> {
  return component.getAttributes() as Record<string, string>
}

export function stableObjectId(component: Component): string {
  const attributes = componentAttributes(component)
  return stableAttributeNames.map(name => attributes[name]).find(Boolean) || component.getId()
}

function businessKind(component: Component): string {
  const attributes = componentAttributes(component)
  const explicit = attributes['data-kind'] || attributes['data-monthly-component'] || attributes['data-pptx-kind']
  if (explicit) {
    if (/table/i.test(explicit)) return 'table'
    if (/chart/i.test(explicit)) return 'chart'
    if (/image|picture/i.test(explicit)) return 'image'
    if (/text|title|shape/i.test(explicit)) return 'text'
    if (/card|opinion|kpi/i.test(explicit)) return 'card'
    if (/page|slide/i.test(explicit)) return 'page'
    if (explicit === 'unsupported') return 'unsupported'
  }
  const tag = String(component.get('tagName') || '').toLowerCase()
  const type = String(component.get('type') || '').toLowerCase()
  if (type === 'image' || tag === 'img') return 'image'
  let ancestor: Component | undefined = component
  while (ancestor) {
    if (String(ancestor.get('tagName') || '').toLowerCase() === 'table') return 'table'
    ancestor = ancestor.parent()
  }
  if (tag === 'canvas' || attributes['data-chart-type'] || component.getClasses().includes('chart')) return 'chart'
  if (/^(p|h[1-6]|span|a|li)$/.test(tag) || type === 'text' || type === 'textnode') return 'text'
  if (attributes['data-report-page'] || attributes['data-pptx-page']) return 'page'
  if (component.getClasses().some(name => /card|kpi|opinion/.test(name))) return 'card'
  return 'container'
}

const kindLabels: Record<string, string> = {
  text: '文字', image: '图片', table: '表格', chart: '图表', card: '卡片', page: '页面', container: '容器',
  shape: 'PPT 形状', unsupported: '待重建对象', 'section-title': '章节标题', 'kpi-card': '指标卡',
  'opinion-box': '观点框', 'game-card': '游戏卡片', 'image-text': '图文模块', 'ranking-table': '榜单表格',
}

export function businessName(component: Component): string {
  const attributes = componentAttributes(component)
  const name = attributes['data-name'] || String(component.get('name') || '').trim()
  const genericName = /^(body|div|span|p|section|default|text\s*\d*|container\s*\d*|image\s*\d*|文字|容器|图片|表格|图表|卡片|对象)$/i
  if (name && !genericName.test(name)) return name
  const kind = businessKind(component)
  const text = component.getEl()?.textContent?.replace(/\s+/g, ' ').trim()
    || String(component.get('content') || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
    || ''
  return text ? `${kindLabels[kind] || '对象'} · ${text.slice(0, 18)}` : (kindLabels[kind] || '对象')
}

function keyStyles(component: Component): Record<string, string> {
  const style = component.getStyle() as Record<string, string>
  return Object.fromEntries(keyStyleNames.filter(name => style[name] !== undefined).map(name => [name, String(style[name])]))
}

function findPage(editor: Editor, component: Component): Page {
  return editor.Pages.getAll().find(page => {
    let current: Component | undefined = component
    const root = page.getMainComponent()
    while (current) {
      if (current === root) return true
      current = current.parent()
    }
    return false
  }) || editor.Pages.getSelected()
}

function componentHtml(component: Component): string {
  const element = component.getEl()
  return element?.outerHTML || component.toHTML()
}

export function buildAiRequest(editor: Editor, components: Component[], requirement: string): AiEditRequest {
  if (!components.length) throw new Error('请先在 AI 标记模式中选择对象。')
  if (!requirement.trim()) throw new Error('请填写希望 AI 完成的修改。')
  const page = findPage(editor, components[0])
  const objects = components.map(component => {
    const attributes = componentAttributes(component)
    return {
      id: stableObjectId(component),
      bindingId: attributes['data-binding-id'] || stableObjectId(component),
      type: businessKind(component),
      name: businessName(component),
      text: component.getEl()?.textContent?.trim() || '',
      html: componentHtml(component),
      style: keyStyles(component),
      parentId: component.parent() ? stableObjectId(component.parent()!) : null,
      childIds: component.components().models.map(stableObjectId),
    }
  })
  return {
    schema: 'monthly-editor-ai-request/v1',
    page: { id: page?.id || '', name: page?.getName() || '' },
    requirement: requirement.trim(),
    objects,
    constraints: { modifyOnlyObjectIds: objects.map(object => object.id), preserveUnmarkedObjects: true },
  }
}

export function validateAiPatch(value: unknown, allowedIds: Set<string>): AiPatch {
  if (!value || typeof value !== 'object' || !Array.isArray((value as AiPatch).objects)) throw new Error('补丁必须包含 objects 数组。')
  const patch = value as AiPatch
  patch.objects.forEach(item => {
    if (!item || typeof item.id !== 'string') throw new Error('每个补丁对象必须包含字符串 id。')
    if (!allowedIds.has(item.id)) throw new Error(`对象 ${item.id} 未被标记，已拒绝补丁。`)
    if (item.style && (typeof item.style !== 'object' || Array.isArray(item.style))) throw new Error(`对象 ${item.id} 的 style 必须是对象。`)
    if (item.attributes && (typeof item.attributes !== 'object' || Array.isArray(item.attributes))) throw new Error(`对象 ${item.id} 的 attributes 必须是对象。`)
  })
  return patch
}

function findByStableId(editor: Editor, id: string): Component | undefined {
  return editor.Pages.getAll().flatMap(page => [page.getMainComponent(), ...page.getMainComponent().find('*')])
    .find(component => stableObjectId(component) === id)
}

function applyAiPatch(editor: Editor, patch: AiPatch, allowedIds: Set<string>) {
  const validated = validateAiPatch(patch, allowedIds)
  editor.UndoManager.start()
  try {
    validated.objects.forEach(item => {
      const component = findByStableId(editor, item.id)
      if (!component) throw new Error(`找不到对象 ${item.id}。`)
      if (item.html !== undefined) component.components(item.html)
      else if (item.text !== undefined) component.components([{ type: 'textnode', content: item.text }])
      if (item.style) component.setStyle({ ...component.getStyle(), ...item.style })
      if (item.attributes) {
        const safeAttributes = Object.fromEntries(Object.entries(item.attributes).filter(([name]) => !protectedAttributes.has(name)))
        component.addAttributes(safeAttributes)
      }
    })
  } finally {
    editor.UndoManager.stop()
  }
}

function updateAiHighlight(editor: Editor, marked: Set<Component>, visible: boolean) {
  const document = editor.Canvas.getDocument()
  if (!document) return
  let style = document.getElementById('monthly-ai-mark-style') as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = 'monthly-ai-mark-style'
    document.head.append(style)
  }
  style.textContent = visible ? [...marked].map(component => {
    const attributes = componentAttributes(component)
    if (attributes.id) return `#${CSS.escape(attributes.id)}`
    if (attributes['data-binding-id']) return `[data-binding-id="${CSS.escape(attributes['data-binding-id'])}"]`
    if (attributes['data-object-id']) return `[data-object-id="${CSS.escape(attributes['data-object-id'])}"]`
    return ''
  }).filter(Boolean).map(selector => `${selector}{outline:3px solid #e58b2a!important;outline-offset:2px!important}`).join('\n') : ''
}

function copyText(value: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value)
  const textarea = document.createElement('textarea')
  textarea.value = value
  document.body.append(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
  return Promise.resolve()
}

function notify(editor: Editor, type: 'success' | 'error' | 'warning', message: string) {
  editor.runCommand('notifications:add', { type, group: '月报编辑器', message })
}

function openAiDialog(editor: Editor, marked: Set<Component>, initialMode: boolean, onModeChange: (active: boolean) => void) {
  let generatedRequest: AiEditRequest | undefined
  const panel = document.createElement('div')
  panel.className = 'monthly-ai-dialog'
  panel.innerHTML = `
    <div class="monthly-ai-dialog__mode"><strong>AI 标记模式</strong><span>开启后，点击画布对象即可加入标记。</span><button data-action="toggle-mode">开启标记</button></div>
    <div class="monthly-ai-dialog__marked"></div>
    <label>修改需求<textarea data-requirement placeholder="例如：将这些卡片统一成浅色背景，并把标题改为本月重点产品。"></textarea></label>
    <div class="monthly-ai-dialog__actions">
      <button data-action="mark-selection">标记当前所选</button><button data-action="clear">清除标记</button>
      <button data-action="generate" class="primary">生成结构化请求</button><button data-action="copy">复制请求</button>
    </div>
    <label>结构化 AI 请求<textarea data-request readonly></textarea></label>
    <label>导入 AI 补丁<textarea data-patch placeholder='{"schema":"monthly-editor-ai-patch/v1","objects":[{"id":"对象ID","text":"新文本","style":{"color":"#00366b"}}]}'></textarea></label>
    <div class="monthly-ai-dialog__actions"><button data-action="example">填入示例补丁</button><button data-action="apply" class="primary">按对象 ID 应用补丁</button></div>`
  let markMode = initialMode
  const refreshMarked = () => {
    const target = panel.querySelector('.monthly-ai-dialog__marked')!
    target.innerHTML = `<strong>已标记 ${marked.size} 个对象</strong>${[...marked].map(component => `<span>${escapeHtml(businessName(component))}<small>${escapeHtml(stableObjectId(component))}</small></span>`).join('')}`
    updateAiHighlight(editor, marked, markMode)
  }
  const setMode = (active: boolean) => {
    markMode = active
    onModeChange(active)
    const button = panel.querySelector('[data-action="toggle-mode"]') as HTMLButtonElement
    button.textContent = active ? '结束标记' : '开启标记'
    button.classList.toggle('active', active)
  }
  panel.addEventListener('click', async event => {
    const action = (event.target as HTMLElement).closest('button')?.dataset.action
    if (!action) return
    try {
      if (action === 'toggle-mode') setMode(!markMode)
      if (action === 'mark-selection') editor.getSelectedAll().forEach(component => marked.add(component))
      if (action === 'clear') marked.clear()
      if (action === 'generate') {
        generatedRequest = buildAiRequest(editor, [...marked], (panel.querySelector('[data-requirement]') as HTMLTextAreaElement).value)
        ;(panel.querySelector('[data-request]') as HTMLTextAreaElement).value = JSON.stringify(generatedRequest, null, 2)
        window.dispatchEvent(new CustomEvent('monthly-ai-request', { detail: generatedRequest }))
      }
      if (action === 'copy') {
        const value = (panel.querySelector('[data-request]') as HTMLTextAreaElement).value
        if (!value) throw new Error('请先生成结构化请求。')
        await copyText(value)
        notify(editor, 'success', 'AI 请求已复制。')
      }
      if (action === 'example') {
        const first = [...marked][0]
        if (!first) throw new Error('请先标记对象。')
        ;(panel.querySelector('[data-patch]') as HTMLTextAreaElement).value = JSON.stringify({ schema: 'monthly-editor-ai-patch/v1', objects: [{ id: stableObjectId(first), style: { outline: '2px solid #d0a044' } }] }, null, 2)
      }
      if (action === 'apply') {
        const value = JSON.parse((panel.querySelector('[data-patch]') as HTMLTextAreaElement).value)
        applyAiPatch(editor, value, new Set([...marked].map(stableObjectId)))
        notify(editor, 'success', `已按对象 ID 应用 ${value.objects.length} 项修改。`)
      }
      refreshMarked()
    } catch (error) {
      notify(editor, 'error', error instanceof Error ? error.message : String(error))
    }
  })
  setMode(initialMode)
  refreshMarked()
  editor.Modal.open({ title: 'AI 协作', content: panel }).onceClose(() => updateAiHighlight(editor, marked, markMode))
}

function duplicateSelected(editor: Editor) {
  const selected = editor.getSelected()
  if (!selected?.parent()) throw new Error('请选择可复制的对象。')
  const clone = selected.clone()
  const style = clone.getStyle()
  const left = Number.parseFloat(String(style.left))
  const top = Number.parseFloat(String(style.top))
  clone.setStyle({ ...style, ...(Number.isFinite(left) ? { left: `${left + 16}px` } : {}), ...(Number.isFinite(top) ? { top: `${top + 16}px` } : {}) })
  selected.parent()!.components().add(clone, { at: selected.index() + 1 })
  editor.select(clone)
}

function moveLayer(editor: Editor, direction: 1 | -1) {
  const selected = editor.getSelected()
  const parent = selected?.parent()
  if (!selected || !parent) throw new Error('请选择可调整层级的对象。')
  const target = Math.max(0, Math.min(parent.components().length - 1, selected.index() + direction))
  if (target !== selected.index()) selected.move(parent, { at: target })
}

function replaceImage(editor: Editor, component: Component) {
  editor.AssetManager.open({
    select(asset, complete) {
      component.addAttributes({ src: asset.getSrc() })
      if (complete) editor.AssetManager.close()
    },
    types: ['image'],
  })
}

function editSelected(editor: Editor) {
  const component = editor.getSelected()
  if (!component) throw new Error('请先选择对象。')
  const kind = businessKind(component)
  if (kind === 'image') replaceImage(editor, component)
  else if (kind === 'table') editor.runCommand(cmdOpenTableTools)
  else if (kind === 'text' || kind === 'shape') editor.runCommand('core:component-enter')
  else editor.runCommand(cmdOpenGeometry)
}

function renderSelectionInspector(editor: Editor, panel: HTMLElement, quick: HTMLElement) {
  const component = editor.getSelected()
  const page = editor.Pages.getSelected()
  if (!component || component === page?.getMainComponent()) {
    panel.innerHTML = `<header><strong>页面属性</strong><span>${escapeHtml(page?.getName() || '')}</span></header><p>选择对象后可编辑文字、图片、表格、图表或卡片属性。</p>`
    quick.classList.remove('visible')
    return
  }
  const kind = businessKind(component)
  const style = component.getStyle() as Record<string, string>
  panel.innerHTML = `<header><strong>${escapeHtml(kindLabels[kind] || '对象')}属性</strong><span>${escapeHtml(businessName(component))}</span></header>
    <label>业务名称<input data-property="name" value="${escapeHtml(businessName(component))}"></label>
    ${kind === 'text' || kind === 'shape' ? `<div class="monthly-property-grid"><label>字号<input data-style="font-size" value="${escapeHtml(style['font-size'] || '')}" placeholder="24px"></label><label>颜色<input data-style="color" type="color" value="${escapeHtml(/^#[0-9a-f]{6}$/i.test(style.color || '') ? style.color : '#00366b')}"></label></div>` : ''}
    ${kind === 'image' ? '<button data-inspector-action="replace-image">替换图片</button><label>适应方式<select data-style="object-fit"><option value="cover">裁切填充</option><option value="contain">完整显示</option><option value="fill">拉伸填充</option></select></label>' : ''}
    ${kind === 'table' ? '<button data-inspector-action="table">批量粘贴与行列设置</button>' : ''}
    ${kind === 'chart' ? '<button data-inspector-action="chart">编辑图表数据</button><p>图表数据编辑器将在下一阶段接入；当前可调整位置与尺寸。</p>' : ''}
    ${kind === 'card' || kind === 'container' ? `<div class="monthly-property-grid"><label>背景<input data-style="background-color" type="color" value="${escapeHtml(/^#[0-9a-f]{6}$/i.test(style['background-color'] || style.background || '') ? (style['background-color'] || style.background) : '#ffffff')}"></label><label>圆角<input data-style="border-radius" value="${escapeHtml(style['border-radius'] || '')}" placeholder="12px"></label></div>` : ''}
    <button data-inspector-action="geometry">位置与尺寸</button>`
  panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-style]').forEach(input => {
    if (input instanceof HTMLSelectElement && style[input.dataset.style!]) input.value = style[input.dataset.style!]
    input.addEventListener('change', () => component.setStyle({ ...component.getStyle(), [input.dataset.style!]: input.value }))
  })
  panel.querySelector<HTMLInputElement>('[data-property="name"]')?.addEventListener('change', event => {
    const value = (event.target as HTMLInputElement).value.trim()
    component.set('name', value)
    component.addAttributes({ 'data-name': value })
  })
  panel.onclick = event => {
    const action = (event.target as HTMLElement).closest('button')?.dataset.inspectorAction
    if (!action) return
    if (action === 'replace-image') replaceImage(editor, component)
    if (action === 'table') editor.runCommand(cmdOpenTableTools)
    if (action === 'geometry' || action === 'chart') editor.runCommand(cmdOpenGeometry)
  }
  quick.classList.add('visible')
  quick.querySelector('[data-quick="edit"]')!.textContent = kind === 'image' ? '替换' : '编辑'
}

function assignBusinessNames(editor: Editor) {
  editor.Pages.getAll().forEach(page => {
    const root = page.getMainComponent()
    root.set('name', page.getName() || '页面', { silent: true })
    root.find('*').forEach(component => component.set('name', businessName(component), { silent: true }))
  })
}

function injectStyles() {
  if (document.getElementById('monthly-workspace-style')) return
  const style = document.createElement('style')
  style.id = 'monthly-workspace-style'
  style.textContent = `
    .monthly-command-bar { position:fixed; z-index:1001; left:70px; right:250px; top:4px; min-height:40px; display:flex; align-items:center; gap:5px; padding:4px 8px; border:1px solid #3f4a55; border-radius:7px; color:#e8eef4; background:#242b32; box-shadow:0 4px 16px #0005; }
    .monthly-command-group { display:flex; align-items:center; gap:3px; padding-right:6px; border-right:1px solid #46515c; }
    .monthly-command-group:last-child { border:0; } .monthly-command-group strong { color:#aeb9c4; padding:0 4px; font-size:10px; font-weight:600; }
    .monthly-command-bar button,.monthly-selection-panel button,.monthly-quick-actions button,.monthly-ai-dialog button { padding:6px 9px; border:1px solid transparent; border-radius:4px; color:#e8eef4; background:#303944; cursor:pointer; white-space:nowrap; }
    .monthly-command-bar button:hover,.monthly-selection-panel button:hover,.monthly-quick-actions button:hover,.monthly-ai-dialog button:hover { border-color:#5999d0; background:#394857; }
    .monthly-command-bar button.active { color:#fff; background:#2275b8; } .monthly-save-status { margin-left:auto; min-width:105px; color:#9fc5a9; font-size:11px; text-align:right; }
    .monthly-save-status.dirty { color:#e4b15a; } .monthly-save-status.error { color:#f27c7c; }
    .monthly-selection-panel { position:fixed; z-index:999; right:12px; top:58px; width:225px; max-height:calc(100vh - 120px); overflow:auto; padding:12px; border:1px solid #3f4a55; border-radius:7px; color:#e8eef4; background:#242b32; box-shadow:0 4px 16px #0005; }
    body.monthly-advanced-mode .monthly-selection-panel { right:270px; }
    .monthly-selection-panel header { display:grid; gap:3px; padding-bottom:10px; border-bottom:1px solid #46515c; } .monthly-selection-panel header span,.monthly-selection-panel p { color:#aeb9c4; font-size:11px; }
    .monthly-selection-panel label { display:grid; gap:4px; margin-top:10px; color:#bdc8d2; font-size:11px; } .monthly-selection-panel input,.monthly-selection-panel select,.monthly-ai-dialog textarea { box-sizing:border-box; width:100%; padding:7px; border:1px solid #4d5a67; border-radius:4px; color:#fff; background:#1b2026; }
    .monthly-selection-panel button { width:100%; margin-top:10px; } .monthly-property-grid { display:grid; grid-template-columns:1fr 1fr; gap:7px; }
    .monthly-quick-actions { position:fixed; z-index:1000; left:50%; bottom:14px; display:none; gap:4px; padding:5px; transform:translateX(-50%); border:1px solid #46515c; border-radius:7px; background:#242b32; box-shadow:0 4px 18px #0007; } .monthly-quick-actions.visible { display:flex; }
    .monthly-ai-dialog { min-width:620px; display:grid; gap:12px; color:#ddd; } .monthly-ai-dialog__mode { display:flex; align-items:center; gap:8px; } .monthly-ai-dialog__mode span { flex:1; color:#aeb8c2; font-size:12px; }
    .monthly-ai-dialog__marked { display:flex; flex-wrap:wrap; gap:6px; } .monthly-ai-dialog__marked strong { width:100%; } .monthly-ai-dialog__marked span { display:grid; padding:5px 8px; border-radius:4px; background:#303944; font-size:12px; } .monthly-ai-dialog__marked small { color:#95a3af; }
    .monthly-ai-dialog label { display:grid; gap:5px; } .monthly-ai-dialog textarea { min-height:90px; font:12px/1.45 monospace; resize:vertical; } .monthly-ai-dialog [data-request] { min-height:150px; }
    .monthly-ai-dialog__actions { display:flex; justify-content:flex-end; gap:6px; } .monthly-ai-dialog .primary { background:#2275b8; }
    body.monthly-basic-mode .gjs-clm-tags, body.monthly-basic-mode .gjs-sm-header, body.monthly-basic-mode [data-sector-title="选择器"], body.monthly-basic-mode .project-bar__panel .gjs-clm-tags { display:none!important; }
    body.monthly-basic-mode .gjs-pn-views-container { display:none!important; }
    body.monthly-basic-mode [title^="符号"], body.monthly-basic-mode [title^="字体"], body.monthly-basic-mode [title="CSS 变量"], body.monthly-basic-mode [title^="设置 ("] { display:none!important; }
    body.monthly-ai-mark-mode .monthly-command-bar [data-action="ai"] { color:#fff; background:#ad651e; }
  `
  document.head.append(style)
}

function createWorkspaceUi(editor: Editor) {
  injectStyles()
  const bar = document.createElement('div')
  bar.className = 'monthly-command-bar'
  bar.innerHTML = `
    <div class="monthly-command-group"><strong>文件</strong><button data-command="${cmdSaveProject}">保存</button><button data-command="${cmdImportPptx}">导入PPT</button></div>
    <div class="monthly-command-group"><strong>历史</strong><button data-command="${cmdUndo}">撤销</button><button data-command="${cmdRedo}">重做</button></div>
    <div class="monthly-command-group"><strong>插入</strong><button data-command="${cmdToggleBlocks}">组件</button></div>
    <div class="monthly-command-group"><strong>排列</strong><button data-command="${cmdToggleFreePosition}">自由移动</button><button data-command="${cmdOpenGeometry}">位置尺寸</button><button data-command="${cmdToggleLayers}">对象树</button></div>
    <div class="monthly-command-group"><strong>数据</strong><button data-command="${cmdOpenTableTools}">表格</button><button data-action="ai">AI 标记</button></div>
    <div class="monthly-command-group"><strong>查看</strong><button data-command="preview">预览</button><button data-action="export">导出</button><button data-action="mode">高级模式</button></div>
    <span class="monthly-save-status">已自动保存</span>`
  const inspector = document.createElement('aside')
  inspector.className = 'monthly-selection-panel'
  const quick = document.createElement('div')
  quick.className = 'monthly-quick-actions'
  quick.innerHTML = '<button data-quick="edit">编辑</button><button data-quick="duplicate">复制</button><button data-quick="back">下移</button><button data-quick="front">上移</button><button data-quick="lock">锁定</button><button data-quick="delete">删除</button>'
  document.body.append(bar, inspector, quick)
  return { bar, inspector, quick }
}

export default function monthlyWorkspacePlugin(editor: Editor) {
  let mode: WorkspaceMode = 'basic'
  let aiMarkMode = false
  const marked = new Set<Component>()
  let statusTimer: number | undefined

  editor.Commands.add(cmdToggleWorkspaceMode, () => {
    mode = mode === 'basic' ? 'advanced' : 'basic'
    document.body.classList.toggle('monthly-basic-mode', mode === 'basic')
    document.body.classList.toggle('monthly-advanced-mode', mode === 'advanced')
    window.setTimeout(() => editor.refresh(), 0)
  })
  editor.Commands.add(cmdSaveProject, async () => editor.store())
  editor.Commands.add(cmdUndo, () => editor.UndoManager.undo())
  editor.Commands.add(cmdRedo, () => editor.UndoManager.redo())
  editor.Commands.add(cmdCreateAiRequest, (_editor, _sender, options: { requirement?: string, ids?: string[] } = {}) => {
    const components = options.ids?.map(id => findByStableId(editor, id)).filter((component): component is Component => Boolean(component)) || [...marked]
    return buildAiRequest(editor, components, options.requirement || '')
  })
  editor.Commands.add(cmdApplyAiPatch, (_editor, _sender, options: { patch: AiPatch, allowedIds?: string[] }) => {
    const allowedIds = new Set(options.allowedIds || [...marked].map(stableObjectId))
    applyAiPatch(editor, options.patch, allowedIds)
  })

  editor.on('load', () => {
    document.body.classList.add('monthly-basic-mode')
    document.body.classList.remove('monthly-advanced-mode')
    assignBusinessNames(editor)
    const { bar, inspector, quick } = createWorkspaceUi(editor)
    const status = bar.querySelector('.monthly-save-status') as HTMLElement
    const modeButton = bar.querySelector('[data-action="mode"]') as HTMLButtonElement
    const updateModeButton = () => { modeButton.textContent = mode === 'basic' ? '高级模式' : '基础模式'; modeButton.classList.toggle('active', mode === 'advanced') }
    const setStatus = (text: string, state = '') => { status.textContent = text; status.className = `monthly-save-status ${state}`.trim() }
    const guarded = (action: () => void) => { try { action() } catch (error) { notify(editor, 'error', error instanceof Error ? error.message : String(error)) } }
    bar.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest('button') as HTMLButtonElement | null
      if (!button) return
      if (button.dataset.command) guarded(() => editor.runCommand(button.dataset.command!))
      if (button.dataset.action === 'mode') { editor.runCommand(cmdToggleWorkspaceMode); updateModeButton() }
      if (button.dataset.action === 'ai') {
        if (!aiMarkMode) {
          aiMarkMode = true
          document.body.classList.add('monthly-ai-mark-mode')
          notify(editor, 'success', 'AI 标记模式已开启：点击画布对象进行标记，再次点击“AI 标记”填写需求。')
        } else {
          openAiDialog(editor, marked, aiMarkMode, active => { aiMarkMode = active; document.body.classList.toggle('monthly-ai-mark-mode', active); updateAiHighlight(editor, marked, active) })
        }
      }
      if (button.dataset.action === 'export') guarded(() => editor.runCommand('publish'))
    })
    quick.addEventListener('click', event => {
      const action = (event.target as HTMLElement).closest('button')?.dataset.quick
      guarded(() => {
        if (action === 'edit') editSelected(editor)
        if (action === 'duplicate') duplicateSelected(editor)
        if (action === 'back') moveLayer(editor, -1)
        if (action === 'front') moveLayer(editor, 1)
        if (action === 'lock') editor.runCommand(cmdToggleLock)
        if (action === 'delete' && window.confirm('确定删除当前对象吗？')) editor.getSelected()?.remove()
      })
    })
    editor.on('component:selected', (component: Component) => {
      if (aiMarkMode) {
        const attributes = componentAttributes(component)
        if (!attributes['data-binding-id'] && !attributes['data-object-id']) {
          component.addAttributes({ 'data-object-id': component.getId(), 'data-binding-id': component.getId() })
        }
        marked.add(component)
        updateAiHighlight(editor, marked, true)
      }
      renderSelectionInspector(editor, inspector, quick)
    })
    editor.on('component:deselected page', () => renderSelectionInspector(editor, inspector, quick))
    editor.on('component:add', (component: Component) => component.set('name', businessName(component), { silent: true }))
    editor.on('update', () => {
      if (editor.getDirtyCount() <= 0) return
      window.clearTimeout(statusTimer)
      setStatus('有未保存修改', 'dirty')
      statusTimer = window.setTimeout(() => setStatus('等待自动保存…', 'dirty'), 1200)
    })
    editor.on('storage:start:store', () => setStatus('正在保存…', 'dirty'))
    editor.on('storage:end:store', () => setStatus(`已保存 ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`))
    editor.on('storage:error:store', () => setStatus('保存失败，请重试', 'error'))
    renderSelectionInspector(editor, inspector, quick)
    updateModeButton()
  })

  editor.on('ai-capabilities:ready', (addCapability: (capability: unknown) => void) => {
    addCapability({ id: cmdCreateAiRequest, command: cmdCreateAiRequest, description: 'Create a structured AI edit request for marked monthly-report objects', readOnly: true, tags: ['monthly-report', 'ai'] })
    addCapability({ id: cmdApplyAiPatch, command: cmdApplyAiPatch, description: 'Apply an AI patch only to explicitly allowed stable object IDs', tags: ['monthly-report', 'ai'] })
  })
}
