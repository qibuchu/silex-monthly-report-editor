import { Component, Editor } from 'grapesjs'
import { cells, rows, columnCount, columnIndex, descendants, tableContext, changeColumn, changeRow } from './table-editor'
import { cmdOpenTableTools } from './presentation-mode'

export type CellRange = { top: number, bottom: number, left: number, right: number }
const colspan = (cell: Component) => Math.max(1, Number(cell.getAttributes().colspan) || 1)
export function rangeBetween(table: Component, first: Component, last: Component): CellRange {
  const a = tableContext(first), b = tableContext(last), list = rows(table)
  if (!a.row || !b.row) throw Error('请选择同一表格中的单元格。')
  const x = columnIndex(a.row, first), y = columnIndex(b.row, last)
  return { top: Math.min(list.indexOf(a.row), list.indexOf(b.row)), bottom: Math.max(list.indexOf(a.row), list.indexOf(b.row)), left: Math.min(x, y), right: Math.max(x + colspan(first) - 1, y + colspan(last) - 1) }
}
export function cellsInRange(table: Component, range: CellRange): Component[] {
  return rows(table).slice(range.top, range.bottom + 1).flatMap(row => cells(row).filter(cell => {
    const start = columnIndex(row, cell)
    // A column selection does not accidentally include the full merged title.
    return start >= range.left && start + colspan(cell) - 1 <= range.right
  }))
}
export function setRowHeight(table: Component, row: Component, height: number) {
  if (!Number.isFinite(height) || height < 24 || height > 600) throw Error('行高范围为24–600像素。')
  if (cells(row).some(c => Number(c.getAttributes().rowspan) > 1)) throw Error('跨行合并单元格暂不支持拖拽行高。')
  row.addStyle({ height: `${height}px` })
  cells(row).forEach(cell => {
    cell.addStyle({ height: `${height}px`, 'box-sizing': 'border-box', 'white-space': 'nowrap', overflow: 'hidden', padding: '4px 8px' })
    descendants(cell).filter(c => ['p', 'div'].includes(String(c.get('tagName')).toLowerCase())).forEach(c => {
      c.addStyle({ 'white-space': 'nowrap', 'max-height': `${height - 10}px`, 'min-height': '0', overflow: 'hidden' })
    })
  })
  table.addStyle({ height: 'auto' })
  if (table.parent()?.getAttributes()['data-kind'] === 'table') table.parent()!.addStyle({ height: 'auto' })
}

