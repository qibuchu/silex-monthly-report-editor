import { Component, Editor } from 'grapesjs'
import { cmdOpenTableTools, parseTabularText } from './presentation-mode'
import tableInteraction from './table-interaction'

const tag = (c: Component) => String(c.get('tagName')).toLowerCase()
export const cells = (row: Component) => row.components().models.filter(c => ['td', 'th'].includes(tag(c)))
const span = (c: Component) => Math.max(1, Number(c.getAttributes().colspan) || 1)
export function tableContext(selected?: Component) {
  let table: Component | undefined, cell: Component | undefined, row: Component | undefined
  for (let c = selected; c; c = c.parent()) {
    if (!cell && ['td', 'th'].includes(tag(c))) cell = c
    if (!row && tag(c) === 'tr') row = c
    if (tag(c) === 'table') { table = c; break }
  }
  return { table, row, cell }
}
export function descendants(component: Component): Component[] {
  return component.components().models.flatMap(c => [c, ...descendants(c)])
}
export const rows = (table: Component) => descendants(table).filter(r => tag(r) === 'tr' && tableContext(r).table === table)
export const columnCount = (table: Component) => Math.max(1, ...rows(table).map(r => cells(r).reduce((n, c) => n + span(c), 0)))
export function columnIndex(row: Component, cell: Component) {
  let n = 0
  for (const c of cells(row)) { if (c === cell) return n; n += span(c) }
  return n
}
function assertSimple(table: Component) {
  if (rows(table).some(r => cells(r).some(c => Number(c.getAttributes().rowspan) > 1))) throw Error('此表含跨行合并单元格，暂不支持增删行列；可编辑文字和样式。')
}
function cleanClone(c: Component) {
  const attributes = { ...c.getAttributes() }
  for (const key of ['id', 'data-object-id', 'data-binding-id', 'data-appid']) delete attributes[key]
  c.setAttributes(attributes)
  c.components().forEach(cleanClone)
}
export function setColumnWidths(table: Component, input: number[]) {
  const count = columnCount(table)
  if (input.length !== count || input.some(n => !Number.isFinite(n) || n <= 0)) throw Error(`请填写${count}个大于0的列宽。`)
  const total = input.reduce((a, b) => a + b, 0), widths = input.map(n => n / total * 100)
  table.addStyle({ 'table-layout': 'fixed' })
  let group = table.components().models.find(c => tag(c) === 'colgroup')
  if (!group) group = table.components().add({ tagName: 'colgroup' }, { at: 0 }) as Component
  group.components(widths.map(width => ({ tagName: 'col', style: { width: `${width}%` } })))
  rows(table).forEach(row => {
    let offset = 0
    cells(row).forEach(cell => {
      const width = widths.slice(offset, offset + span(cell)).reduce((a, b) => a + b, 0)
      cell.addStyle({ width: `${width}%`, 'white-space': 'nowrap', overflow: 'hidden', 'text-overflow': 'ellipsis' })
      descendants(cell).filter(c => ['p', 'div', 'span'].includes(tag(c))).forEach(c => c.addStyle({ 'white-space': 'nowrap' }))
      offset += span(cell)
    })
  })
  table.addAttributes({ 'data-column-widths': widths.join(',') })
}
export function getColumnWidths(table: Component) {
  const count = columnCount(table)
  const columns = descendants(table).filter(c => tag(c) === 'col').slice(0, count)
  const stored = String(table.getAttributes()['data-column-widths'] || '').split(',').map(Number)
  if (stored.length === count && stored.every(n => n > 0)) return stored
  const values = columns.map(c => Number.parseFloat(String(c.getStyle().width)) || 0)
  if (values.length === count && values.every(n => n > 0)) return values
  return Array(count).fill(100 / count) as number[]
}
export function changeColumn(table: Component, index: number, insert: boolean) {
  assertSimple(table)
  const count = columnCount(table)
  if (!insert && count <= 1) throw Error('至少保留一列。')
  index = Math.max(0, Math.min(index, insert ? count : count - 1))
  const widths = getColumnWidths(table)
  rows(table).forEach(row => {
    let offset = 0
    const list = cells(row)
    const last = list.at(-1)
    const target = list.find(c => { const start = offset; offset += span(c); return index >= start && index < offset }) || (insert && index === count && last && span(last) > 1 ? last : undefined)
    if (target && span(target) > 1) {
      target.addAttributes({ colspan: span(target) + (insert ? 1 : -1) })
    } else if (insert) {
      const source = target || list.at(-1)
      const clone = source?.clone()
      if (!clone) return
      cleanClone(clone)
      clone.components([{ type: 'textnode', content: tag(clone) === 'th' ? '新字段' : '—' }])
      row.components().add(clone, { at: target ? target.index() : row.components().length })
    } else target?.remove()
  })
  if (insert) widths.splice(index, 0, 100 / count)
  else widths.splice(index, 1)
  setColumnWidths(table, widths)
}
export function changeRow(table: Component, row: Component, insert: boolean, before = false) {
  assertSimple(table)
  if (insert) {
    const clone = row.clone()
    cleanClone(clone)
    cells(clone).forEach(c => c.components([{ type: 'textnode', content: '—' }]))
    row.parent()!.components().add(clone, { at: row.index() + (before ? 0 : 1) })
  } else {
    if (rows(table).length <= 1) throw Error('至少保留一行。')
    row.remove()
  }
  // HTML table height is a minimum height; remove it so deleting a row shrinks
  // the table instead of stretching the remaining rows.
  table.addStyle({ height: 'auto' })
  const wrapper = table.parent()
  if (wrapper?.getAttributes()['data-kind'] === 'table') wrapper.addStyle({ height: 'auto' })
}
function textOf(c?: Component) { return c?.getEl()?.textContent || '' }
const textStyleKeys = ['font-family', 'font-size', 'font-weight', 'font-style', 'color', 'line-height', 'text-align', 'letter-spacing', 'text-decoration']
function textLeaf(cell: Component) {
  const candidates = descendants(cell).filter(c => ['span', 'p', 'div'].includes(tag(c)))
  return candidates.find(c => tag(c) === 'span') || candidates.filter(c => tag(c) === 'p').at(-1) || candidates.at(-1) || cell
}
function explicitTextStyle(cell: Component, leaf: Component) {
  const path: Component[] = []
  for (let c: Component | undefined = leaf; c; c = c.parent()) { path.unshift(c); if (c === cell) break }
  const result: Record<string, string> = {}
  path.forEach(c => { const styles = c.getStyle(); textStyleKeys.forEach(key => { if (styles[key]) result[key] = String(styles[key]) }) })
  return result
}
function resolvedTextStyle(cell: Component) {
  const leaf = textLeaf(cell), explicit = explicitTextStyle(cell, leaf), el = leaf.getEl()
  const computed = el?.ownerDocument.defaultView?.getComputedStyle(el)
  const result: Record<string, string> = { ...explicit }
  if (computed) textStyleKeys.forEach(key => { const value = computed.getPropertyValue(key); if (value) result[key] = value })
  return result
}
function neighboringTextCell(cell: Component) {
  const { table, row } = tableContext(cell)
  if (!table || !row) return undefined
  const allRows = rows(table), index = allRows.indexOf(row), col = columnIndex(row, cell)
  const fieldRow = allRows.findIndex(r => cells(r).length === columnCount(table))
  const sameColumn = allRows.map((r, i) => ({ r, i })).filter(({ i }) => i !== index && (index <= fieldRow || i > fieldRow)).sort((a, b) => Math.abs(a.i - index) - Math.abs(b.i - index)).flatMap(({ r }) => cells(r).filter(c => columnIndex(r, c) === col && span(c) === span(cell)))
  return [...sameColumn, ...cells(row).filter(c => c !== cell && span(c) === 1)].find(c => textOf(c).trim() || descendants(c).some(n => String(n.get('content') || '').replace(/<[^>]*>/g, '').trim()))
}
export function cellTextAppearance(cell: Component) {
  const leaf = textLeaf(cell), own = explicitTextStyle(cell, leaf), result = resolvedTextStyle(cell)
  const populated = textOf(cell).trim() || descendants(cell).some(c => String(c.get('content') || '').replace(/<[^>]*>/g, '').trim())
  if (populated) return result
  const neighbor = neighboringTextCell(cell)
  if (neighbor) {
    const fallback = resolvedTextStyle(neighbor)
    textStyleKeys.forEach(key => { if (!own[key] && fallback[key]) result[key] = fallback[key] })
  }
  return result
}
export function matchCellTextStyle(cell: Component) {
  const neighbor = neighboringTextCell(cell)
  if (!neighbor) throw Error('未找到可参考的正文单元格。')
  const formatting = resolvedTextStyle(neighbor)
  cell.addStyle(formatting)
  descendants(cell).filter(c => ['p', 'div', 'span'].includes(tag(c))).forEach(c => c.addStyle(formatting))
}
export function writeCellText(cell: Component, value: string) {
  const formatting = cellTextAppearance(cell)
  const content = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  cell.components([{ type: 'text', tagName: 'div', editable: true, attributes: { title: value, 'data-table-text': 'true' }, style: { ...formatting, 'white-space': 'nowrap', overflow: 'hidden', 'text-overflow': 'ellipsis' }, components: [{ type: 'textnode', content }] }])
}
export function upgradeCellText(cell: Component) {
  // Repair wrappers produced by older versions without flattening rich text,
  // replacing business IDs, or changing any existing typography.
  cell.components().models.slice().forEach(child => {
    if (tag(child) !== 'div' || child.get('type') === 'text' || !Object.hasOwn(child.getAttributes(), 'title')) return
    if (!child.components().models.every(c => c.get('type') === 'textnode')) return
    const styles = { ...child.getStyle() }
    const replacements = child.replaceWith({ ...child.toJSON(), type: 'text', editable: true, attributes: { ...child.getAttributes(), 'data-table-text': 'true' } })
    replacements.forEach(component => component.addStyle(styles))
  })
}
export function pasteCells(table: Component, start: Component, col: number, data: string[][]) {
  assertSimple(table)
  if (!data.length) throw Error('请先粘贴数据。')
  const startIndex = rows(table).indexOf(start)
  const end = startIndex + data.length
  const existing = rows(table).slice(startIndex, end)
  if (existing.some(r => cells(r).some(c => span(c) > 1))) throw Error('批量粘贴不能跨过合并标题，请从字段表头或数据单元格开始。')
  const columns = col + Math.max(...data.map(r => r.length))
  while (columnCount(table) < columns) changeColumn(table, columnCount(table), true)
  while (rows(table).length < end) changeRow(table, rows(table).at(-1)!, true)
  data.forEach((values, i) => values.forEach((value, j) => writeCellText(cells(rows(table)[startIndex + i])[col + j], value)))
}

