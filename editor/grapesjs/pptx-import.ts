import { Editor } from 'grapesjs'

export const cmdImportPptx = 'presentation:import-pptx'

const EMU_PER_POINT = 12700
const TARGET_WIDTH = 1920

type ZipFiles = Record<string, Uint8Array>

type ParsedSlide = {
  name: string
  components: any[]
  background: string
  unsupported: number
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
  return new Map(descendants(xml(files, relPath), 'Relationship').map(relation => [
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

function solidColor(element: ParentNode | undefined, fallback = ''): string {
  if (!element) return fallback
  const solid = first(element, 'solidFill')
  const srgb = solid && first(solid, 'srgbClr')
  return srgb ? `#${attr(srgb, 'val')}` : fallback
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

function objectStyle(element: Element, scale: number): Record<string, string> {
  const box = transform(element, scale)
  const shapeProperties = first(element, 'spPr')
  const line = shapeProperties && first(shapeProperties, 'ln')
  const fill = solidColor(shapeProperties)
  const lineColor = solidColor(line)
  return {
    position: 'absolute',
    'box-sizing': 'border-box',
    left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`,
    ...(box.rotation ? { transform: `rotate(${box.rotation}deg)` } : {}),
    ...(fill ? { background: fill } : {}),
    ...(lineColor ? { border: `${Math.max(1, numberAttr(line, 'w') * scale)}px solid ${lineColor}` } : {}),
    overflow: 'hidden',
  }
}

function shapeText(element: Element): { text: string, style: Record<string, string> } {
  const paragraphs = descendants(element, 'p')
  const text = paragraphs.map(paragraph => descendants(paragraph, 't').map(node => node.textContent || '').join('')).join('\n')
  const runProperties = first(element, 'rPr') || first(element, 'defRPr')
  const paragraphProperties = first(element, 'pPr')
  const size = numberAttr(runProperties, 'sz') / 100
  const color = solidColor(runProperties)
  const align = attr(paragraphProperties, 'algn')
  const alignMap: Record<string, string> = { ctr: 'center', just: 'justify', l: 'left', r: 'right' }
  return {
    text,
    style: {
      'white-space': 'pre-wrap',
      'line-height': '1.2',
      ...(size ? { 'font-size': `${size * 96 / 72}px` } : {}),
      ...(attr(runProperties, 'b') === '1' ? { 'font-weight': '700' } : {}),
      ...(attr(runProperties, 'i') === '1' ? { 'font-style': 'italic' } : {}),
      ...(color ? { color } : {}),
      ...(alignMap[align] ? { 'text-align': alignMap[align] } : {}),
    },
  }
}

function identity(element: Element, fallback: string) {
  const properties = first(element, 'cNvPr')
  return { sourceId: attr(properties, 'id', fallback), name: attr(properties, 'name', fallback) }
}

function safeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'pptx'
}

function shapeComponent(element: Element, scale: number, prefix: string, fallback: string) {
  const { sourceId, name } = identity(element, fallback)
  const value = shapeText(element)
  const id = `${prefix}-shape-${safeToken(sourceId)}`
  return {
    tagName: 'div', name,
    attributes: { id, 'data-object-id': id, 'data-pptx-kind': 'shape', 'data-pptx-source-id': sourceId },
    components: value.text,
    style: { ...objectStyle(element, scale), ...value.style },
  }
}

function pictureComponent(element: Element, scale: number, prefix: string, fallback: string, rels: Map<string, string>, files: ZipFiles) {
  const { sourceId, name } = identity(element, fallback)
  const blip = first(element, 'blip')
  const target = rels.get(attr(blip, 'embed'))
  const image = target && files[target]
  const id = `${prefix}-image-${safeToken(sourceId)}`
  return image ? {
    type: 'image', name,
    attributes: { id, src: dataUri(target!, image), alt: name, 'data-object-id': id, 'data-pptx-kind': 'image', 'data-pptx-source-id': sourceId },
    style: { ...objectStyle(element, scale), 'object-fit': 'fill' },
  } : unsupportedComponent(element, scale, prefix, fallback, '图片资源缺失')
}

function unsupportedComponent(element: Element, scale: number, prefix: string, fallback: string, label: string) {
  const { sourceId, name } = identity(element, fallback)
  const id = `${prefix}-unsupported-${safeToken(sourceId)}`
  const text = descendants(element, 't').map(node => node.textContent || '').join(' ').trim()
  return {
    tagName: 'div', name: `${label}：${name}`,
    attributes: { id, 'data-object-id': id, 'data-pptx-kind': 'unsupported', 'data-pptx-source-id': sourceId },
    components: text || label,
    style: {
      ...objectStyle(element, scale), display: 'flex', 'align-items': 'center', 'justify-content': 'center',
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
    const slide = xml(files, slidePath)
    const rels = relationships(files, slidePath)
    const shapeTree = first(slide, 'spTree')
    const prefix = `pptx-${safeToken(fileToken)}-slide-${slideIndex + 1}`
    const components: any[] = []
    let unsupported = 0
    children(shapeTree || slide.documentElement, 'sp').forEach((element, index) => components.push(shapeComponent(element, scale, prefix, `shape-${index + 1}`)))
    children(shapeTree || slide.documentElement, 'pic').forEach((element, index) => components.push(pictureComponent(element, scale, prefix, `image-${index + 1}`, rels, files)))
    ;['graphicFrame', 'grpSp', 'cxnSp'].forEach(localName => {
      children(shapeTree || slide.documentElement, localName).forEach((element, index) => {
        unsupported += 1
        components.push(unsupportedComponent(element, scale, prefix, `${localName}-${index + 1}`, localName === 'graphicFrame' ? '复杂对象（图表/表格/SmartArt）' : '复杂组合对象'))
      })
    })
    const title = components.find(component => component.attributes?.['data-pptx-kind'] === 'shape' && component.components)?.components
    return {
      name: title ? `PPT ${slideIndex + 1} · ${String(title).split('\n')[0].slice(0, 28)}` : `PPT ${slideIndex + 1}`, components,
      background: solidColor(first(slide, 'bg'), '#ffffff'), unsupported,
    }
  })
  return { width: TARGET_WIDTH, height, slides }
}

async function readPptx(file: File) {
  if (!/\.pptx$/i.test(file.name)) throw new Error('请选择 .pptx 格式文件。旧版 .ppt 请先在 PowerPoint 中另存为 .pptx。')
  if (file.size > 100 * 1024 * 1024) throw new Error('PPTX 文件超过 100MB，请先压缩图片或拆分文件。')
  const { unzipSync } = await import('fflate')
  const archive = unzipSync(new Uint8Array(await file.arrayBuffer()))
  return parsePptxArchive(archive, `${safeToken(file.name.replace(/\.pptx$/i, ''))}-${file.size}`)
}

function uniquePageId(editor: Editor, requested: string) {
  let id = requested
  let suffix = 2
  while (editor.Pages.get(id)) id = `${requested}-${suffix++}`
  return id
}

async function importPptx(editor: Editor, file: File, replacePages: boolean) {
  const parsed = await readPptx(file)
  if (!parsed.slides.length) throw new Error('PPTX 中没有可识别的幻灯片。')
  const oldPages = [...editor.Pages.getAll()]
  const imported = parsed.slides.map((slide, index) => {
    const pageId = uniquePageId(editor, `pptx-${safeToken(file.name.replace(/\.pptx$/i, ''))}-slide-${index + 1}`)
    return editor.Pages.add({
      id: pageId,
      name: `${index + 1} · ${slide.name}`,
      component: {
        tagName: 'body',
        components: [{
          tagName: 'section', name: slide.name,
          attributes: { id: `${pageId}-canvas`, 'data-pptx-page': String(index + 1), 'data-pptx-file': file.name },
          classes: ['slide', 'pptx-imported-slide'],
          components: slide.components,
          style: { position: 'relative', width: `${parsed.width}px`, height: `${parsed.height}px`, overflow: 'hidden', background: slide.background },
        }],
      },
    })
  })
  if (replacePages) oldPages.forEach(page => editor.Pages.remove(page))
  editor.Pages.select(imported[0])
  await editor.store()
  const unsupported = parsed.slides.reduce((sum, slide) => sum + slide.unsupported, 0)
  editor.runCommand('notifications:add', {
    type: unsupported ? 'warning' : 'success', group: 'PPTX 导入',
    message: `已导入 ${parsed.slides.length} 页。文字和图片可编辑${unsupported ? `；${unsupported} 个复杂对象已用占位框标记。` : '。'}`,
  })
}

function openImportDialog(editor: Editor) {
  const form = document.createElement('form')
  form.className = 'silex-pptx-import'
  form.innerHTML = `
    <style>
      .silex-pptx-import { min-width: 460px; display: grid; gap: 14px; color: #ddd; }
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
      <span class="silex-pptx-import__hint">文件只在本机浏览器中解析。文字框、图片、位置和基础样式会生成可编辑对象；图表、表格、SmartArt 和复杂组合暂以占位框标记。</span>
    </label>
    <label class="silex-pptx-import__mode"><input name="replace" type="checkbox">导入成功后替换当前全部页面</label>
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
      await importPptx(editor, file, (form.elements.namedItem('replace') as HTMLInputElement).checked)
      editor.Modal.close()
    } catch (error) {
      editor.runCommand('notifications:add', { type: 'error', group: 'PPTX 导入', message: error instanceof Error ? error.message : String(error) })
      submit.disabled = false
      submit.textContent = '识别并导入页面'
    }
  })
  editor.Modal.setTitle('上传并识别 PPT 页面')
  editor.Modal.setContent(form)
  editor.Modal.open()
}

export default function pptxImportPlugin(editor: Editor) {
  editor.Commands.add(cmdImportPptx, () => openImportDialog(editor))
  editor.Panels.addButton('options', {
    id: 'presentation-import-pptx', className: 'fa-solid fa-file-powerpoint', command: cmdImportPptx, togglable: false,
    attributes: { title: '上传 PPTX 并识别为可编辑页面', 'aria-label': '导入 PPTX 页面' },
  })
}
