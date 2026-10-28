import { Editor, Component } from 'grapesjs'
import { readImportedChart, renderImportedChart, ImportedChart } from './pptx-chart'

export const cmdImportPptx = 'presentation:import-pptx'

const EMU_PER_POINT = 12700
const TARGET_WIDTH = 1920

type ZipFiles = Record<string, Uint8Array>

type ParsedSlide = {
  name: string
  components: any[]
  background: string
  unsupported: number
  warnings?: string[]
}

function xml(files: ZipFiles, path: string): Document {
  const value = files[path]
  if (!value) throw new Error(`PPTX 缺少文件：${path}`)
  const document = new DOMParser().parseFromString(new TextDecoder().decode(value), 'application/xml')
  const parserError = document.querySelector('parsererror')
  if (parserError) throw new Error(`无法解析 PPTX XML：${path}`)
  return document
}

function children(element: Element, localName: string): Element[] {
  return Array.from(element.children).filter(child => child.localName === localName)
}

function first(element: ParentNode, localName: string): Element | undefined {
  return Array.from(element.querySelectorAll('*')).find(node => node.localName === localName)
}

function descendants(element: ParentNode, localName: string): Element[] {
  return Array.from(element.querySelectorAll('*')).filter(node => node.localName === localName)
}

function attr(element: Element | undefined, name: string, fallback = ''): string {
  if (!element) return fallback
  return element.getAttribute(name)
    || Array.from(element.attributes).find(item => item.localName === name)?.value
    || fallback
}

function numberAttr(element: Element | undefined, name: string, fallback = 0): number {
  if (!attr(element, name)) return fallback
  const value = Number(attr(element, name))
  return Number.isFinite(value) ? value : fallback
}

function relationshipId(element: Element): string {
  return element.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
    || Array.from(element.attributes).find(item => item.prefix === 'r' && item.localName === 'id')?.value
    || ''
}

function resolvePath(baseFile: string, target: string): string {
  if (target.startsWith('/')) return target.replace(/^\//, '')
  const segments = `${baseFile.slice(0, baseFile.lastIndexOf('/') + 1)}${target}`.split('/')
  const normalized: string[] = []
  segments.forEach(segment => {
    if (!segment || segment === '.') return
    if (segment === '..') normalized.pop()
    else normalized.push(segment)
  })
  return normalized.join('/')
}

function relationships(files: ZipFiles, sourcePath: string): Map<string, string> {
  const slash = sourcePath.lastIndexOf('/')
  const relPath = `${sourcePath.slice(0, slash + 1)}_rels/${sourcePath.slice(slash + 1)}.rels`
  if (!files[relPath]) return new Map()
  return new Map(descendants(xml(files, relPath), 'Relationship').filter(relation => attr(relation, 'TargetMode') !== 'External').map(relation => [
    attr(relation, 'Id'),
    resolvePath(sourcePath, attr(relation, 'Target')),
  ]))
}

function mimeType(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase()
  return ({
    bmp: 'image/bmp', emf: 'image/emf', gif: 'image/gif', jpeg: 'image/jpeg', jpg: 'image/jpeg',
    png: 'image/png', svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff', webp: 'image/webp', wmf: 'image/wmf',
  } as Record<string, string>)[extension || ''] || 'application/octet-stream'
}

function dataUri(path: string, value: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < value.length; index += chunk) {
    binary += String.fromCharCode(...value.subarray(index, index + chunk))
  }
  return `data:${mimeType(path)};base64,${btoa(binary)}`
}