export default function tableEditor(editor: Editor) {
  const upgradeTables = () => editor.Pages.getAll().forEach(page => descendants(page.getMainComponent()).filter(c => ['td', 'th'].includes(tag(c))).forEach(upgradeCellText))
  editor.on('project:load page:select', upgradeTables)
  const bar = document.createElement('div')
  bar.className = 'silex-table-bar'
  bar.hidden = true
  bar.innerHTML = '<span>表格</span><button type="button">表格工具：行列 / 列宽 / 样式</button><span>拖选 / Shift多选 · 右键行列操作 · 拖蓝线调大小</span>'
  const style = document.createElement('style')
  style.textContent = '.silex-table-bar{position:fixed;bottom:34px;left:220px;z-index:900;display:flex;align-items:center;gap:12px;padding:8px 12px;background:#222;color:#eee;border:1px solid #555;border-radius:6px;font:13px sans-serif}.silex-table-bar[hidden]{display:none}.silex-table-bar button{background:#245f91;color:white;border:0;border-radius:3px;padding:8px;cursor:pointer}.silex-table-dialog{display:flex;flex-direction:column;gap:12px;max-height:70vh;overflow:auto;width:600px;max-width:75vw}.silex-table-dialog label{display:flex;gap:8px;align-items:center}.silex-table-dialog input,.silex-table-dialog select,.silex-table-dialog textarea{background:#222;color:#eee;border:1px solid #666;padding:6px}.silex-table-dialog textarea{width:95%;min-height:64px}.silex-table-dialog button{background:#333;color:#eee;border:1px solid #777;border-radius:3px;padding:8px;cursor:pointer}.silex-table-dialog fieldset{border:1px solid #555;display:flex;flex-wrap:wrap;gap:8px}.silex-table-dialog [data-status]{color:#efb85a;min-height:20px}'
  document.head.append(style)
  document.body.append(bar)
  bar.querySelector('button')!.onclick = () => editor.runCommand(cmdOpenTableTools)
  let handles: HTMLElement[] = []
  let cancelDrag: (() => void) | undefined
  function clearHandles() { cancelDrag?.(); cancelDrag = undefined; handles.forEach(h => h.remove()); handles = [] }
  function showHandles() {
    clearHandles()
    const { table } = tableContext(editor.getSelected())
    bar.hidden = !table
    if (!table) return
    const doc = editor.Canvas.getDocument()
    const count = columnCount(table), header = rows(table).find(r => cells(r).length === count && cells(r).every(c => span(c) === 1))
    const el = table.getEl()
    if (!doc || !el || !header) return
    const rect = el.getBoundingClientRect()
    cells(header).slice(0, -1).forEach((cell, i) => {
      const edge = cell.getEl()?.getBoundingClientRect()
      if (!edge) return
      const handle = doc.createElement('div')
      handle.setAttribute('data-table-resize-handle', String(i))
      handle.title = `拖动调整第${i + 1}、${i + 2}列宽`
      Object.assign(handle.style, { position: 'fixed', left: `${edge.right - 4}px`, top: `${edge.top}px`, height: `${edge.height}px`, width: '8px', background: '#368fdf88', cursor: 'col-resize', zIndex: '2147483647' })
      doc.body.append(handle); handles.push(handle)
      handle.onpointerdown = e => {
        e.preventDefault(); e.stopPropagation()
        const start = e.clientX, widths = getColumnWidths(table), pair = widths[i] + widths[i + 1]
        const move = (event: PointerEvent) => { handle.style.left = `${edge.right - 4 + event.clientX - start}px` }
        const cleanup = () => { doc.removeEventListener('pointermove', move); doc.removeEventListener('pointerup', up); doc.removeEventListener('pointercancel', cleanup) }
        const up = (event: PointerEvent) => {
          cleanup(); cancelDrag = undefined
          const delta = (event.clientX - start) / rect.width * 100
          const minimum = Math.min(2, pair / 3)
          widths[i] = Math.min(pair - minimum, Math.max(minimum, widths[i] + delta)); widths[i + 1] = pair - widths[i]
          setColumnWidths(table, widths); showHandles()
        }
        cancelDrag = cleanup
        doc.addEventListener('pointermove', move); doc.addEventListener('pointerup', up); doc.addEventListener('pointercancel', cleanup)
      }
    })
  }
  const interaction = tableInteraction(editor, showHandles)
  editor.Commands.add(cmdOpenTableTools, () => {
    const { table, row, cell } = tableContext(editor.getSelected())
    if (!table) return
    const allRows = rows(table), selectedRow = row || allRows.at(-1)!
    const col = cell && row ? columnIndex(row, cell) : 0
    const panel = document.createElement('div')
    panel.className = 'silex-table-dialog'
    panel.innerHTML = `<p>当前：第${row ? allRows.indexOf(row) + 1 : '—'}行，第${cell ? col + 1 : '—'}列。长文字不会自动撑高行。</p>
      <label>单元格文字<textarea data-cell-text></textarea></label><button data-action="text">写入当前单元格</button><button data-action="match-text-style">匹配同列文字样式</button>
      <fieldset><legend>行列结构</legend><button data-action="row-add">下方插入行</button><button data-action="row-delete">删除当前行</button><button data-action="col-add">右侧插入列</button><button data-action="col-delete">删除当前列</button></fieldset>
      <fieldset><legend>列宽（比例，自动归一为100%）</legend><input aria-label="列宽比例" data-widths style="width:95%"><button data-action="widths">应用列宽</button><button data-action="equal">平均分配列宽</button></fieldset>
      <fieldset><legend>样式</legend><label>范围<select data-scope><option value="cell">当前单元格</option><option value="selection">选中的单元格</option><option value="row">当前行</option><option value="table">整张表</option><option value="header">字段表头</option></select></label><label>字号<input aria-label="表格字号" data-size type="number" min="8" max="96" value="21" style="width:60px"></label><label>文字颜色<input aria-label="表格文字颜色" data-color type="color" value="#002b5c"></label><label>对齐<select data-align><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></label><label>字重<select data-weight><option value="400">常规</option><option value="700">加粗</option></select></label><label>分隔线<input aria-label="表格分隔线颜色" data-border type="color" value="#d9dde3"></label><button data-action="style">应用样式</button></fieldset>
      <details><summary>批量粘贴 Excel 数据</summary><textarea data-paste aria-label="批量表格数据" placeholder="粘贴制表符分隔的数据，从当前单元格开始"></textarea><button data-action="paste">写入粘贴数据</button></details><p data-status>删除列后保持表格宽度；删除行后下方行上移。操作支持编辑器撤销。</p>`
    ;(panel.querySelector('[data-cell-text]') as HTMLTextAreaElement).value = textOf(cell)
    ;(panel.querySelector('[data-widths]') as HTMLInputElement).value = getColumnWidths(table).map(n => n.toFixed(1)).join(', ')
    if (!cell) (panel.querySelector('[data-action="text"]') as HTMLButtonElement).disabled = true
    const status = panel.querySelector('[data-status]')!
    panel.onclick = event => {
      const action = (event.target as HTMLElement).closest('button')?.dataset.action
      if (!action) return
      try {
        const input = (key: string) => (panel.querySelector(`[data-${key}]`) as HTMLInputElement).value
        if (action === 'text' && cell) {
          writeCellText(cell, input('cell-text'))
        } else if (action === 'match-text-style') {
          if (!cell) throw Error('请先选中单元格。')
          matchCellTextStyle(cell)
        } else if (action === 'paste') {
          if (!cell || !row) throw Error('请先选中粘贴起点单元格。')
          pasteCells(table, row, col, parseTabularText(input('paste')))
        } else if (action.startsWith('row-')) changeRow(table, selectedRow, action === 'row-add')
        else if (action.startsWith('col-')) changeColumn(table, action === 'col-add' ? col + 1 : col, action === 'col-add')
        else if (action === 'widths') setColumnWidths(table, input('widths').split(/[,，\s]+/).filter(Boolean).map(Number))
        else if (action === 'equal') setColumnWidths(table, Array(columnCount(table)).fill(1))
        else if (action === 'style') {
          const scope = input('scope'), size = Number(input('size'))
          if (!Number.isFinite(size) || size < 8 || size > 96) throw Error('字号范围为8–96。')
          const header = allRows.find(r => cells(r).length === columnCount(table))
          const targets = scope === 'selection' ? interaction.selectedCells(table) : scope === 'table' ? allRows.flatMap(cells) : scope === 'header' ? cells(header || allRows[0]) : scope === 'row' ? cells(selectedRow) : cell ? [cell] : []
          if (!targets.length) throw Error('请先选中单元格。')
          targets.forEach(c => {
            const formatting = { 'font-size': `${size}px`, color: input('color'), 'text-align': input('align'), 'font-weight': input('weight') }
            c.addStyle({ ...formatting, border: `1px solid ${input('border')}` })
            descendants(c).filter(child => ['span', 'p', 'div'].includes(tag(child))).forEach(child => child.addStyle(formatting))
          })
        }
        showHandles()
        status.textContent = '已应用。'
        if (action.startsWith('row-') || action.startsWith('col-')) { editor.Modal.close(); editor.select(table) }
      } catch (error) { status.textContent = (error as Error).message }
    }
    editor.Modal.setTitle('表格工具'); editor.Modal.setContent(panel); editor.Modal.open()
  })
  editor.on('component:selected component:deselected canvas:frame:load canvas:zoom page:select', showHandles)
  editor.on('undo redo', showHandles)
  editor.on('destroy', () => { clearHandles(); bar.remove(); style.remove() })
}
