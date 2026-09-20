/* Presentation-oriented controls for fixed-layout reports. */
import { Component, Editor } from 'grapesjs'

export const cmdToggleFreePosition = 'presentation:toggle-free-position'
export const cmdToggleGridSnap = 'presentation:toggle-grid-snap'

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
  }])

  editor.on('component:drag:end component:resize', () => {
    if (gridSnap && editor.getDragMode() === 'absolute') {
      editor.getSelectedAll().forEach(snapComponent)
    }
  })

  editor.on('canvas:frame:load', () => {
    const doc = editor.Canvas.getDocument()
    doc?.addEventListener('click', event => {
      const mouseEvent = event as MouseEvent
      if (!mouseEvent.shiftKey) return
      const target = mouseEvent.target as HTMLElement | null
      if (!target || target === doc.body || target === doc.documentElement) return
      mouseEvent.preventDefault()
      mouseEvent.stopImmediatePropagation()
      editor.selectToggle(target)
    }, true)
  })
}