type Theme = { colors: Record<string, string>, major: string, minor: string }
const direct = (element: ParentNode | undefined, name: string) => element && Array.from(element.children).find(e => e.localName === name)
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]!))
function resolvedColor(element: ParentNode | undefined, fallback = '', theme?: Theme): string {
  if (!element) return fallback
  const c = Array.from(element.children).find(n => ['srgbClr', 'schemeClr', 'sysClr'].includes(n.localName))
  if (!c) return fallback
  const hex = c.localName === 'schemeClr' ? theme?.colors[attr(c, 'val')] : attr(c, c.localName === 'sysClr' ? 'lastClr' : 'val')
  if (!hex || !/^[a-f\d]{6}$/i.test(hex)) return fallback
  let rgb = [0, 2, 4].map(i => Number.parseInt(hex.slice(i, i + 2), 16)), alpha = 1
  for (const mod of Array.from(c.children)) {
    const value = numberAttr(mod, 'val') / 100000
    if (['lumMod', 'shade'].includes(mod.localName)) rgb = rgb.map(v => v * value)
    if (mod.localName === 'lumOff') rgb = rgb.map(v => v + 255 * value)
    if (mod.localName === 'tint') rgb = rgb.map(v => v + (255 - v) * value)
    if (mod.localName === 'alpha') alpha = value
  }
  rgb = rgb.map(v => Math.max(0, Math.min(255, Math.round(v))))
  return alpha < 1 ? `rgba(${rgb.join(',')},${alpha})` : '#'+rgb.map(v => v.toString(16).padStart(2, '0')).join('')
}
function solidColor(element: ParentNode | undefined, fallback = '', theme?: Theme): string {
  return resolvedColor(direct(element, 'solidFill'), fallback, theme)
}
function fill(element: ParentNode | undefined, theme?: Theme): string {
  if (direct(element, 'noFill')) return 'transparent'
  const solid = solidColor(element, '', theme)
  if (solid) return solid
  const gradient = direct(element, 'gradFill')
  if (gradient) {
    const stops = descendants(gradient, 'gs').map(gs => `${resolvedColor(gs, '#ffffff', theme)} ${numberAttr(gs, 'pos') / 1000}%`)
    if (stops.length) return `linear-gradient(${numberAttr(first(gradient, 'lin'), 'ang') / 60000 + 90}deg,${stops.join(',')})`
  }
  return ''
}
function themeFor(files: ZipFiles, chain: string[]): Theme {
  const colors: Record<string, string> = { dk1: '000000', lt1: 'ffffff', dk2: '1f497d', lt2: 'eeeeee', accent1: '002b5c', accent2: 'c89c4a' }
  const themePath = chain.flatMap(n => [...relationships(files, n).values()]).find(n => /\/theme\//.test(n))
  let major = 'Microsoft YaHei', minor = major
  if (themePath && files[themePath]) {
    const doc = xml(files, themePath), scheme = first(doc, 'clrScheme')
    for (const item of Array.from(scheme?.children || [])) colors[item.localName] = attr(item.children[0], 'lastClr', attr(item.children[0], 'val'))
    for (const [name, set] of [['majorFont', (v: string) => { major = v }], ['minorFont', (v: string) => { minor = v }]] as const) {
      const font = first(doc, name)
      const face = font && (attr(first(font, 'ea'), 'typeface') || attr(descendants(font, 'font').find(f => attr(f, 'script') === 'Hans'), 'typeface') || attr(first(font, 'latin'), 'typeface'))
      if (face) set(face)
    }
  }
  Object.assign(colors, { bg1: colors.lt1, bg2: colors.lt2, tx1: colors.dk1, tx2: colors.dk2 })
  for (const file of [...chain].reverse()) {
    const map = first(xml(files, file), 'overrideClrMapping') || first(xml(files, file), 'clrMap')
    if (map) for (const a of Array.from(map.attributes)) if (colors[a.value]) colors[a.localName] = colors[a.value]
  }
  return { colors, major, minor }
}
function transform(element: Element, scale: number) {
  const xfrm = first(element, 'xfrm')
  const off = xfrm && first(xfrm, 'off')
  const ext = xfrm && first(xfrm, 'ext')
  const rotation = numberAttr(xfrm, 'rot') / 60000
  return {
    left: numberAttr(off, 'x') * scale,
    top: numberAttr(off, 'y') * scale,
    width: Math.max(1, numberAttr(ext, 'cx', 914400) * scale),
    height: Math.max(1, numberAttr(ext, 'cy', 914400) * scale),
    rotation,
  }
}

function objectStyle(element: Element, scale: number, theme?: Theme): Record<string, string> {
  const box = transform(element, scale)
  const shapeProperties = first(element, 'spPr')
  const line = direct(shapeProperties, 'ln')
  const background = fill(shapeProperties, theme) || resolvedColor(first(element, 'fillRef'), '', theme)
  const lineColor = direct(line, 'noFill') ? '' : solidColor(line, '', theme)
  return {
    position: 'absolute',
    'box-sizing': 'border-box',
    left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`,
    ...((box.rotation || attr(first(element, 'xfrm'), 'flipH') === '1' || attr(first(element, 'xfrm'), 'flipV') === '1') ? { transform: `${box.rotation ? `rotate(${box.rotation}deg)` : ''} ${attr(first(element, 'xfrm'), 'flipH') === '1' ? 'scaleX(-1)' : ''} ${attr(first(element, 'xfrm'), 'flipV') === '1' ? 'scaleY(-1)' : ''}`.trim() } : {}),
    ...(background ? { background } : {}),
    ...(attr(first(shapeProperties || element, 'prstGeom'), 'prst') === 'roundRect' ? { 'border-radius': `${Math.min(box.width, box.height) * .16}px` } : {}),
    ...(attr(first(shapeProperties || element, 'prstGeom'), 'prst') === 'ellipse' ? { 'border-radius': '50%' } : {}),
    ...(lineColor ? { border: `${Math.max(1, numberAttr(line, 'w') * scale)}px solid ${lineColor}` } : {}),
    overflow: 'hidden',
  }
}

function runStyle(properties: Element | undefined, scale: number, theme?: Theme): Record<string, string> {
  if (!properties) return {}
  const face = attr(first(properties, 'ea'), 'typeface') || attr(first(properties, 'latin'), 'typeface')
  const font = face.startsWith('+mj') ? theme?.major : face.startsWith('+mn') ? theme?.minor : face
  return {
    ...(font ? { 'font-family': `"${font.replace(/['"<>]/g, '')}","Microsoft YaHei",sans-serif` } : {}),
    ...(attr(properties, 'sz') ? { 'font-size': `${numberAttr(properties, 'sz') / 100 * EMU_PER_POINT * scale}px` } : {}),
    ...(attr(properties, 'b') ? { 'font-weight': attr(properties, 'b') === '1' ? '700' : '400' } : {}),
    ...(attr(properties, 'i') ? { 'font-style': attr(properties, 'i') === '1' ? 'italic' : 'normal' } : {}),
    ...(attr(properties, 'u') ? { 'text-decoration': attr(properties, 'u') === 'none' ? 'none' : 'underline' } : {}),
    ...(attr(properties, 'spc') ? { 'letter-spacing': `${numberAttr(properties, 'spc') / 100 * EMU_PER_POINT * scale}px` } : {}),
    ...(solidColor(properties, '', theme) ? { color: solidColor(properties, '', theme) } : {}),
  }
}
const css = (style: Record<string, string>) => Object.entries(style).map(([k,v]) => `${k}:${v}`).join(';')
function shapeText(element: Element, scale: number, theme?: Theme): { text: string, html: string, style: Record<string, string> } {
  const body = first(element, 'txBody') || element
  const paragraphs = children(body, 'p'), bodyPr = direct(body, 'bodyPr')
  const style: Record<string, string> = { 'white-space': 'pre-wrap', 'line-height': '1.2', 'font-family': `"${theme?.minor || 'Microsoft YaHei'}",sans-serif` }
  const output = paragraphs.map(paragraph => {
    const pp = direct(paragraph, 'pPr'), level = numberAttr(pp, 'lvl') + 1
    const defaults = { ...runStyle(first(first(body, 'lvl'+level+'pPr') || body, 'defRPr'), scale, theme), ...runStyle(direct(pp, 'defRPr'), scale, theme) }
    const align: Record<string,string> = { ctr: 'center', l: 'left', r: 'right', just: 'justify' }
    const ps: Record<string,string> = { margin: '0', 'min-height': '1em', ...defaults }
    if (align[attr(pp, 'algn')]) ps['text-align'] = align[attr(pp, 'algn')]
    const spacing = pp && first(pp, 'lnSpc'), pct = spacing && first(spacing, 'spcPct'), pts = spacing && first(spacing, 'spcPts')
    if (pct) ps['line-height'] = String(numberAttr(pct, 'val') / 100000)
    if (pts) ps['line-height'] = `${numberAttr(pts, 'val') / 100 * EMU_PER_POINT * scale}px`
    for (const [node, prop] of [['spcBef', 'margin-top'], ['spcAft', 'margin-bottom']]) {
      const space = pp && first(pp, node), val = space?.children[0]
      if (val) ps[prop] = val.localName === 'spcPts' ? `${numberAttr(val, 'val') / 100 * EMU_PER_POINT * scale}px` : `${numberAttr(val, 'val') / 100000}em`
    }
    if (attr(pp, 'marL')) ps['padding-left'] = `${numberAttr(pp, 'marL') * scale}px`
    if (attr(pp, 'indent')) ps['text-indent'] = `${numberAttr(pp, 'indent') * scale}px`
    const bullet = attr(pp && first(pp, 'buChar'), 'char')
    const runs = Array.from(paragraph.children).map(run => {
      if (run.localName === 'br') return '<br>'
      if (!['r','fld'].includes(run.localName)) return ''
      const rs = runStyle(direct(run, 'rPr'), scale, theme)
      return `<span style="${escapeHtml(css(rs))}">${escapeHtml(first(run, 't')?.textContent || '')}</span>`
    }).join('')
    return `<p style="${escapeHtml(css(ps))}">${bullet ? escapeHtml(bullet)+' ' : ''}${runs || '<br>'}</p>`
  }).join('')
  Object.assign(style, runStyle(first(element, 'defRPr'), scale, theme))
  if (bodyPr) {
    style.padding = ['tIns','rIns','bIns','lIns'].map(k => `${numberAttr(bodyPr, k, k === 'lIns' || k === 'rIns' ? 91440 : 45720) * scale}px`).join(' ')
    if (attr(bodyPr, 'anchor') === 'ctr' || attr(bodyPr, 'anchor') === 'b') Object.assign(style, { display: 'flex', 'flex-direction': 'column', 'justify-content': attr(bodyPr, 'anchor') === 'b' ? 'flex-end' : 'center' })
    if (attr(bodyPr, 'wrap') === 'none') style['white-space'] = 'pre'
  }
  return { text: paragraphs.map(p => descendants(p, 't').map(n => n.textContent || '').join('')).join('\n'), html: output, style }
}
function tableComponent(element: Element, scale: number, prefix: string, fallback: string, theme?: Theme) {
  const table = first(element, 'tbl')!
  const { sourceId, name } = identity(element, fallback)
  const id = `${prefix}-table-${safeToken(sourceId)}`
  const grid = first(table, 'tblGrid')
  const widths = grid ? children(grid, 'gridCol').map(column => numberAttr(column, 'w') * scale) : []
  return {
    tagName: 'table', name, attributes: { id, 'data-object-id': id, 'data-pptx-kind': 'table' },
    style: { ...objectStyle(element, scale, theme), 'border-collapse': 'collapse', 'table-layout': 'fixed' },
    components: [{ tagName: 'tbody', components: children(table, 'tr').map((row, rowIndex) => ({
      tagName: 'tr', style: { height: `${numberAttr(row, 'h') * scale}px` },
      components: children(row, 'tc').flatMap((cell, index) => {
        if (attr(cell, 'hMerge') === '1' || attr(cell, 'vMerge') === '1') return []
        const properties = first(cell, 'tcPr')
        const text = shapeText(cell, scale, theme)
        const height = children(table, 'tr').slice(rowIndex, rowIndex + numberAttr(cell, 'rowSpan', 1)).reduce((sum, r) => sum + numberAttr(r, 'h') * scale, 0)
        const padding = ['marT','marR','marB','marL'].map(k => numberAttr(properties, k, k === 'marL' || k === 'marR' ? 91440 : 45720) * scale)
        return [{ tagName: 'td', attributes: { colspan: attr(cell, 'gridSpan', '1'), rowspan: attr(cell, 'rowSpan', '1') },
          components: [{ type: 'text', tagName: 'div', components: text.html, style: { ...text.style, padding: '0', height: `${Math.max(1, height - padding[0] - padding[2] - 2)}px`, 'max-height': `${Math.max(1, height - padding[0] - padding[2] - 2)}px`, overflow: 'hidden' } }], style: { width: `${widths.slice(index, index + numberAttr(cell, 'gridSpan', 1)).reduce((sum, n) => sum + n, 0) || 100}px`,
            height: `${height}px`, padding: padding.map(n => `${n}px`).join(' '), 'box-sizing': 'border-box', 'vertical-align': 'middle', border: '1px solid #d9d9d9',
            ...(solidColor(properties, '', theme) ? { background: solidColor(properties, '', theme) } : {}) } }]
      }),
    })) }],
  }
}

