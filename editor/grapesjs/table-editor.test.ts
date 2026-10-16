import grapesjs, { Editor, Component } from 'grapesjs'
import { changeColumn, changeRow, columnCount, getColumnWidths, setColumnWidths, descendants, writeCellText, pasteCells, matchCellTextStyle, upgradeCellText } from './table-editor'

describe('table structure editing', () => {
  let editor: Editor, table: Component
  beforeEach(() => {
    document.body.innerHTML = '<div id="editor"></div>'
    editor = grapesjs.init({ container: '#editor', storageManager: false })
    table = editor.addComponents('<table style="width:600px;height:180px"><colgroup><col style="width:20%"><col style="width:50%"><col style="width:30%"></colgroup><tbody><tr><td colspan="3">榜单</td></tr><tr><th>排名</th><th>游戏</th><th>收入</th></tr><tr style="height:36px"><td>1</td><td data-appid="42">完整游戏名称</td><td>100万</td></tr></tbody></table>')[0]
  })
  afterEach(() => editor.destroy())
  it('deletes the logical column and repairs merged title and colgroup without changing table width', () => {
    changeColumn(table, 1, false)
    expect(columnCount(table)).toBe(2)
    expect(descendants(table).filter(c => c.get('tagName') === 'tr')[0].components().at(0).getAttributes().colspan).toBe(2)
    expect(descendants(table).filter(c => c.get('tagName') === 'col')).toHaveLength(2)
    expect(getColumnWidths(table)).toEqual([40, 60])
    expect(table.getStyle().width).toBe('600px')
    expect(descendants(table).filter(c => c.get('tagName') === 'tr')[2].components().map(c => c.toHTML())).toEqual(expect.arrayContaining([expect.stringContaining('100万')]))
  })
  it('inserts blank cells and retains app identity on existing cells', () => {
    changeColumn(table, 2, true)
    expect(columnCount(table)).toBe(4)
    expect(descendants(table).filter(c => c.get('tagName') === 'tr')[2].components().at(1).getAttributes()['data-appid']).toBe('42')
    expect(descendants(table).filter(c => c.get('tagName') === 'tr')[2].components().at(2).getAttributes()['data-appid']).toBeUndefined()
  })
  it('deleting rows collapses table height and leaves remaining row sizes intact', () => {
    changeRow(table, descendants(table).filter(c => c.get('tagName') === 'tr')[1], false)
    expect(descendants(table).filter(c => c.get('tagName') === 'tr')).toHaveLength(2)
    expect(table.getStyle().height).toBe('auto')
    expect(descendants(table).filter(c => c.get('tagName') === 'tr')[1].getStyle().height).toBe('36px')
  })
  it('normalizes widths and rejects invalid values before changing the model', () => {
    setColumnWidths(table, [1, 2, 1])
    expect(getColumnWidths(table)).toEqual([25, 50, 25])
    expect(() => setColumnWidths(table, [0, 2, 1])).toThrow()
    expect(getColumnWidths(table)).toEqual([25, 50, 25])
  })
  it('protects rowspan tables and the last column', () => {
    descendants(table).filter(c => c.get('tagName') === 'tr')[2].components().at(0).addAttributes({ rowspan: 2 })
    expect(() => changeColumn(table, 1, false)).toThrow('跨行')
    expect(columnCount(table)).toBe(3)
  })
  it('extends a merged title when appending the final column', () => {
    changeColumn(table, 3, true)
    expect(columnCount(table)).toBe(4)
    const title = descendants(table).filter(c => c.get('tagName') === 'tr')[0]
    expect(title.components()).toHaveLength(1)
    expect(title.components().at(0).getAttributes().colspan).toBe(4)
  })
  it('replaces all rich text runs and escapes text instead of inserting markup', () => {
    const cell = descendants(table).filter(c => c.get('tagName') === 'tr')[2].components().at(1)
    cell.components('<span>第一段</span><span>第二段</span>')
    writeCellText(cell, '<简称>')
    expect(cell.toHTML()).toContain('&lt;简称&gt;')
    expect(cell.toHTML()).not.toContain('第二段')
    expect(cell.getAttributes()['data-appid']).toBe('42')
  })
  it('pastes rectangular data without deleting unaffected cells', () => {
    const row = descendants(table).filter(c => c.get('tagName') === 'tr')[2]
    pasteCells(table, row, 1, [['简称', '200万'], ['新游戏', '300万']])
    expect(descendants(table).filter(c => c.get('tagName') === 'tr')).toHaveLength(4)
    expect(row.components().at(0).toHTML()).toContain('1')
    expect(row.components().at(2).toHTML()).toContain('200万')
  })
  it('empty cells inherit same-column body typography without picking the header', () => {
    const list = descendants(table).filter(c => c.get('tagName') === 'tr')
    list[1].components().at(1).components('<span style="font-size:30px;font-weight:700">游戏</span>')
    const filled = list[2].components().at(1)
    filled.components('<p style="color:#002b5c;text-align:center"><span style="font-family:SimSun;font-size:21px;font-weight:400">游戏甲</span></p>')
    changeRow(table, list[2], true)
    const blank = descendants(table).filter(c => c.get('tagName') === 'tr')[3].components().at(1)
    blank.components('<p></p>')
    writeCellText(blank, '新名称')
    const appearance = blank.components().at(0).getStyle()
    expect(appearance['font-size']).toBe('21px')
    expect(appearance['font-family']).toBe('SimSun')
    expect(appearance['font-weight']).toBe('400')
    expect(appearance.color).toBe('#002b5c')
    expect(appearance['text-align']).toBe('center')
  })
  it('preserves explicit formatting on an empty cell instead of borrowing a neighboring color', () => {
    const blank = descendants(table).filter(c => c.get('tagName') === 'tr')[2].components().at(1)
    blank.components('<p style="font-size:24px;color:#cd9d40;font-weight:700"></p>')
    writeCellText(blank, '强调')
    const appearance = blank.components().at(0).getStyle()
    expect(appearance['font-size']).toBe('24px')
    expect(appearance.color).toBe('#cd9d40')
    expect(appearance['font-weight']).toBe('700')
  })
  it('can repair previously entered text styling without replacing its content or identity', () => {
    const row = descendants(table).filter(c => c.get('tagName') === 'tr')[2]
    row.components().at(1).components('<span style="font-family:SimSun;font-size:21px;font-weight:400;color:#002b5c">参考</span>')
    changeRow(table, row, true)
    const target = descendants(table).filter(c => c.get('tagName') === 'tr')[3].components().at(1)
    target.components('<div style="font-size:16px;font-weight:700">已填简称</div>')
    target.addAttributes({ 'data-appid': '888' })
    matchCellTextStyle(target)
    expect(target.components().at(0).getStyle()['font-size']).toBe('21px')
    expect(target.components().at(0).getStyle()['font-weight']).toBe('400')
    expect(target.toHTML()).toContain('已填简称')
    expect(target.getAttributes()['data-appid']).toBe('888')
  })
  it('creates editable text components for manual and pasted input', () => {
    const cell = descendants(table).filter(c => c.get('tagName') === 'tr')[2].components().at(1)
    writeCellText(cell, '可双击修改')
    expect(cell.components().at(0).get('type')).toBe('text')
    expect(cell.components().at(0).get('editable')).toBe(true)
  })
  it('upgrades old manual wrappers without altering rich text or saved styling', () => {
    const cell = descendants(table).filter(c => c.get('tagName') === 'tr')[2].components().at(1)
    cell.components([{ type: 'default', tagName: 'div', attributes: { title: '旧文字', id: 'oldtext' }, style: { 'font-size': '21px', color: '#002b5c' }, components: [{ type: 'textnode', content: '旧文字' }] }])
    upgradeCellText(cell)
    const child = cell.components().at(0)
    expect(child.get('type')).toBe('text')
    expect(child.getAttributes().id).toBe('oldtext')
    expect(child.getStyle()['font-size']).toBe('21px')
    expect(child.toHTML()).toContain('旧文字')
    cell.components('<div title="原模板"><p><span>原模板</span></p></div>')
    const original = cell.toHTML()
    upgradeCellText(cell)
    expect(cell.toHTML()).toBe(original)
  })
})

