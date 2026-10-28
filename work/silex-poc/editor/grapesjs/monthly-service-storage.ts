import { Component, Editor, ProjectData } from 'grapesjs'
import { fetchWithConnectionError } from '~/editor/network-request'
import { createServiceSaver } from './service-save'

const parameters = new URL(location.href).searchParams
export const serviceProjectId = parameters.get('serviceProject')
const serviceBase = (parameters.get('serviceUrl') || 'http://127.0.0.1:4320').replace(/\/$/, '')
let baseline: any
let loadedData: any
let revision: number
let saving: Promise<void> | undefined

export async function serviceRequest(suffix: string, init?: RequestInit) {
  const response = await fetchWithConnectionError(`${serviceBase}/api/projects/${encodeURIComponent(serviceProjectId!)}${suffix ? '/' + suffix : ''}`, { credentials: 'include', ...init }, '月报服务')
  let value: any
  try { value = await response.json() } catch (cause) {
    console.error('月报服务数据接收失败', { suffix, status: response.status, cause })
    throw new Error(`月报数据接收中断或格式无效（${suffix || '保存响应'}，HTTP ${response.status}）。请保留当前页面，稍后重试。`, { cause })
  }
  if (!response.ok) throw new Error(value.error || `月报服务错误 ${response.status}`)
  return value
}

export async function loadServiceProject(editor: Editor): Promise<ProjectData> {
  const value = await serviceRequest('silex')
  return adoptServiceProject(editor, value)
}

function adoptServiceProject(editor: Editor, value: any): ProjectData {
  baseline = value.project
  editor.getModel().set('pptxImportReports', baseline.deck.notes?.pptx_imports || [])
  loadedData = value.editorData
  revision = value.revision
  editor.getModel().set('monthlyServiceRevision', revision)
  editor.StorageManager.setAutosave(false)
  return value.editorData
}

function canvasStateId(value: any): string | undefined {
  if (!value || typeof value !== 'object') return
  const attrs = value.attributes || {}
  if (attrs['data-report-page'] || attrs['data-pptx-page']) return attrs.id || value.id
  for (const child of Array.isArray(value.components) ? value.components : []) {
    const found = canvasStateId(child)
    if (found) return found
  }
}

function children(component: Component): Component[] { return component.components().models }
function findObject(component: Component, id: string): Component | undefined {
  if (component.getAttributes()['data-object-id'] === id) return component
  for (const child of children(component)) {
    const found = findObject(child, id)
    if (found) return found
  }
}
function slideComponent(root: Component): Component {
  const attrs = root.getAttributes()
  if (attrs['data-report-page'] || attrs['data-pptx-page']) return root
  for (const child of children(root)) {
    const found = slideComponent(child)
    if (found.getAttributes()['data-report-page'] || found.getAttributes()['data-pptx-page']) return found
  }
  return root
}
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[char]!))

export function captureServiceProject(editor: Editor, data: ProjectData) {
  if (!baseline) throw new Error('请先加载服务器项目。')
  const originals = new Map<string, any>(baseline.deck.pages.flatMap((page: any) => page.objects).map((object: any) => [object.attributes['data-object-id'], object]))
  const pages = editor.Pages.getAll().map(page => {
    const slide = slideComponent(page.getMainComponent())
    return { name: page.getName() || '新页面', width: Number.parseFloat(String(slide.getStyle().width)) || 1920, height: Number.parseFloat(String(slide.getStyle().height)) || 1080, background: slide.getStyle().background || '#ffffff', objects: children(slide).map(component => {
      const attrs = { ...component.getAttributes() }
      const id = String(attrs['data-object-id'] || component.getId())
      const original = originals.get(id)
      const el = component.getEl() as HTMLElement | undefined
      const source = { ...original?.style, ...component.getStyle() }
      const style = { ...source, position: 'absolute', left: source.left || `${el?.offsetLeft || 0}px`, top: source.top || `${el?.offsetTop || 0}px`, width: source.width || `${el?.offsetWidth || 320}px`, height: source.height || `${el?.offsetHeight || 100}px` }
      const image = component.get('type') === 'image' || component.get('tagName') === 'img'
      return { type: 'report-object', tagName: image ? 'div' : component.get('tagName') || 'div', classes: [...new Set(['object', ...component.getClasses()])], style,
        attributes: { ...attrs, 'data-object-id': id, 'data-binding-id': attrs['data-binding-id'] || id, 'data-name': component.get('name') || attrs['data-name'] || id, 'data-kind': (attrs['data-pptx-kind'] === 'table' ? 'table' : attrs['data-kind'] || attrs['data-pptx-kind']) || (image ? 'image' : component.get('type') === 'text' ? 'text' : 'container'), 'data-content-layer': attrs['data-content-layer'] || 'manual', 'data-refresh-policy': attrs['data-refresh-policy'] || 'preserve' },
        content: image ? `<img src="${escape(attrs.src)}" alt="${escape(attrs.alt)}" style="width:100%;height:100%;object-fit:${escape(source['object-fit'] || 'contain')}">` : component.getInnerHTML(),
      }
    }) }
  })
  return { ...baseline, current: Math.max(0, editor.Pages.getAll().indexOf(editor.Pages.getSelected()!)), deck: { ...baseline.deck, notes: { ...baseline.deck.notes, ...(editor.getModel().get('pptxImportReports') ? { pptx_imports: editor.getModel().get('pptxImportReports') } : {}) }, pages, css: editor.getCss({ keepUnusedStyles: true }) || '' }, silexState: data }
}