function treeComponents(tree: Element, scale: number, prefix: string, rels: Map<string, string>, files: ZipFiles, theme?: Theme): { components: any[], unsupported: number } {
  let unsupported = 0
  const components = Array.from(tree.children).flatMap<any>((element, index) => {
    const fallback = `${element.localName}-${index + 1}`
    if (element.localName === 'sp') return [shapeComponent(element, scale, prefix, fallback, theme)]
    if (element.localName === 'pic') {
      const picture = pictureComponent(element, scale, prefix, fallback, rels, files, theme)
      if (picture.attributes['data-pptx-kind'] === 'unsupported') unsupported += 1
      return [picture]
    }
    if (element.localName === 'graphicFrame' && first(element, 'tbl')) return [tableComponent(element, scale, prefix, fallback, theme)]
    if (element.localName === 'grpSp') {
      const { sourceId, name } = identity(element, fallback)
      const id = `${prefix}-group-${safeToken(sourceId)}`
      const nested = treeComponents(element, scale, prefix, rels, files, theme)
      unsupported += nested.unsupported
      const xfrm = first(element, 'xfrm')
      const off = xfrm && first(xfrm, 'chOff')
      const ext = xfrm && first(xfrm, 'chExt')
      const box = transform(element, scale)
      const sx = box.width / (numberAttr(ext, 'cx', box.width / scale) * scale || 1)
      const sy = box.height / (numberAttr(ext, 'cy', box.height / scale) * scale || 1)
      nested.components.forEach(child => {
        const style = child.style
        style.left = `${(Number.parseFloat(style.left) - numberAttr(off, 'x') * scale) * sx}px`
        style.top = `${(Number.parseFloat(style.top) - numberAttr(off, 'y') * scale) * sy}px`
        style.width = `${Number.parseFloat(style.width) * sx}px`
        style.height = `${Number.parseFloat(style.height) * sy}px`
      })
      return [{ tagName: 'div', name, attributes: { id, 'data-object-id': id, 'data-pptx-kind': 'group' },
        components: nested.components, style: { ...objectStyle(element, scale, theme), overflow: 'visible' } }]
    }
    if (element.localName === 'graphicFrame' && first(element, 'chart')) {
      const target = rels.get(relationshipId(first(element, 'chart')!))
      const chart = target && files[target] && readImportedChart(xml(files, target), (el, fallback) => solidColor(el, solidColor(el && first(el, 'ln'), fallback, theme), theme))
      if (chart) {
        const box = transform(element, scale), { sourceId, name } = identity(element, fallback)
        return [{ tagName: 'div', name, attributes: { id: `${prefix}-chart-${sourceId}`, 'data-object-id': `${prefix}-chart-${sourceId}`, 'data-pptx-kind': 'chart', 'data-kind': 'chart', 'data-pptx-chart': JSON.stringify(chart) }, style: objectStyle(element, scale, theme), components: renderImportedChart(chart, box.width, box.height) }]
      }
    }
    if (element.localName === 'cxnSp') {
      const box = transform(element, scale), { sourceId, name } = identity(element, fallback), line = first(element, 'ln')
      const color = solidColor(line, '#666666', theme)
      const path = attr(first(element, 'prstGeom'), 'prst') === 'bentConnector3' ? `M0 0 H${box.width / 2} V${box.height} H${box.width}` : `M0 0 L${box.width} ${box.height}`
      return [{ tagName: 'div', name, attributes: { id: `${prefix}-line-${sourceId}`, 'data-object-id': `${prefix}-line-${sourceId}`, 'data-pptx-kind': 'line' }, style: { ...objectStyle(element, scale, theme), background: 'transparent', overflow: 'visible' }, components: `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 ${box.width} ${box.height}" style="overflow:visible"><path d="${path}" fill="none" stroke="${color}" stroke-width="${Math.max(1, numberAttr(line, 'w', 12700) * scale)}"/></svg>` }]
    }
    if (['graphicFrame', 'cxnSp'].includes(element.localName)) {
      unsupported += 1
      return [unsupportedComponent(element, scale, prefix, fallback, element.localName === 'graphicFrame' ? '待识别图表/SmartArt' : '待识别连接线')]
    }
    return []
  })
  return { components, unsupported }
}

