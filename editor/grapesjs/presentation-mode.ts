/* Presentation-oriented controls for fixed-layout reports. */
import { Component, Editor } from 'grapesjs'

export const cmdToggleFreePosition = 'presentation:toggle-free-position'
export const cmdToggleGridSnap = 'presentation:toggle-grid-snap'
export const cmdGroup = 'presentation:group'
export const cmdUngroup = 'presentation:ungroup'
export const cmdToggleKeyboardNudge = 'presentation:toggle-keyboard-nudge'
export const cmdToggleLock = 'presentation:toggle-lock'
export const cmdOpenGeometry = 'presentation:open-geometry'
export const cmdZoomOut = 'presentation:zoom-out'
export const cmdZoomIn = 'presentation:zoom-in'
export const cmdZoomFit = 'presentation:zoom-fit'
export const cmdToggleSmartGuides = 'presentation:toggle-smart-guides'
export const cmdOpenTableTools = 'presentation:open-table-tools'

type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
type DistributeMode = 'horizontal' | 'vertical'

const GRID_SIZE = 8
const GRID_STYLE_ID = 'silex-presentation-grid'
const LOCK_ATTRIBUTE = 'data-silex-locked'
const GUIDE_TOLERANCE = 6
const GUIDE_CLASS = 'silex-presentation-guide'

function isLocked(component: Component): boolean {
  return component.getAttributes()[LOCK_ATTRIBUTE] === 'true'
}

function roundPx(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.endsWith('px')) return undefined
  const numeric = Number.parseFloat(value)
  if (!Number.isFinite(numeric)) return undefined
  return `${Math.round(numeric / GRID_SIZE) * GRID_SIZE}px`
}

function setGridOverlay(editor: Editor, visible: boolean) {
  const doc = editor.Canvas.getDocument()
  if (!doc) return
  let style = doc.getElementById(GRID_STYLE_ID) as HTMLStyleElement | null
  if (!style) {
    style = doc.createElement('style')
    style.id = GRID_STYLE_ID
    style.textContent = `
      body.silex-presentation-grid {
        background-image:
          linear-gradient(to right, rgba(30, 105, 175, .10) 1px, transparent 1px),
          linear-gradient(to bottom, rgba(30, 105, 175, .10) 1px, transparent 1px);
        background-size: ${GRID_SIZE}px ${GRID_SIZE}px;
      }
    `
    doc.head.append(style)
  }
  doc.body.classList.toggle('silex-presentation-grid', visible)
}

function snapComponent(component?: Component) {
  if (!component) return
  const style = component.getStyle()
  const left = roundPx(style.left)
  const top = roundPx(style.top)
  const width = roundPx(style.width)
  const height = roundPx(style.height)
  component.setStyle({
    ...style,
    ...(left ? { left } : {}),
    ...(top ? { top } : {}),
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
  })
}

function selectedComponents(editor: Editor, minimum = 2): Component[] {
  const selected = editor.getSelectedAll()
  if (selected.length < minimum) {
    throw new Error(`请至少选择 ${minimum} 个对象。按住 Shift 点击可多选。`)
  }
  if (selected.some(isLocked)) {
    throw new Error('所选对象中包含已锁定对象，请先解锁。')
  }
  return selected
}

function toggleLock(editor: Editor) {
  const selected = editor.getSelectedAll()
  if (!selected.length) throw new Error('请先选择需要锁定或解锁的对象。')
  const lock = !selected.every(isLocked)
  selected.forEach(component => {
    if (lock) {
      component.addAttributes({ [LOCK_ATTRIBUTE]: 'true' })
      component.set({ draggable: false, editable: false, removable: false, resizable: false })
    } else {
      component.removeAttributes(LOCK_ATTRIBUTE)
      component.unset('draggable')
      component.unset('editable')
      component.unset('removable')
      component.unset('resizable')
    }
  })
  updateLockButton(editor)
}

function updateLockButton(editor: Editor) {
  const selected = editor.getSelectedAll()
  editor.Panels.getButton('options', 'presentation-lock')?.set('active', selected.length > 0 && selected.every(isLocked))
}

