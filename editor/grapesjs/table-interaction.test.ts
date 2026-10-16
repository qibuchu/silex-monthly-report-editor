import grapesjs, { Editor, Component } from 'grapesjs'
import { rows, cells } from './table-editor'
import { rangeBetween, cellsInRange, setRowHeight } from './table-interaction'

describe('PPT style table selection and row sizing', () => {
  let editor: Editor, table: Component
  beforeEach(() => {
    document.body.innerHTML = '<div id="editor"></div>'
    editor = grapesjs.init({ container: '#editor', storageManager: false })
    table = editor.addComponents('<table><tbody><tr><td colspan="3">标题</td></tr><tr><td>A</td><td>B</td><td>C</td></tr><tr><td>1</td><td>2</td><td>3</td></tr><tr><td>4</td><td>5</td><td>6</td></tr></tbody></table>')[0]
  })
  afterEach(() => editor.destroy())
  it('selects the same rectangle when dragging in either direction', () => {
    const a = cells(rows(table)[1])[1], b = cells(rows(table)[3])[2]
    expect(rangeBetween(table, a, b)).toEqual(rangeBetween(table, b, a))
    expect(cellsInRange(table, rangeBetween(table, a, b))).toHaveLength(6)
  })
  it('column selection excludes a merged title that spans other columns', () => {
    expect(cellsInRange(table, { top: 0, bottom: 3, left: 1, right: 1 })).toHaveLength(3)
    expect(cellsInRange(table, { top: 0, bottom: 0, left: 0, right: 2 })).toHaveLength(1)
  })
  it('resizes only the chosen row and does not alter its text or other row sizes', () => {
    const row = rows(table)[2], before = row.toHTML()
    setRowHeight(table, row, 72)
    expect(row.getStyle().height).toBe('72px')
    expect(cells(row)[0].getStyle().height).toBe('72px')
    expect(rows(table)[3].getStyle().height).toBeUndefined()
    expect(row.toHTML()).toContain('>2<')
    expect(before).toContain('>2<')
    expect(table.getStyle().height).toBe('auto')
  })
  it('rejects invalid row height without partially changing the row', () => {
    const row = rows(table)[2]
    expect(() => setRowHeight(table, row, 0)).toThrow()
    expect(row.getStyle().height).toBeUndefined()
  })
})