function identity(element: Element, fallback: string) {
  const properties = first(element, 'cNvPr')
  return { sourceId: attr(properties, 'id', fallback), name: attr(properties, 'name', fallback) }
}

function safeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'pptx'
}

function shapeComponent(element: Element, scale: number, prefix: string, fallback: string, theme?: Theme) {
  const { sourceId, name } = identity(element, fallback)
  const value = shapeText(element, scale, theme)
  const id = `${prefix}-shape-${safeToken(sourceId)}`
  return {
    type: value.text ? 'text' : 'default', tagName: 'div', name,
    attributes: { id, 'data-object-id': id, 'data-pptx-kind': 'shape', 'data-pptx-source-id': sourceId },
    components: value.html,
    style: { ...objectStyle(element, scale, theme), ...value.style },
  }
}

function pictureComponent(element: Element, scale: number, prefix: string, fallback: string, rels: Map<string, string>, files: ZipFiles, theme?: Theme) {
  const { sourceId, name } = identity(element, fallback)
  const blip = first(element, 'blip')
  const target = rels.get(attr(blip, 'embed'))
  const image = target && files[target]
  const id = `${prefix}-image-${safeToken(sourceId)}`
  if (!image) return unsupportedComponent(element, scale, prefix, fallback, '图片资源缺失')
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp'].includes(mimeType(target!))) return unsupportedComponent(element, scale, prefix, fallback, '不支持的图片格式，请在PPT中转为PNG')
  const source = dataUri(target!, image), crop = first(element, 'srcRect')
  if (crop) {
    const [left, top, right, bottom] = ['l','t','r','b'].map(k => numberAttr(crop, k) / 100000)
    const sx = 1 / Math.max(.01, 1 - left - right), sy = 1 / Math.max(.01, 1 - top - bottom)
    return { tagName: 'div', name, attributes: { id, 'data-object-id': id, 'data-pptx-kind': 'image' }, style: objectStyle(element, scale, theme), components: [{ type: 'image', attributes: { src: source, alt: name }, style: { position: 'absolute', left: `${-left * sx * 100}%`, top: `${-top * sy * 100}%`, width: `${sx * 100}%`, height: `${sy * 100}%`, 'object-fit': 'fill' } }] }
  }
  return { type: 'image', name, attributes: { id, src: source, alt: name, 'data-object-id': id, 'data-pptx-kind': 'image', 'data-pptx-source-id': sourceId }, style: { ...objectStyle(element, scale, theme), 'object-fit': 'fill' } }
}