function numericStyle(component: Component, property: 'left' | 'top' | 'width' | 'height'): number {
  const value = Number.parseFloat(String(component.getStyle()[property]))
  if (Number.isFinite(value)) return value
  const element = component.getEl() as HTMLElement | undefined
  if (!element) return 0
  if (property === 'left') return element.offsetLeft
  if (property === 'top') return element.offsetTop
  if (property === 'width') return element.offsetWidth
  return element.offsetHeight
}

function openGeometry(editor: Editor) {
  const component = editor.getSelected()
  if (!component) throw new Error('请先选择一个对象。')
  if (isLocked(component)) throw new Error('对象已锁定，请先解锁。')

  const form = document.createElement('form')
  form.className = 'silex-presentation-geometry'
  form.innerHTML = `
    <style>
      .silex-presentation-geometry { min-width: 360px; color: #ddd; }
      .silex-presentation-geometry__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
      .silex-presentation-geometry label { display: grid; gap: 6px; font-size: 13px; }
      .silex-presentation-geometry input[type="number"] { width: 100%; padding: 8px; color: #eee; background: #282828; border: 1px solid #555; border-radius: 3px; }
      .silex-presentation-geometry__ratio { display: flex !important; grid-column: 1 / -1; align-items: center; grid-template-columns: auto 1fr; margin-top: 4px; }
      .silex-presentation-geometry__actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
      .silex-presentation-geometry button { padding: 8px 18px; border: 0; border-radius: 3px; cursor: pointer; }
      .silex-presentation-geometry__apply { color: white; background: #3b97e3; }
    </style>
    <div class="silex-presentation-geometry__grid">
      <label>X 坐标（px）<input name="left" type="number" step="1"></label>
      <label>Y 坐标（px）<input name="top" type="number" step="1"></label>
      <label>宽度（px）<input name="width" type="number" min="1" step="1"></label>
      <label>高度（px）<input name="height" type="number" min="1" step="1"></label>
      <label class="silex-presentation-geometry__ratio"><input name="ratio" type="checkbox">保持宽高比</label>
    </div>
    <div class="silex-presentation-geometry__actions">
      <button type="button" data-action="cancel">取消</button>
      <button class="silex-presentation-geometry__apply" type="submit">应用</button>
    </div>
  `
  const fields = Object.fromEntries(['left', 'top', 'width', 'height', 'ratio'].map(name => [name, form.elements.namedItem(name) as HTMLInputElement]))
  fields.left.value = String(Math.round(numericStyle(component, 'left')))
  fields.top.value = String(Math.round(numericStyle(component, 'top')))
  fields.width.value = String(Math.round(numericStyle(component, 'width')))
  fields.height.value = String(Math.round(numericStyle(component, 'height')))
  let ratio = Number(fields.width.value) / Math.max(1, Number(fields.height.value))
  fields.width.addEventListener('input', () => {
    if (fields.ratio.checked) fields.height.value = String(Math.max(1, Math.round(Number(fields.width.value) / ratio)))
  })
  fields.height.addEventListener('input', () => {
    if (fields.ratio.checked) fields.width.value = String(Math.max(1, Math.round(Number(fields.height.value) * ratio)))
  })
  fields.ratio.addEventListener('change', () => {
    ratio = Number(fields.width.value) / Math.max(1, Number(fields.height.value))
  })
  form.querySelector('[data-action="cancel"]')?.addEventListener('click', () => editor.Modal.close())
  form.addEventListener('submit', event => {
    event.preventDefault()
    component.setStyle({
      ...component.getStyle(),
      position: 'absolute',
      left: `${Number(fields.left.value)}px`,
      top: `${Number(fields.top.value)}px`,
      width: `${Math.max(1, Number(fields.width.value))}px`,
      height: `${Math.max(1, Number(fields.height.value))}px`,
    })
    editor.Modal.close()
    editor.select(component)
  })
  const container = document.createElement('div')
  container.append(form)
  editor.Modal.setTitle('位置与尺寸')
  editor.Modal.setContent(container)
  editor.Modal.open()
}