export default function tableInteraction(editor: Editor, refreshColumns: () => void) {
  let active: Component | undefined, anchor: Component | undefined, range: CellRange | undefined
  let doc: Document | undefined, detach = () => {}, dragCleanup: (() => void) | undefined
  let overlays: HTMLElement[] = []
  let skipClick = false, painting = false
  const menu = document.createElement('div')
  menu.className = 'silex-table-context'; menu.hidden = true; menu.setAttribute('role', 'menu')
  const style = document.createElement('style')
  style.textContent = '.silex-table-context{position:fixed;z-index:10000;background:#222;border:1px solid #666;border-radius:5px;padding:6px;min-width:200px;color:white;font:13px sans-serif;max-height:80vh;overflow:auto}.silex-table-context[hidden]{display:none}.silex-table-context button{display:block;width:100%;text-align:left;background:transparent;color:#eee;border:0;padding:9px;cursor:pointer}.silex-table-context button:hover{background:#245f91}.silex-table-context p{max-width:260px;color:#efb85a;margin:5px}'
  document.head.append(style); document.body.append(menu)
  function clearOverlays() { overlays.forEach(el => el.remove()); overlays = [] }
  function overlay(rect: DOMRect, options: Record<string, string>, title?: string) {
    const el = doc!.createElement('div')
    el.setAttribute('data-table-edit-overlay', 'true')
    Object.assign(el.style, { position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, zIndex: '2147483646', 'box-sizing': 'border-box' }, options)
    if (title) el.title = title
    doc!.body.append(el); overlays.push(el); return el
  }
  function draw() {
    if (painting) return
    clearOverlays()
    if (!active || !doc || !active.getEl()) return
    const table = active, rect = table.getEl()!.getBoundingClientRect(), allRows = rows(table), count = columnCount(table)
    if (!allRows.length) return
    if (range) cellsInRange(table, range).forEach(cell => {
      const el = cell.getEl(); if (!el) return
      const mark = overlay(el.getBoundingClientRect(), { border: '2px solid #459ce5', background: '#459ce512', 'pointer-events': 'none' })
      mark.setAttribute('data-table-selected-cell', 'true')
    })
    const header = allRows.find(row => cells(row).length === count && cells(row).every(c => colspan(c) === 1))
    cells(header || allRows[0]).forEach((cell, index) => {
      if (colspan(cell) > 1 || !cell.getEl()) return
      const r = cell.getEl()!.getBoundingClientRect()
      const label = overlay(new DOMRect(r.left, rect.top - 24, r.width, 20), { background: '#245f91', color: 'white', 'text-align': 'center', font: '14px/20px sans-serif', cursor: 's-resize' }, `选择第${index + 1}列`)
      label.textContent = String(index + 1); label.setAttribute('data-table-column-select', String(index))
      label.onpointerdown = event => {
        event.preventDefault(); event.stopPropagation()
        const left = event.shiftKey && range ? Math.min(range.left, index) : index, right = event.shiftKey && range ? Math.max(range.right, index) : index
        range = { top: 0, bottom: allRows.length - 1, left, right }; anchor = cell
        painting = true; editor.select(cell); painting = false; draw()
      }
    })
    allRows.forEach((row, index) => {
      const el = row.getEl(); if (!el) return
      const r = el.getBoundingClientRect()
      const label = overlay(new DOMRect(rect.left - 24, r.top, 20, r.height), { background: '#245f91', color: 'white', 'text-align': 'center', font: '14px sans-serif', display: 'flex', 'align-items': 'center', 'justify-content': 'center', cursor: 'e-resize' }, `选择第${index + 1}行`)
      label.textContent = String(index + 1); label.setAttribute('data-table-row-select', String(index))
      label.onpointerdown = event => {
        event.preventDefault(); event.stopPropagation()
        const top = event.shiftKey && range ? Math.min(range.top, index) : index, bottom = event.shiftKey && range ? Math.max(range.bottom, index) : index
        range = { top, bottom, left: 0, right: count - 1 }; anchor = cells(row)[0]
        painting = true; editor.select(anchor); painting = false; draw()
      }
      const grip = overlay(new DOMRect(rect.right - 22, r.bottom - 4, 22, 8), { background: '#368fdfaa', cursor: 'row-resize', zIndex: '2147483647' }, `拖动调整第${index + 1}行高`)
      grip.setAttribute('data-table-row-resize', String(index))
      grip.onpointerdown = event => {
        event.preventDefault(); event.stopPropagation(); dragCleanup?.()
        const start = event.clientY, initial = r.height
        const move = (e: PointerEvent) => { grip.style.top = `${r.bottom - 4 + e.clientY - start}px` }
        const cleanup = () => { doc?.removeEventListener('pointermove', move); doc?.removeEventListener('pointerup', up); doc?.removeEventListener('pointercancel', cleanup) }
        const up = (e: PointerEvent) => {
          cleanup(); dragCleanup = undefined
          try { setRowHeight(table, row, Math.max(24, Math.min(600, initial + e.clientY - start))) } catch (error) { editor.runCommand('notifications:add', { type: 'error', group: '表格', message: (error as Error).message }) }
          refreshColumns(); draw()
        }
        dragCleanup = cleanup
        doc!.addEventListener('pointermove', move); doc!.addEventListener('pointerup', up); doc!.addEventListener('pointercancel', cleanup)
      }
    })
  }
  function cellAt(target: EventTarget | null) {
    const element = target as Element | null, td = element?.closest?.('td,th')
    if (!td) return undefined
    const tableEl = td.closest('table')
    const table = descendants(editor.getWrapper()!).find(c => c.getEl() === tableEl)
    if (!table) return undefined
    return { table, cell: rows(table).flatMap(cells).find(c => c.getEl() === td) }
  }
  function down(event: PointerEvent) {
    if (event.button !== 0 || event.detail > 1 || (event.target as Element).closest?.('[contenteditable="true"],[data-table-edit-overlay],[data-table-resize-handle]')) return
    const hit = cellAt(event.target); if (!hit?.cell) return
    menu.hidden = true; dragCleanup?.()
    event.preventDefault(); event.stopPropagation()
    const { table, cell } = hit
    if (active !== table) { anchor = undefined; range = undefined }
    active = table
    if (!event.shiftKey || !anchor) anchor = cell
    range = rangeBetween(table, anchor, cell)
    painting = true; editor.select(cell); painting = false; draw()
    skipClick = true
    const move = (e: PointerEvent) => {
      const target = doc!.elementFromPoint(e.clientX, e.clientY), next = cellAt(target)
      if (next?.table === table && next.cell) { range = rangeBetween(table, anchor!, next.cell); draw() }
    }
    const cleanup = () => { doc?.removeEventListener('pointermove', move); doc?.removeEventListener('pointerup', cleanup); doc?.removeEventListener('pointercancel', cleanup); dragCleanup = undefined }
    dragCleanup = cleanup
    doc!.addEventListener('pointermove', move); doc!.addEventListener('pointerup', cleanup); doc!.addEventListener('pointercancel', cleanup)
  }
  function click(event: MouseEvent) { if (skipClick && event.detail === 1 && cellAt(event.target)) { skipClick = false; event.preventDefault(); event.stopPropagation() } }
  function context(event: MouseEvent) {
    const hit = cellAt(event.target); if (!hit?.cell) return
    event.preventDefault(); event.stopPropagation()
    if (active !== hit.table || !range || !cellsInRange(hit.table, range).includes(hit.cell)) {
      active = hit.table; anchor = hit.cell; range = rangeBetween(active, anchor, anchor)
    }
    painting = true; editor.select(hit.cell); painting = false; draw()
    const frame = doc!.defaultView!.frameElement as HTMLIFrameElement, rect = frame.getBoundingClientRect(), scale = rect.width / frame.clientWidth
    menu.innerHTML = '<button data-action="row-before">上方插入行</button><button data-action="row-after">下方插入行</button><button data-action="col-before">左侧插入列</button><button data-action="col-after">右侧插入列</button><button data-action="rows-delete">删除选中行</button><button data-action="cols-delete">删除选中列</button><button data-action="row-select">选择整行</button><button data-action="col-select">选择整列</button><button data-action="equal-rows">平均分布选中行</button><button data-action="tools">文字与样式设置</button><p data-message></p>'
    menu.style.left = `${Math.max(0, Math.min(window.innerWidth - 230, rect.left + event.clientX * scale))}px`
    menu.style.top = `${Math.max(0, Math.min(window.innerHeight - 430, rect.top + event.clientY * scale))}px`
    menu.hidden = false
  }
  menu.onclick = event => {
    const action = (event.target as HTMLElement).closest('button')?.dataset.action
    if (!action || !active || !range) return
    try {
      const list = rows(active), selected = list.slice(range.top, range.bottom + 1)
      if (action === 'row-before' || action === 'row-after') changeRow(active, action === 'row-before' ? selected[0] : selected.at(-1)!, true, action === 'row-before')
      else if (action === 'col-before' || action === 'col-after') changeColumn(active, action === 'col-before' ? range.left : range.right + 1, true)
      else if (action === 'rows-delete') {
        if (selected.length >= list.length) throw Error('至少保留一行。')
        selected.reverse().forEach(row => changeRow(active!, row, false))
      } else if (action === 'cols-delete') {
        if (range.right - range.left + 1 >= columnCount(active)) throw Error('至少保留一列。')
        for (let index = range.right; index >= range.left; index--) changeColumn(active, index, false)
      } else if (action === 'row-select') { range.left = 0; range.right = columnCount(active) - 1 }
      else if (action === 'col-select') { range.top = 0; range.bottom = list.length - 1 }
      else if (action === 'equal-rows') {
        if (selected.some(row => cells(row).some(c => Number(c.getAttributes().rowspan) > 1))) throw Error('跨行合并表格暂不支持平均行高。')
        const height = selected.reduce((n, row) => n + (row.getEl()?.getBoundingClientRect().height || Number.parseFloat(String(row.getStyle().height)) || 36), 0) / selected.length
        selected.forEach(row => setRowHeight(active!, row, height))
      } else if (action === 'tools') editor.runCommand(cmdOpenTableTools)
      if (['rows-delete', 'cols-delete', 'row-before', 'row-after', 'col-before', 'col-after'].includes(action)) {
        range = undefined; anchor = undefined; editor.select(active)
      }
      menu.hidden = true; refreshColumns(); draw()
    } catch (error) { menu.querySelector('[data-message]')!.textContent = (error as Error).message }
  }
  function bind() {
    const next = editor.Canvas.getDocument()
    if (!next || next === doc) return
    detach(); clearOverlays(); dragCleanup?.(); doc = next
    doc.addEventListener('pointerdown', down, true); doc.addEventListener('click', click, true); doc.addEventListener('contextmenu', context, true)
    doc.addEventListener('scroll', draw, true); doc.addEventListener('keydown', escape)
    detach = () => { next.removeEventListener('pointerdown', down, true); next.removeEventListener('click', click, true); next.removeEventListener('contextmenu', context, true); next.removeEventListener('scroll', draw, true); next.removeEventListener('keydown', escape) }
  }
  const dismiss = (event: Event) => { if (!menu.contains(event.target as Node)) menu.hidden = true }
  const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { menu.hidden = true; range = undefined; draw() } }
  document.addEventListener('pointerdown', dismiss); document.addEventListener('keydown', escape)
  editor.on('canvas:frame:load', () => { bind(); draw() })
  editor.on('component:selected', (component: Component) => {
    bind()
    if (painting) return
    const current = tableContext(component)
    if (current.table !== active) { active = current.table; range = undefined; anchor = undefined }
    if (!range && active && current.cell) { anchor = current.cell; range = rangeBetween(active, anchor, anchor) }
    draw()
  })
  editor.on('page:select', () => { dragCleanup?.(); active = undefined; range = undefined; anchor = undefined; menu.hidden = true; clearOverlays() })
  editor.on('canvas:zoom undo redo', () => { bind(); range = undefined; draw() })
  editor.on('destroy', () => { detach(); dragCleanup?.(); clearOverlays(); menu.remove(); style.remove(); document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape) })
  return { selectedCells: (table: Component) => active === table && range ? cellsInRange(table, range) : [] }
}
