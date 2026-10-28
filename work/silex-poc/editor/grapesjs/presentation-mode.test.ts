import { parseTabularText } from './presentation-mode'

describe('presentation table data', () => {
  it('parses Excel-compatible tab and newline separated data', () => {
    expect(parseTabularText('排名\t游戏名\t收入\r\n1\tAPEX\t100万\r\n')).toEqual([
      ['排名', '游戏名', '收入'],
      ['1', 'APEX', '100万'],
    ])
  })

  it('preserves empty cells and ignores trailing blank lines', () => {
    expect(parseTabularText('A\t\tC\n\n')).toEqual([['A', '', 'C']])
  })

  it('returns no rows for empty input', () => {
    expect(parseTabularText('')).toEqual([])
  })
})