function closestTag(component: Component | undefined, tagName: string): Component | undefined {
  let current = component
  while (current) {
    if (String(current.get('tagName')).toLowerCase() === tagName) return current
    current = current.parent()
  }
  return undefined
}

function openTableTools(editor: Editor) {
  const table = closestTag(editor.getSelected(), 'table')
  if (!table) throw new Error('请选择表格或表格中的单元格。')
  const selectedRow = closestTag(editor.getSelected(), 'tr')
  const selectedCell = closestTag(editor.getSelected(), 'td') || closestTag(editor.getSelected(), 'th')
  const rows = () => table.find('tr')
  const panel = document.createElement('div')
  panel.className = 'silex-presentation-table-tools'
  panel.innerHTML = `
    <style>
      .silex-presentation-table-tools { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; min-width: 360px; }
      .silex-presentation-table-tools button { padding: 12px; color: #eee; background: #333; border: 1px solid #555; border-radius: 4px; cursor: pointer; }
      .silex-presentation-table-tools button:hover { background: #3b97e3; }
    </style>
    <button data-action="add-row">在下方添加行</button>
    <button data-action="remove-row">删除当前行</button>
    <button data-action="add-column">在右侧添加列</button>
    <button data-action="remove-column">删除当前列</button>
  `
  const close = () => {
    editor.Modal.close()
    editor.select(table)
  }
  panel.addEventListener('click', event => {
    const action = (event.target as HTMLElement).closest('button')?.dataset.action
    if (!action) return
    if (action === 'add-row') {
      const source = selectedRow || rows().at(-1)
      const clone = source?.clone()
      if (clone && source?.parent()) source.parent()!.components().add(clone, { at: source.index() + 1 })
    } else if (action === 'remove-row') {
      const row = selectedRow || rows().at(-1)
      if (rows().length <= 2) {
        editor.runCommand('notifications:add', { type: 'error', group: '表格工具', message: '表格至少保留标题行和一行数据。' })
        return
      }
      row?.remove()
    } else {
      const firstRow = rows().at(0)
      const columnIndex = selectedCell?.index() ?? Math.max(0, (firstRow?.components().length ?? 1) - 1)
      rows().forEach((row, rowIndex) => {
        if (action === 'add-column') {
          row.components().add({ tagName: rowIndex === 0 ? 'th' : 'td', type: 'cell', components: rowIndex === 0 ? '新字段' : '—' }, { at: columnIndex + 1 })
        } else if (row.components().length > 1) {
          row.components().at(Math.min(columnIndex, row.components().length - 1))?.remove()
        }
      })
    }
    close()
  })
  const container = document.createElement('div')
  container.append(panel)
  editor.Modal.setTitle('表格工具')
  editor.Modal.setContent(container)
  editor.Modal.open()
}

function showGuide(editor: Editor, axis: 'x' | 'y', position: number) {
  const doc = editor.Canvas.getDocument()
  if (!doc) return
  doc.querySelectorAll(`.${GUIDE_CLASS}`).forEach(element => element.remove())
  const guide = doc.createElement('div')
  guide.className = GUIDE_CLASS
  Object.assign(guide.style, axis === 'x'
    ? { position: 'fixed', left: `${position}px`, top: '0', bottom: '0', width: '1px' }
    : { position: 'fixed', top: `${position}px`, left: '0', right: '0', height: '1px' }, {
    zIndex: '2147483647',
    background: '#ff3b8d',
    pointerEvents: 'none',
  })
  doc.body.append(guide)
  window.setTimeout(() => guide.remove(), 700)
}

