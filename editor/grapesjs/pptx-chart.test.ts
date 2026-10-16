import { readImportedChart, renderImportedChart } from './pptx-chart'

describe('cached PowerPoint charts', () => {
  const xml = (body: string) => new DOMParser().parseFromString(`<c:chartSpace xmlns:c="chart" xmlns:a="draw"><c:chart><c:plotArea>${body}<c:valAx><c:scaling><c:min val="0"/><c:max val="100"/></c:scaling></c:valAx></c:plotArea><c:legend/></c:chart></c:chartSpace>`, 'application/xml')
  const series = '<c:ser><c:tx><c:v>收入</c:v></c:tx><c:cat><c:strCache><c:ptCount val="3"/><c:pt idx="0"><c:v>6月</c:v></c:pt><c:pt idx="1"><c:v>7月</c:v></c:pt><c:pt idx="2"><c:v>8月</c:v></c:pt></c:strCache></c:cat><c:val><c:numCache><c:ptCount val="3"/><c:pt idx="0"><c:v>30</c:v></c:pt><c:pt idx="2"><c:v>60</c:v></c:pt></c:numCache></c:val></c:ser>'
  it('keeps missing cached values as gaps and preserves axis bounds', () => {
    const data = readImportedChart(xml(`<c:lineChart>${series}</c:lineChart>`), (_, fallback) => fallback)!
    expect(data.series[0].values).toEqual([30, null, 60])
    expect(data.maximum).toBe(100)
    const doc = new DOMParser().parseFromString(renderImportedChart(data, 600, 300), 'image/svg+xml')
    expect(doc.querySelector('path')?.getAttribute('d')?.match(/M/g)).toHaveLength(2)
    expect(doc.querySelector('parsererror')).toBeNull()
  })
  it('renders cached stacked columns and escapes labels', () => {
    const data = readImportedChart(xml(`<c:barChart><c:barDir val="col"/><c:grouping val="stacked"/>${series}</c:barChart>`), (_, fallback) => fallback)!
    data.title = '<script>alert(1)</script>'
    const svg = renderImportedChart(data, 600, 300)
    expect(svg).toContain('&lt;script&gt;')
    expect(svg).not.toContain('<script>')
    expect(data.stacked).toBe(true)
    expect(() => renderImportedChart({ ...data, series: [{ ...data.series[0], values: [1] }] }, 600, 300)).toThrow()
    expect(readImportedChart(xml('<c:pieChart/>'), (_, fallback) => fallback)).toBeUndefined()
  })
})

it('formats explicitly declared date categories instead of showing Excel serial numbers', () => {
  const document = new DOMParser().parseFromString('<c:chartSpace xmlns:c="c"><c:plotArea><c:lineChart><c:ser><c:cat><c:numCache><c:formatCode>m/d</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>45292</c:v></c:pt><c:pt idx="1"><c:v>45293</c:v></c:pt></c:numCache></c:cat><c:val><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>3</c:v></c:pt><c:pt idx="1"><c:v>4</c:v></c:pt></c:numCache></c:val></c:ser></c:lineChart></c:plotArea></c:chartSpace>', 'application/xml')
  expect(readImportedChart(document, (_,fallback) => fallback)!.categories).toEqual(['1/1','1/2'])
})