function unsupportedComponent(element: Element, scale: number, prefix: string, fallback: string, label: string, theme?: Theme) {
  const { sourceId, name } = identity(element, fallback)
  const id = `${prefix}-unsupported-${safeToken(sourceId)}`
  const text = descendants(element, 't').map(node => node.textContent || '').join(' ').trim()
  return {
    tagName: 'div', name: `${label}：${name}`,
    attributes: { id, 'data-object-id': id, 'data-pptx-kind': 'unsupported', 'data-pptx-source-id': sourceId },
    components: text || label,
    style: {
      ...objectStyle(element, scale, theme), display: 'flex', 'align-items': 'center', 'justify-content': 'center',
      padding: '12px', color: '#7a5414', background: 'rgba(255, 244, 204, .75)', border: '2px dashed #d6a43c',
      'font-size': '18px', 'text-align': 'center',
    },
  }
}

export function parsePptxArchive(files: ZipFiles, fileToken = 'pptx'): { width: number, height: number, slides: ParsedSlide[] } {
  const presentationPath = 'ppt/presentation.xml'
  const presentation = xml(files, presentationPath)
  const size = first(presentation, 'sldSz')
  const sourceWidth = numberAttr(size, 'cx', 12192000)
  const sourceHeight = numberAttr(size, 'cy', 6858000)
  const scale = TARGET_WIDTH / sourceWidth
  const height = sourceHeight * scale
  const presentationRels = relationships(files, presentationPath)
  const slidePaths = descendants(presentation, 'sldId')
    .map(slide => presentationRels.get(relationshipId(slide)))
    .filter((path): path is string => Boolean(path))

  const slides = slidePaths.map((slidePath, slideIndex): ParsedSlide => {
    const slide = xml(files, slidePath), rels = relationships(files, slidePath)
    const layoutPath = [...rels.values()].find(n => n.includes('/slideLayouts/'))
    const masterPath = layoutPath && [...relationships(files, layoutPath).values()].find(n => n.includes('/slideMasters/'))
    const chain = [slidePath, layoutPath, masterPath].filter((n): n is string => Boolean(n && files[n]))
    const theme = themeFor(files, chain), prefix = `pptx-${safeToken(fileToken)}-slide-${slideIndex + 1}`
    const shapeTree = first(slide, 'spTree') || slide.documentElement
    // Fill only missing placeholder geometry/defaults; slide content remains authoritative.
    for (const shape of Array.from(shapeTree.children)) {
      const placeholder = first(shape, 'ph')
      if (!placeholder) continue
      for (const inheritedPath of chain.slice(1)) {
        const inherited = descendants(xml(files, inheritedPath), 'sp').find(candidate => {
          const ph = first(candidate, 'ph')
          return ph && attr(ph, 'idx', '0') === attr(placeholder, 'idx', '0') && attr(ph, 'type', 'body') === attr(placeholder, 'type', 'body')
        })
        if (!inherited) continue
        const targetProperties = direct(shape, 'spPr'), inheritedProperties = direct(inherited, 'spPr')
        if (targetProperties && inheritedProperties) for (const item of Array.from(inheritedProperties.children)) {
          if (!direct(targetProperties, item.localName)) targetProperties.appendChild(slide.importNode(item, true))
        }
        const targetBody = direct(shape, 'txBody'), inheritedBody = direct(inherited, 'txBody')
        if (targetBody && inheritedBody) for (const name of ['bodyPr','lstStyle']) {
          const own = direct(targetBody, name), source = direct(inheritedBody, name)
          if (!source) continue
          if (!own) targetBody.appendChild(slide.importNode(source, true))
          else if (name === 'bodyPr') for (const a of Array.from(source.attributes)) { if (!own.hasAttribute(a.name)) own.setAttribute(a.name, a.value) }
          else if (!own.children.length) for (const item of Array.from(source.children)) own.appendChild(slide.importNode(item, true))
        }
      }
    }
    const components: any[] = [], warnings: string[] = []
    let unsupported = 0
    if (attr(slide.documentElement, 'showMasterSp', '1') !== '0') for (const ref of chain.slice(1).reverse()) {
      const document = xml(files, ref), tree = first(document, 'spTree')
      if (!tree) continue
      const layer = document.createElement('inherited')
      for (const element of Array.from(tree.children)) if (!first(element, 'ph')) layer.appendChild(element.cloneNode(true))
      const result = treeComponents(layer, scale, `${prefix}-${ref.includes('Masters') ? 'master' : 'layout'}`, relationships(files, ref), files, theme)
      components.push(...result.components); unsupported += result.unsupported
    }
    const result = treeComponents(shapeTree, scale, prefix, rels, files, theme)
    components.push(...result.components); unsupported += result.unsupported
    let background = '#ffffff'
    for (const ref of chain) {
      const bg = first(xml(files, ref), 'bg')
      const value = bg && (fill(first(bg, 'bgPr'), theme) || resolvedColor(first(bg, 'bgRef'), '', theme))
      if (value) { background = value; break }
    }
    if (unsupported) warnings.push(`${unsupported}个复杂对象使用占位框`)
    warnings.push('字体使用本机可用字体；未自动嵌入字体文件')
    const title = components.find(component => component.attributes?.['data-pptx-kind'] === 'shape' && typeof component.components === 'string' && component.components.replace(/<[^>]*>/g, '').trim())?.components
    return { name: title ? `PPT ${slideIndex + 1} · ${String(title).replace(/<[^>]*>/g, '').slice(0, 28)}` : `PPT ${slideIndex + 1}`, components, background, unsupported, warnings }
  })
  return { width: TARGET_WIDTH, height, slides }
}