function snapToSmartGuides(editor: Editor, component?: Component) {
  if (!component || isLocked(component)) return
  const parent = component.parent()
  if (!parent) return
  const rect = componentRect(component)
  const siblings = parent.components().models.filter(item => item !== component && item.getEl())
  if (!siblings.length) return
  const zoom = editor.Canvas.getZoom() / 100 || 1
  const tolerance = GUIDE_TOLERANCE * zoom
  const sourceX = [rect.left, rect.left + rect.width / 2, rect.right]
  const sourceY = [rect.top, rect.top + rect.height / 2, rect.bottom]
  const targetX = siblings.flatMap(item => {
    const itemRect = componentRect(item)
    return [itemRect.left, itemRect.left + itemRect.width / 2, itemRect.right]
  })
  const targetY = siblings.flatMap(item => {
    const itemRect = componentRect(item)
    return [itemRect.top, itemRect.top + itemRect.height / 2, itemRect.bottom]
  })
  const nearest = (sources: number[], targets: number[]) => sources
    .flatMap(source => targets.map(target => ({ delta: target - source, target })))
    .filter(match => Math.abs(match.delta) <= tolerance)
    .sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))[0]
  const matchX = nearest(sourceX, targetX)
  const matchY = nearest(sourceY, targetY)
  if (matchX || matchY) moveBy(component, (matchX?.delta ?? 0) / zoom, (matchY?.delta ?? 0) / zoom)
  if (matchX) showGuide(editor, 'x', matchX.target)
  if (matchY) showGuide(editor, 'y', matchY.target)
}