export async function storeServiceProject(editor: Editor, data: ProjectData) {
  if (saving) { await saving; return storeServiceProject(editor, data) }
  const project = captureServiceProject(editor, data)
  saving = (async () => {
    const result = await serviceRequest('', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseRevision: revision, author: 'silex-operator', project }) })
    baseline = project
    revision = result.revision
    editor.getModel().set('monthlyServiceRevision', revision)
  })()
  try { await saving } finally { saving = undefined }
}

export async function submitMarkedRequest(editor: Editor, marked: Component[], requirement: string) {
  if (!marked.length) throw new Error('请先标记对象。')
  if (!requirement.trim()) throw new Error('请填写修改需求。')
  await editor.store()
  const ids = marked.map(component => {
    let root = component
    while (root.parent() && !root.parent()!.getAttributes()['data-report-page'] && !root.parent()!.getAttributes()['data-pptx-page']) root = root.parent()!
    return String(root.getAttributes()['data-object-id'] || root.getId())
  })
  return serviceRequest('ai-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseRevision: revision, objectIds: ids, requirement }) })
}

export async function openServiceExport(editor: Editor) {
  await editor.store()
  editor.Modal.open({ title: '导出月报', content: `<p>当前服务器版本 v${revision}</p><p><a href="${escape(serviceBase)}/api/projects/${escape(serviceProjectId)}/export.html" target="_blank">下载演示 HTML</a></p><p><a href="${escape(serviceBase)}/api/projects/${escape(serviceProjectId)}/export.json" target="_blank">下载可编辑项目</a></p>` })
}

export function attachServiceSync(editor: Editor) {
  if (!serviceProjectId) return
  const sessionId = crypto.randomUUID()
  let publishing = false
  let syncing = false
  let ready = false
  let failed = false
  let autoSave: ReturnType<typeof setTimeout> | undefined
  let remoteReload: { interacted: boolean, timer?: ReturnType<typeof setTimeout> } | undefined
  const markInteraction = () => { if (remoteReload) remoteReload.interacted = true }
  document.addEventListener('pointerdown', markInteraction, true)
  document.addEventListener('keydown', markInteraction, true)
  document.addEventListener('beforeinput', markInteraction, true)
  let canvasDocument: Document | undefined
  const attachCanvasInteraction = () => {
    const next = editor.Canvas.getDocument()
    if (canvasDocument === next) return
    for (const name of ['pointerdown','keydown','beforeinput']) canvasDocument?.removeEventListener(name, markInteraction, true)
    canvasDocument = next || undefined
    for (const name of ['pointerdown','keydown','beforeinput']) canvasDocument?.addEventListener(name, markInteraction, true)
  }
  editor.on('canvas:frame:load', attachCanvasInteraction)
  // The generic rate limiter resolves queued saves before they are persisted.
  // Service saves need durable completion for export, AI handoff and 409 guards.
  editor.store = createServiceSaver(editor, async data => {
    failed = true // Keep the guard active even if a later storage layer clears dirty count.
    updateSaveLabel('正在保存…')
    await storeServiceProject(editor, data)
    failed = false
    updateSaveLabel(`已保存 v${revision}`)
  })
  const updateSaveLabel = (label: string) => {
    editor.Panels.getButton('options', 'monthly-service-save')?.set('label', label)
  }
  const saveNow = () => { clearTimeout(autoSave); return editor.store() }
  const scheduleSave = () => {
    if (!ready || syncing) return
    if (remoteReload && !remoteReload.interacted) return
    clearTimeout(autoSave)
    updateSaveLabel('有未保存修改')
    autoSave = setTimeout(() => { void saveNow().catch(() => {}) }, 800)
  }
  const beginReloadGuard = () => {
    if (remoteReload?.timer) clearTimeout(remoteReload.timer)
    const pending = { interacted: false, timer: undefined as ReturnType<typeof setTimeout> | undefined }
    remoteReload = pending
    pending.timer = setTimeout(() => {
      if (remoteReload !== pending) return
      if (!pending.interacted) {
        clearTimeout(autoSave)
        editor.clearDirtyCount()
        updateSaveLabel(`已保存 v${revision}`)
      }
      remoteReload = undefined
    }, 750)
  }
  editor.Commands.add('monthly-service:save', () => saveNow().catch(() => {}))
  editor.Commands.add('monthly-service:home', async () => {
    const goHome = () => window.location.assign(serviceBase + '/#projects')
    const wasEditing = Boolean(editor.getEditing())
    editor.getProjectData()
    await new Promise(resolve => setTimeout(resolve, 0))
    if (!wasEditing && !failed && !saving && editor.getDirtyCount() === 0) { goHome(); return }
    const content = document.createElement('div')
    const text = document.createElement('p')
    text.textContent = '当前月报有未保存的修改。保存成功后返回工作台。'
    const button = document.createElement('button')
    button.textContent = '保存并返回工作台'
    button.style.cssText = 'padding:9px 14px;margin:12px 0;cursor:pointer'
    button.onclick = async () => {
      button.disabled = true
      try { await saveNow(); if (editor.getDirtyCount() > 0) { text.textContent = '保存期间又有新修改，请停止编辑后再次保存。'; return } goHome() }
      catch { text.textContent = '保存未完成，已保留画布内容。请解决保存问题后重试。' }
      finally { button.disabled = false }
    }
    content.append(text, button)
    editor.Modal.open({ title: '返回月报工作台', content })
  })
  editor.Keymaps.add('monthly-service:save', 'ctrl+s, ⌘+s', () => editor.runCommand('monthly-service:save'), { prevent: true })
  editor.on('load', () => {
    attachCanvasInteraction()
    editor.Panels.addButton('options', { id: 'monthly-service-home', command: 'monthly-service:home', togglable: false, label: '← 工作台', attributes: { title: '返回月报工作台', 'aria-label': '返回月报工作台' } })
    editor.Panels.addButton('options', { id: 'monthly-service-save', command: 'monthly-service:save', togglable: false, label: `保存 v${revision}`, attributes: { title: '保存月报 (Ctrl+S)', 'aria-label': '保存月报' } })
  })
  editor.on('storage:error:store', () => { failed = true; updateSaveLabel('保存失败，点击重试') })
  editor.on('update', scheduleSave)
  const warnBeforeUnload = (event: BeforeUnloadEvent) => {
    if (failed || saving || editor.getDirtyCount() > 0) { event.preventDefault(); event.returnValue = '' }
  }
  window.addEventListener('beforeunload', warnBeforeUnload)
  let publishingContext: ReturnType<typeof setTimeout> | undefined
  const publishContext = async () => {
    if (!revision || publishing) return
    publishing = true
    const objectIds = editor.getSelectedAll().map(component => {
      let root = component
      while (root.parent() && !root.parent()!.getAttributes()['data-report-page'] && !root.parent()!.getAttributes()['data-pptx-page']) root = root.parent()!
      return String(root.getAttributes()['data-object-id'] || root.getId())
    })
    try {
      await serviceRequest('editor-context', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, pageIndex: Math.max(0, editor.Pages.getAll().indexOf(editor.Pages.getSelected()!)), objectIds, dirty: !syncing && (failed || editor.getDirtyCount() > 0), saving: Boolean(saving) || syncing, focused: document.visibilityState === 'visible' && document.hasFocus() }) })
    } catch (error) { console.warn('聊天编辑上下文同步失败', error) } finally { publishing = false }
  }
  const scheduleContext = () => {
    clearTimeout(publishingContext)
    publishingContext = setTimeout(() => { void publishContext() }, 150)
  }
  editor.on('component:selected component:deselected page:select update storage:end', scheduleContext)
  window.addEventListener('focus', scheduleContext)
  document.addEventListener('visibilitychange', scheduleContext)
  editor.on('project:load', () => {
    ready = false
    clearTimeout(autoSave)
    // Both the adapter and saved native state already carry stylesheet rules.
    // Adding deck.css again duplicates @font-face data on every load/save cycle.
    if (baseline?.deck.css && !loadedData?.styles?.length) editor.CssComposer.addRules(baseline.deck.css)
    for (const page of baseline?.deck.pages || []) for (const object of page.objects) {
      const id = object.attributes['data-object-id']
      if (id) editor.CssComposer.setRule('#'+CSS.escape(id), object.style, { addStyles: true })
    }
    for (const [index,page] of (baseline?.deck.pages || []).entries()) {
      const state = loadedData?.pages?.[index]
      const id = canvasStateId(state?.frames?.[0]?.component || state?.component) || `monthly-slide-${String(index+1).padStart(2,'0')}-canvas`
      editor.CssComposer.setRule('#'+CSS.escape(id), { background: page.background || '#ffffff', width: `${page.width || 1920}px`, height: `${page.height || 1080}px` }, { addStyles: true })
    }
    editor.getModel().set('changesCount', 0)
    editor.StorageManager.setAutosave(false)
    ready = true
    beginReloadGuard()
    scheduleContext()
  })
  let noticed: number | undefined
  editor.AssetManager.getConfig().uploadFile = async event => {
    const files = (event as DragEvent).dataTransfer?.files || (event.target as HTMLInputElement)?.files
    for (const file of Array.from(files || [])) {
      if (!file.type.startsWith('image/')) continue
      const src = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file) })
      editor.AssetManager.add({ src, name: file.name })
    }
    editor.trigger('asset:upload:end', {})
  }
  const timer = setInterval(async () => {
    if (!revision || saving) return
    try {
      const state = await serviceRequest('status')
      if (state.revision === revision) return
      if (failed || editor.getDirtyCount() > 0) {
        if (noticed !== state.revision) editor.runCommand('notifications:add', { type: 'warning', group: '月报服务', message: 'AI 更新了服务器项目。请先保存本地修改；版本冲突会保留副本。' })
        noticed = state.revision
      } else {
        const pageIndex = editor.Pages.getAll().indexOf(editor.Pages.getSelected()!)
        const selectedIds = editor.getSelectedAll().map(component => {
          let root = component
          while (root.parent() && !root.parent()!.getAttributes()['data-report-page'] && !root.parent()!.getAttributes()['data-pptx-page']) root = root.parent()!
          return root.getAttributes()['data-object-id'] as string | undefined
        }).filter((id): id is string => Boolean(id))
        syncing = true
        try {
          const startingRevision = revision
          const fresh = await serviceRequest('silex')
          // A user can start typing while the project is being downloaded.
          if (failed || saving || revision !== startingRevision || editor.getDirtyCount() > 0) return
          editor.loadProjectData(adoptServiceProject(editor, fresh))
          const page = editor.Pages.getAll()[Math.max(0, pageIndex)]
          if (page) editor.Pages.select(page)
          if (page && selectedIds.length) {
            const restored = selectedIds.map(id => findObject(page.getMainComponent(), id)).filter((component): component is Component => Boolean(component))
            if (restored[0]) {
              editor.select(restored[0])
              for (const component of restored.slice(1)) editor.selectAdd(component)
            }
          }
          editor.getModel().set('changesCount', 0)
          beginReloadGuard()
        } finally { syncing = false; scheduleContext() }
      }
    } catch (error) { console.warn('月报同步检查失败', error) }
  }, 5000)
  const contextTimer = setInterval(() => { void publishContext() }, 3000)
  editor.on('destroy', () => {
    clearInterval(timer)
    clearInterval(contextTimer)
    clearTimeout(publishingContext)
    clearTimeout(autoSave)
    if (remoteReload?.timer) clearTimeout(remoteReload.timer)
    document.removeEventListener('pointerdown', markInteraction, true)
    document.removeEventListener('keydown', markInteraction, true)
    document.removeEventListener('beforeinput', markInteraction, true)
    for (const name of ['pointerdown','keydown','beforeinput']) canvasDocument?.removeEventListener(name, markInteraction, true)
    window.removeEventListener('beforeunload', warnBeforeUnload)
    window.removeEventListener('focus', scheduleContext)
    document.removeEventListener('visibilitychange', scheduleContext)
    void serviceRequest('editor-context', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, closed: true }) }).catch(() => {})
  })
}