export async function readPptx(file: File) {
  if (!/\.pptx$/i.test(file.name)) throw new Error('请选择 .pptx 格式文件。旧版 .ppt 请先在 PowerPoint 中另存为 .pptx。')
  if (file.size > 100 * 1024 * 1024) throw new Error('PPTX 文件超过 100MB，请先压缩图片或拆分文件。')
  const { unzipPptx } = await import('./pptx-archive')
  const archive = await unzipPptx(new Uint8Array(await file.arrayBuffer()))
  return parsePptxArchive(archive, crypto.randomUUID())
}

function uniquePageId(editor: Editor, requested: string) {
  let id = requested
  let suffix = 2
  while (editor.Pages.get(id)) id = `${requested}-${suffix++}`
  return id
}

async function materializeImages(components: any[], progress: (message: string) => void) {
  const { serviceProjectId, serviceRequest } = await import('./monthly-service-storage')
  if (!serviceProjectId) return
  const images: any[] = []
  const walk = (items: any[]) => items.forEach(component => {
    if (component.attributes?.src?.startsWith('data:image/')) images.push(component)
    if (Array.isArray(component.components)) walk(component.components)
  })
  walk(components)
  const cache = new Map<string,string>()
  for (const [index, image] of images.entries()) {
    progress(`保存图片资源 ${index + 1} / ${images.length}…`)
    const source = image.attributes.src
    if (!cache.has(source)) cache.set(source, (await serviceRequest('assets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: source }) })).src)
    image.attributes.src = cache.get(source)
  }
}
export async function importPptx(editor: Editor, file: File, replacePages: boolean, progress: (message: string) => void = () => {}) {
  progress('正在解析页面与对象…')
  const parsed = await readPptx(file)
  if (!parsed.slides.length) throw new Error('PPTX 中没有可识别的幻灯片。')
  await materializeImages(parsed.slides.flatMap(s => s.components), progress)
  // First commit any existing manual work. Page addition itself must save atomically.
  if (editor.getDirtyCount() > 0) await editor.store()
  const before = editor.getProjectData(), auto = editor.StorageManager.isAutosave()
  const oldReports = editor.getModel().get('pptxImportReports')
  editor.StorageManager.setAutosave(false)
  try {
    const oldPages = [...editor.Pages.getAll()]
    const imported = parsed.slides.map((slide, index) => {
      const pageId = uniquePageId(editor, `pptx-${safeToken(file.name.replace(/\.pptx$/i, ''))}-slide-${index + 1}`)
      return editor.Pages.add({ id: pageId, name: `${index + 1} · ${slide.name}`, component: {
        tagName: 'body', components: [{ tagName: 'section', name: slide.name,
          attributes: { id: `${pageId}-canvas`, 'data-pptx-page': String(index + 1), 'data-pptx-file': file.name },
          classes: ['slide', 'pptx-imported-slide'], components: slide.components,
          style: { position: 'relative', width: `${parsed.width}px`, height: `${parsed.height}px`, overflow: 'hidden', background: slide.background },
        }],
      } })
    })
    if (replacePages) oldPages.forEach(page => editor.Pages.remove(page))
    editor.Pages.select(imported[0]!)
    const report = { filename: file.name, importedAt: new Date().toISOString(), width: parsed.width, height: parsed.height, pages: parsed.slides.map(s => ({ name: s.name, objects: s.components.length, unsupported: s.unsupported, warnings: s.warnings })) }
    editor.getModel().set('pptxImportReports', [...(oldReports || []), report])
    progress('正在保存完整项目…')
    await editor.store()
    const unsupported = parsed.slides.reduce((sum, slide) => sum + slide.unsupported, 0)
    editor.runCommand('notifications:add', { type: unsupported ? 'warning' : 'success', group: 'PPTX 导入', message: `已导入并保存 ${parsed.slides.length} 页。文字、图片、表格可编辑；常见柱状/折线图可选中后编辑数据。${unsupported ? `${unsupported}个复杂对象保留占位。` : ''}字体使用本机字体，版式仍需视觉检查。` })
    return report
  } catch (error) {
    editor.loadProjectData(before)
    editor.getModel().set('pptxImportReports', oldReports)
    throw error
  } finally { editor.StorageManager.setAutosave(auto) }
}
function editImportedChart(editor: Editor) {
  let component = editor.getSelected()
  while (component && !component.getAttributes()['data-pptx-chart']) component = component.parent()
  if (!component) throw new Error('请先选中一个导入的柱状图或折线图。')
  const target = component, form = document.createElement('form'), area = document.createElement('textarea'), status = document.createElement('p')
  area.value = JSON.stringify(JSON.parse(String(target.getAttributes()['data-pptx-chart'])), null, 2)
  area.rows = 18; area.style.width = '100%'; area.setAttribute('aria-label', '图表数据JSON')
  const label = document.createElement('p'); label.textContent = '修改分类、系列数值和颜色；缺失值填 null，保存后重绘。'
  const button = document.createElement('button'); button.type = 'submit'; button.textContent = '保存图表数据'
  form.append(label, area, button, status)
  form.onsubmit = event => {
    event.preventDefault()
    try {
      const value = JSON.parse(area.value) as ImportedChart, style = target.getStyle()
      const html = renderImportedChart(value, Number.parseFloat(String(style.width)) || 600, Number.parseFloat(String(style.height)) || 300)
      target.components(html); target.addAttributes({ 'data-pptx-chart': JSON.stringify(value) }); editor.Modal.close()
    } catch (error) { status.textContent = error instanceof Error ? error.message : String(error) }
  }
  const container = document.createElement('div')
  container.append(form)
  editor.Modal.open({ title: '编辑导入图表数据', content: container })
}

function openImportDialog(editor: Editor) {
  const form = document.createElement('form')
  form.className = 'silex-pptx-import'
  form.innerHTML = `
    <style>
      .silex-pptx-import { width: min(560px,80vw); display: flex; flex-direction: column; gap: 14px; color: #ddd; }
      .silex-pptx-import__drop { display: grid; gap: 8px; padding: 20px; border: 1px dashed #6889a9; border-radius: 6px; background: #262d35; }
      .silex-pptx-import__hint { color: #aeb8c2; font-size: 12px; line-height: 1.6; }
      .silex-pptx-import__mode { display: flex; gap: 8px; align-items: center; }
      .silex-pptx-import__actions { display: flex; justify-content: flex-end; gap: 8px; }
      .silex-pptx-import button { padding: 9px 16px; border: 0; border-radius: 4px; cursor: pointer; }
      .silex-pptx-import__submit { color: white; background: #2878bd; }
    </style>
    <label class="silex-pptx-import__drop">
      <strong>选择 PowerPoint 文件</strong>
      <input name="pptx" type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" required>
      <span class="silex-pptx-import__hint">支持文字分段样式、主题色、母版背景、图片裁切、表格和常见柱状/折线图。文件在浏览器解析，图片保存到当前项目服务；不支持的复杂对象保留占位。字体使用本机可用字体，导入后请检查版式。</span>
    </label>
    <label class="silex-pptx-import__mode"><input name="replace" type="checkbox">导入成功后替换当前全部页面</label>
    <p role="status" aria-live="polite" data-import-status></p>
    <div class="silex-pptx-import__actions">
      <button type="button" data-action="cancel">取消</button>
      <button class="silex-pptx-import__submit" type="submit">识别并导入页面</button>
    </div>`
  form.querySelector('[data-action="cancel"]')?.addEventListener('click', () => editor.Modal.close())
  form.addEventListener('submit', async event => {
    event.preventDefault()
    const input = form.elements.namedItem('pptx') as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    const submit = form.querySelector('[type="submit"]') as HTMLButtonElement
    submit.disabled = true
    submit.textContent = '正在识别…'
    try {
      await importPptx(editor, file, (form.elements.namedItem('replace') as HTMLInputElement).checked, message => { form.querySelector('[data-import-status]')!.textContent = message })
      editor.Modal.close()
    } catch (error) {
      editor.runCommand('notifications:add', { type: 'error', group: 'PPTX 导入', message: error instanceof Error ? error.message : String(error) })
      submit.disabled = false
      submit.textContent = '识别并导入页面'
    }
  })
  editor.Modal.setTitle('上传并识别 PPT 页面')
  const container = document.createElement('div')
  container.append(form)
  editor.Modal.setContent(container)
  editor.Modal.open()
}

export default function pptxImportPlugin(editor: Editor) {
  // HTML table layout otherwise expands rows to fit long names and pushes footers away.
  const normalizeTables = () => {
    const visit = (component: Component) => {
      if (component.getAttributes()['data-pptx-kind'] === 'table') {
        component.set('tagName', 'table')
        for (const body of component.components().models) for (const row of body.components().models) {
          const height = Number.parseFloat(String(row.getStyle().height))
          if (!height) continue
          for (const cell of row.components().models) {
            if (Number(cell.getAttributes().rowspan) > 1) continue
            cell.addStyle({ height: `${height}px`, 'box-sizing': 'border-box' })
            for (const text of cell.components().models) if (text.get('tagName') === 'div') text.addStyle({ height: `${Math.max(1, height - 12)}px`, 'max-height': `${Math.max(1, height - 12)}px`, overflow: 'hidden', padding: '0' })
          }
        }
      }
      component.components().forEach(visit)
    }
    editor.Pages.getAll().forEach(page => visit(page.getMainComponent()))
  }
  editor.on('project:load', () => requestAnimationFrame(normalizeTables))
  editor.Commands.add(cmdImportPptx, () => openImportDialog(editor))
  editor.Commands.add('presentation:edit-imported-chart', () => { try { editImportedChart(editor) } catch (error) { editor.runCommand('notifications:add', { type: 'warning', group: '图表', message: String(error) }) } })
  editor.Panels.addButton('options', { id: 'edit-imported-chart', className: 'fa-solid fa-chart-simple', command: 'presentation:edit-imported-chart', togglable: false, attributes: { title: '编辑导入图表数据', 'aria-label': '编辑导入图表数据' } })
  editor.Panels.addButton('options', {
    id: 'presentation-import-pptx', className: 'fa-solid fa-file-powerpoint', command: cmdImportPptx, togglable: false,
    attributes: { title: '上传 PPTX 并识别为可编辑页面', 'aria-label': '导入 PPTX 页面' },
  })
}
