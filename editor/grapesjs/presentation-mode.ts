/* Presentation-oriented controls for fixed-layout reports. */
import { Component, Editor } from 'grapesjs'

export const cmdToggleFreePosition = 'presentation:toggle-free-position'
export const cmdToggleGridSnap = 'presentation:toggle-grid-snap'
export const cmdGroup = 'presentation:group'
export const cmdUngroup = 'presentation:ungroup'

type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
type DistributeMode = 'horizontal' | 'vertical'

const GRID_SIZE = 8
const GRID_STYLE_ID = 'silex-presentation-grid'

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
  return selected
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

  editor.Commands.add(cmdGroup, () => runPresentationAction(editor, () => group(editor)))
  editor.Commands.add(cmdUngroup, () => runPresentationAction(editor, () => ungroup(editor)))
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

  editor.on('component:drag:end component:resize', () => {
    if (gridSnap && editor.getDragMode() === 'absolute') {
      editor.getSelectedAll().forEach(snapComponent)
    }
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
  attachMultiSelect()
}
