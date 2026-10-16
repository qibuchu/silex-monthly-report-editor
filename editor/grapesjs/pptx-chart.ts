export type ImportedChart = { title: string, categories: string[], series: { name: string, values: (number | null)[], color: string }[], type: 'line' | 'bar', stacked: boolean, minimum?: number, maximum?: number, legend: boolean }
const all = (e: ParentNode, name: string) => Array.from(e.querySelectorAll('*')).filter(n => n.localName === name)
const first = (e: ParentNode, name: string) => all(e, name)[0]
const value = (e: ParentNode, name: string) => first(e, name)?.getAttribute('val')
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]!))
function points(root?: Element) {
  if (!root) return []
  const count = Number(value(root, 'ptCount') || all(root, 'pt').length)
  const values = Array.from({ length: Math.min(2000, count) }, () => '')
  for (const point of all(root, 'pt')) {
    const index = Number(point.getAttribute('idx'))
    if (index >= 0 && index < values.length) values[index] = first(point, 'v')?.textContent || ''
  }
  return values
}
export function readImportedChart(document: Document, color: (element: Element | undefined, fallback: string) => string): ImportedChart | undefined {
  const plots = all(document, 'plotArea')[0]
  if (!plots) return
  const types = Array.from(plots.children).filter(n => n.localName.endsWith('Chart'))
  if (types.length !== 1 || !['lineChart', 'barChart'].includes(types[0].localName)) return
  if (types[0].localName === 'barChart' && value(types[0], 'barDir') !== 'col') return
  if (value(types[0], 'grouping') === 'percentStacked') return
  if (types[0].localName === 'lineChart' && value(types[0], 'grouping') === 'stacked') return
  const series = all(types[0], 'ser')
  const categories = points(series[0] && first(series[0], 'cat'))
  const cat = series[0] && first(series[0], 'cat')
  const categoryAxis = first(plots, 'catAx') || first(plots, 'dateAx')
  const categoryFormat = (categoryAxis && first(categoryAxis, 'numFmt')?.getAttribute('formatCode')) || (cat && first(cat, 'formatCode')?.textContent) || ''
  if (/[dm]/i.test(categoryFormat) && !/[hs]/i.test(categoryFormat)) categories.forEach((v, i) => {
    const serial = Number(v)
    if (!v || !Number.isFinite(serial) || serial < 1 || serial > 100000) return
    const date = new Date(Date.UTC(1899, 11, 30) + serial * 86400000)
    categories[i] = `${date.getUTCMonth() + 1}/${date.getUTCDate()}`
  })
  if (!categories.length) return
  const result: ImportedChart = {
    title: all(first(document, 'title') || document.createElement('empty'), 't').map(n => n.textContent || '').join(''),
    categories, type: types[0].localName === 'barChart' ? 'bar' : 'line', stacked: value(types[0], 'grouping') === 'stacked',
    legend: Boolean(first(document, 'legend')),
    series: series.map((s, index) => ({ name: first(first(s, 'tx') || s, 'v')?.textContent || `系列${index + 1}`, values: points(first(s, 'val')).map(v => v.trim() && Number.isFinite(Number(v)) ? Number(v) : null), color: color(first(s, 'spPr'), ['#002b5c', '#c89c4a', '#5a8a9a', '#da7755'][index % 4]) })),
  }
  const axis = first(plots, 'valAx')
  if (axis) {
    const min = value(axis, 'min'), max = value(axis, 'max')
    if (min !== undefined && Number.isFinite(Number(min))) result.minimum = Number(min)
    if (max !== undefined && Number.isFinite(Number(max))) result.maximum = Number(max)
  }
  if (!result.series.some(s => s.values.some(v => v !== null))) return
  if (result.stacked && result.series.some(s => s.values.some(v => v !== null && v < 0))) return
  return result
}
export function renderImportedChart(data: ImportedChart, width: number, height: number): string {
  if (!['line', 'bar'].includes(data.type) || !Array.isArray(data.categories) || !data.categories.length || data.categories.length > 2000 || !Array.isArray(data.series) || !data.series.length || data.series.length > 20) throw Error('图表需要1至20组系列和有效分类。')
  for (const series of data.series) if (!Array.isArray(series.values) || series.values.length !== data.categories.length || series.values.some(v => v !== null && (typeof v !== 'number' || !Number.isFinite(v)))) throw Error('每组数值数量须与分类一致；缺失值使用 null。')
  const w = Math.max(150, width), h = Math.max(120, height), font = Math.max(10, Math.min(22, h / 22))
  const left = font * 4, right = w - font, top = data.title ? font * 2.7 : font, bottom = h - font * (data.legend ? 4 : 2.2)
  const vals = data.series.flatMap(s => s.values.filter((v): v is number => v !== null))
  const totals = data.categories.map((_, i) => data.series.reduce((sum, s) => sum + Math.max(0, s.values[i] || 0), 0))
  const minimum = data.minimum ?? Math.min(0, ...vals)
  const maximum = data.maximum ?? Math.max(1, ...(data.stacked ? totals : vals)) * 1.1
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum <= minimum) throw Error('坐标轴最大值必须大于最小值。')
  const y = (v: number) => bottom - (v - minimum) / (maximum - minimum) * (bottom - top)
  const x = (i: number) => left + (right - left) * (data.type === 'bar' ? (i + .5) / data.categories.length : i / Math.max(1, data.categories.length - 1))
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(data.title || '导入图表')}" style="font-family:Arial,'Microsoft YaHei',sans-serif;font-size:${font}px">`]
  if (data.title) parts.push(`<text x="${w / 2}" y="${font * 1.3}" text-anchor="middle" fill="#444">${esc(data.title)}</text>`)
  for (let i = 0; i <= 5; i++) {
    const v = minimum + (maximum - minimum) * i / 5
    parts.push(`<line x1="${left}" y1="${y(v)}" x2="${right}" y2="${y(v)}" stroke="#d7dce1" stroke-width="1"/><text x="${left - 8}" y="${y(v) + font * .35}" text-anchor="end" fill="#666">${esc(Number(v.toPrecision(4)))}</text>`)
  }
  const stack = data.categories.map(() => 0)
  data.series.forEach((series, index) => {
    const c = /^#[a-f\d]{6}$/i.test(series.color) ? series.color : '#002b5c'
    if (data.type === 'line') {
      let path = '', drawing = false
      series.values.forEach((v, i) => { if (v === null) { drawing = false; return }; path += `${drawing ? 'L' : 'M'}${x(i)} ${y(v)} `; drawing = true })
      parts.push(`<path d="${path}" fill="none" stroke="${c}" stroke-width="2.5"/>`)
    } else {
      const step = (right - left) / data.categories.length, bw = step * .65 / (data.stacked ? 1 : data.series.length)
      series.values.forEach((v, i) => {
        if (v === null) return
        const base = data.stacked ? stack[i] : 0
        const xx = x(i) - step * .325 + (data.stacked ? 0 : index * bw)
        parts.push(`<rect x="${xx}" y="${Math.min(y(base + v), y(base))}" width="${bw}" height="${Math.abs(y(base + v) - y(base))}" fill="${c}"/>`)
        if (data.stacked) stack[i] += v
      })
    }
    if (data.legend) {
      const xx = left + index * (right - left) / data.series.length
      parts.push(`<rect x="${xx}" y="${h - font * 1.2}" width="${font}" height="${font * .5}" fill="${c}"/><text x="${xx + font * 1.4}" y="${h - font * .7}" fill="#555">${esc(series.name)}</text>`)
    }
  })
  const stride = Math.max(1, Math.ceil(data.categories.length / 18))
  data.categories.forEach((category, i) => { if (i % stride === 0) parts.push(`<text x="${x(i)}" y="${bottom + font * 1.5}" text-anchor="middle" fill="#666">${esc(category)}</text>`) })
  return parts.join('') + '</svg>'
}