function runPresentationAction(editor: Editor, action: () => void) {
  try {
    action()
  } catch (error) {
    editor.runCommand('notifications:add', {
      type: 'error',
      group: '演示排版工具',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

function commonParent(components: Component[]): Component {
  const parent = components[0].parent()
  if (!parent || components.some(component => component.parent() !== parent)) {
    throw new Error('只能操作同一父容器中的对象。')
  }
  return parent
}

function componentRect(component: Component): DOMRect {
  const element = component.getEl()
  if (!element) throw new Error('对象尚未渲染，无法计算位置。')
  return element.getBoundingClientRect()
}

function parentRect(component: Component): DOMRect {
  const parent = component.parent()
  const element = parent?.getEl()
  if (!element) throw new Error('父容器尚未渲染，无法计算位置。')
  return element.getBoundingClientRect()
}

function moveBy(component: Component, deltaX: number, deltaY: number) {
  const rect = componentRect(component)
  const containerRect = parentRect(component)
  const style = component.getStyle()
  const currentLeft = Number.parseFloat(String(style.left))
  const currentTop = Number.parseFloat(String(style.top))
  const left = Number.isFinite(currentLeft) ? currentLeft : rect.left - containerRect.left
  const top = Number.isFinite(currentTop) ? currentTop : rect.top - containerRect.top
  component.setStyle({
    ...style,
    position: 'absolute',
    left: `${left + deltaX}px`,
    top: `${top + deltaY}px`,
  })
}

function align(editor: Editor, mode: AlignMode) {
  const components = selectedComponents(editor)
  commonParent(components)
  const rects = components.map(componentRect)
  const left = Math.min(...rects.map(rect => rect.left))
  const right = Math.max(...rects.map(rect => rect.right))
  const top = Math.min(...rects.map(rect => rect.top))
  const bottom = Math.max(...rects.map(rect => rect.bottom))
  const center = (left + right) / 2
  const middle = (top + bottom) / 2

  components.forEach((component, index) => {
    const rect = rects[index]
    const deltaX = mode === 'left' ? left - rect.left
      : mode === 'center' ? center - (rect.left + rect.width / 2)
        : mode === 'right' ? right - rect.right
          : 0
    const deltaY = mode === 'top' ? top - rect.top
      : mode === 'middle' ? middle - (rect.top + rect.height / 2)
        : mode === 'bottom' ? bottom - rect.bottom
          : 0
    moveBy(component, deltaX, deltaY)
  })
}

function distribute(editor: Editor, mode: DistributeMode) {
  const components = selectedComponents(editor, 3)
  commonParent(components)
  const items = components
    .map(component => ({ component, rect: componentRect(component) }))
    .sort((a, b) => mode === 'horizontal' ? a.rect.left - b.rect.left : a.rect.top - b.rect.top)
  const first = items[0].rect
  const last = items[items.length - 1].rect
  const occupied = items.reduce((sum, item) => sum + (mode === 'horizontal' ? item.rect.width : item.rect.height), 0)
  const span = mode === 'horizontal' ? last.right - first.left : last.bottom - first.top
  const gap = (span - occupied) / (items.length - 1)
  let cursor = mode === 'horizontal' ? first.left : first.top

  items.forEach((item, index) => {
    if (index > 0 && index < items.length - 1) {
      const current = mode === 'horizontal' ? item.rect.left : item.rect.top
      moveBy(item.component, mode === 'horizontal' ? cursor - current : 0, mode === 'vertical' ? cursor - current : 0)
    }
    cursor += (mode === 'horizontal' ? item.rect.width : item.rect.height) + gap
  })
}

function group(editor: Editor) {
  const components = selectedComponents(editor)
  const parent = commonParent(components)
  const rects = components.map(componentRect)
  const containerRect = parentRect(components[0])
  const left = Math.min(...rects.map(rect => rect.left))
  const right = Math.max(...rects.map(rect => rect.right))
  const top = Math.min(...rects.map(rect => rect.top))
  const bottom = Math.max(...rects.map(rect => rect.bottom))
  const insertAt = Math.min(...components.map(component => component.index()))
  const grouped = parent.components().add({
    tagName: 'div',
    name: '组合',
    attributes: { 'data-silex-group': 'true' },
    style: {
      position: 'absolute',
      left: `${left - containerRect.left}px`,
      top: `${top - containerRect.top}px`,
      width: `${right - left}px`,
      height: `${bottom - top}px`,
    },
  }, { at: insertAt }) as Component

  components.forEach((component, index) => {
    const rect = rects[index]
    component.setStyle({
      ...component.getStyle(),
      position: 'absolute',
      left: `${rect.left - left}px`,
      top: `${rect.top - top}px`,
    })
    grouped.append(component)
  })
  editor.select(grouped)
}

function ungroup(editor: Editor) {
  const selected = editor.getSelected()
  if (!selected || selected.getAttributes()['data-silex-group'] !== 'true') {
    throw new Error('请选择一个由“组合”命令创建的组合对象。')
  }
  const parent = selected.parent()
  if (!parent) return
  const containerRect = parentRect(selected)
  const insertAt = selected.index()
  const children = [...selected.components().models]
  children.forEach((child, index) => {
    const rect = componentRect(child)
    child.setStyle({
      ...child.getStyle(),
      position: 'absolute',
      left: `${rect.left - containerRect.left}px`,
      top: `${rect.top - containerRect.top}px`,
    })
    parent.append(child, { at: insertAt + index })
  })
  selected.remove()
  editor.select(children[0])
  children.slice(1).forEach(component => editor.selectAdd(component))
}

export default function presentationMode(editor: Editor) {
  let gridSnap = false
  let smartGuides = false
  const nudgeKeymaps = [
    ['presentation:nudge-left', 'left', -1, 0],
    ['presentation:nudge-right', 'right', 1, 0],
    ['presentation:nudge-up', 'up', 0, -1],
    ['presentation:nudge-down', 'down', 0, 1],
    ['presentation:nudge-left-large', 'shift+left', -10, 0],
    ['presentation:nudge-right-large', 'shift+right', 10, 0],
    ['presentation:nudge-up-large', 'shift+up', 0, -10],
    ['presentation:nudge-down-large', 'shift+down', 0, 10],
  ] as const
  const nudgeSelected = (deltaX: number, deltaY: number) => {
    if (editor.getEditing()) return
    const selected = editor.getSelectedAll()
    if (!selected.length || selected.some(isLocked)) return
    selected.forEach(component => moveBy(component, deltaX, deltaY))
  }

  editor.Commands.add(cmdToggleFreePosition, {
    run() {
      editor.setDragMode('absolute')
      setGridOverlay(editor, gridSnap)
    },
    stop() {
      editor.setDragMode('')
      setGridOverlay(editor, false)
    },
  })

  editor.Commands.add(cmdToggleGridSnap, {
    run() {
      gridSnap = true
      setGridOverlay(editor, editor.getDragMode() === 'absolute')
    },
    stop() {
      gridSnap = false
      setGridOverlay(editor, false)
    },
  })

  editor.Commands.add(cmdToggleKeyboardNudge, {
    run() {
      nudgeKeymaps.forEach(([id, keys, deltaX, deltaY]) => {
        editor.Keymaps.add(id, keys, () => nudgeSelected(deltaX, deltaY), { prevent: true })
      })
    },
    stop() {
      nudgeKeymaps.forEach(([id]) => editor.Keymaps.remove(id))
    },
  })

  editor.Commands.add(cmdGroup, () => runPresentationAction(editor, () => group(editor)))
  editor.Commands.add(cmdUngroup, () => runPresentationAction(editor, () => ungroup(editor)))
  editor.Commands.add(cmdToggleLock, () => runPresentationAction(editor, () => toggleLock(editor)))
  editor.Commands.add(cmdOpenGeometry, () => runPresentationAction(editor, () => openGeometry(editor)))
  editor.Commands.add(cmdOpenTableTools, () => runPresentationAction(editor, () => openTableTools(editor)))
  editor.Commands.add(cmdToggleSmartGuides, {
    run() { smartGuides = true },
    stop() { smartGuides = false },
  })
  editor.Commands.add(cmdZoomOut, () => editor.Canvas.setZoom(Math.max(25, editor.Canvas.getZoom() - 10)))
  editor.Commands.add(cmdZoomIn, () => editor.Canvas.setZoom(Math.min(200, editor.Canvas.getZoom() + 10)))
  editor.Commands.add(cmdZoomFit, () => editor.Canvas.fitViewport({ padding: 32 }))
  ;(['left', 'center', 'right', 'top', 'middle', 'bottom'] as AlignMode[]).forEach(mode => {
    editor.Commands.add(`presentation:align-${mode}`, () => runPresentationAction(editor, () => align(editor, mode)))
  })
  ;(['horizontal', 'vertical'] as DistributeMode[]).forEach(mode => {
    editor.Commands.add(`presentation:distribute-${mode}`, () => runPresentationAction(editor, () => distribute(editor, mode)))
  })

  editor.Panels.addButton('options', [{
    id: 'presentation-free-position',
    className: 'fa-solid fa-up-down-left-right',
    command: cmdToggleFreePosition,
    attributes: {
      title: '自由定位：像 PPT 一样拖动对象',
      'aria-label': '切换自由定位',
    },
  }, {
    id: 'presentation-grid-snap',
    className: 'fa-solid fa-border-all',
    command: cmdToggleGridSnap,
    attributes: {
      title: `网格吸附（${GRID_SIZE}px）`,
      'aria-label': '切换网格吸附',
    },
  }, {
    id: 'presentation-smart-guides',
    className: 'fa-solid fa-crosshairs',
    command: cmdToggleSmartGuides,
    attributes: { title: '对象边缘与中心参考线吸附', 'aria-label': '切换参考线吸附' },
  }, {
    id: 'presentation-keyboard-nudge',
    className: 'fa-solid fa-keyboard',
    command: cmdToggleKeyboardNudge,
    attributes: {
      title: '键盘微调：方向键 1px，Shift + 方向键 10px',
      'aria-label': '切换键盘微调',
    },
  }, {
    id: 'presentation-lock',
    className: 'fa-solid fa-lock',
    command: cmdToggleLock,
    togglable: false,
    attributes: { title: '锁定或解锁所选对象', 'aria-label': '锁定或解锁所选对象' },
  }, {
    id: 'presentation-geometry',
    className: 'fa-solid fa-ruler-combined',
    command: cmdOpenGeometry,
    togglable: false,
    attributes: { title: '输入对象坐标与尺寸', 'aria-label': '位置与尺寸' },
  }, {
    id: 'presentation-table-tools',
    className: 'fa-solid fa-table-cells',
    command: cmdOpenTableTools,
    togglable: false,
    attributes: { title: '添加或删除表格行列', 'aria-label': '表格工具' },
  }, {
    id: 'presentation-zoom-out',
    className: 'fa-solid fa-magnifying-glass-minus',
    command: cmdZoomOut,
    togglable: false,
    attributes: { title: '画布缩小 10%', 'aria-label': '缩小画布' },
  }, {
    id: 'presentation-zoom-fit',
    className: 'fa-solid fa-expand',
    command: cmdZoomFit,
    togglable: false,
    attributes: { title: '画布适应并居中', 'aria-label': '适应画布' },
  }, {
    id: 'presentation-zoom-in',
    className: 'fa-solid fa-magnifying-glass-plus',
    command: cmdZoomIn,
    togglable: false,
    attributes: { title: '画布放大 10%', 'aria-label': '放大画布' },
  }, {
    id: 'presentation-group',
    className: 'fa-solid fa-object-group',
    command: cmdGroup,
    attributes: { title: '组合所选对象', 'aria-label': '组合所选对象' },
  }, {
    id: 'presentation-ungroup',
    className: 'fa-solid fa-object-ungroup',
    command: cmdUngroup,
    attributes: { title: '取消组合', 'aria-label': '取消组合' },
  }, {
    id: 'presentation-align-left',
    className: 'fa-solid fa-align-left',
    command: 'presentation:align-left',
    attributes: { title: '左对齐', 'aria-label': '左对齐' },
  }, {
    id: 'presentation-align-center',
    className: 'fa-solid fa-align-center',
    command: 'presentation:align-center',
    attributes: { title: '水平居中对齐', 'aria-label': '水平居中对齐' },
  }, {
    id: 'presentation-align-right',
    className: 'fa-solid fa-align-right',
    command: 'presentation:align-right',
    attributes: { title: '右对齐', 'aria-label': '右对齐' },
  }, {
    id: 'presentation-align-top',
    className: 'fa-solid fa-arrow-up-wide-short',
    command: 'presentation:align-top',
    attributes: { title: '顶部对齐', 'aria-label': '顶部对齐' },
  }, {
    id: 'presentation-align-middle',
    className: 'fa-solid fa-arrows-up-down',
    command: 'presentation:align-middle',
    attributes: { title: '垂直居中对齐', 'aria-label': '垂直居中对齐' },
  }, {
    id: 'presentation-align-bottom',
    className: 'fa-solid fa-arrow-down-wide-short',
    command: 'presentation:align-bottom',
    attributes: { title: '底部对齐', 'aria-label': '底部对齐' },
  }, {
    id: 'presentation-distribute-horizontal',
    className: 'fa-solid fa-arrows-left-right-to-line',
    command: 'presentation:distribute-horizontal',
    attributes: { title: '横向等距分布（至少3个对象）', 'aria-label': '横向等距分布' },
  }, {
    id: 'presentation-distribute-vertical',
    className: 'fa-solid fa-arrows-up-down-to-line',
    command: 'presentation:distribute-vertical',
    attributes: { title: '纵向等距分布（至少3个对象）', 'aria-label': '纵向等距分布' },
  }])

  editor.on('component:drag:end', (data: { target?: Component }) => {
    if (gridSnap && editor.getDragMode() === 'absolute') {
      editor.getSelectedAll().forEach(snapComponent)
    }
    if (smartGuides && editor.getDragMode() === 'absolute') snapToSmartGuides(editor, data?.target || editor.getSelected())
  })
  editor.on('component:resize', () => {
    if (gridSnap && editor.getDragMode() === 'absolute') editor.getSelectedAll().forEach(snapComponent)
  })

  const attachedDocuments = new WeakSet<Document>()
  const attachMultiSelect = () => {
    const doc = editor.Canvas.getDocument()
    if (!doc || attachedDocuments.has(doc)) return
    attachedDocuments.add(doc)
    doc?.addEventListener('click', event => {
      const mouseEvent = event as MouseEvent
      if (!mouseEvent.shiftKey) return
      const target = mouseEvent.target as HTMLElement | null
      if (!target || target === doc.body || target === doc.documentElement) return
      mouseEvent.preventDefault()
      mouseEvent.stopImmediatePropagation()
      editor.selectToggle(target)
    }, true)
  }
  editor.on('canvas:frame:load', attachMultiSelect)
  editor.on('load', attachMultiSelect)
  editor.on('component:selected component:deselected', () => updateLockButton(editor))
  attachMultiSelect()
}
