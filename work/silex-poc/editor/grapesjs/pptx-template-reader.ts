import '~/editor/browser-compat'
import { readPptx } from './pptx-import'

// Reuse the editor importer, without loading the editor or uploading a raw PPT.
function markup(component: any): string {
  if (typeof component === 'string') return component
  const tag = component.tagName || (component.type === 'image' ? 'img' : 'div')
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(component.attributes || {})) el.setAttribute(key, String(value))
  if (component.classes?.length) el.setAttribute('class', component.classes.map((c: any) => typeof c === 'string' ? c : c.name).join(' '))
  for (const [key, value] of Object.entries(component.style || {})) el.style.setProperty(key, String(value))
  el.innerHTML = typeof component.components === 'string' ? component.components : (component.components || []).map(markup).join('')
  return el.outerHTML
}

export async function readPptxTemplate(file: File) {
  const parsed = await readPptx(file)
  if (!parsed.slides.length) throw new Error('PPTX 中没有可识别的页面。')
  const report = { filename: file.name, importedAt: new Date().toISOString(), width: parsed.width, height: parsed.height,
    pages: parsed.slides.map(s => ({ name: s.name, objects: s.components.length, unsupported: s.unsupported, warnings: s.warnings })) }
  return { format: 'steam-grapesjs-v2', current: 0, deck: { css: '.object{box-sizing:border-box}.object p{margin:0}', notes: { pptx_imports: [report], template_origin: 'pptx' }, pages: parsed.slides.map((slide, pageIndex) => ({
    name: slide.name, width: parsed.width, height: parsed.height, background: slide.background,
    objects: slide.components.map((component, index) => {
      const attrs = component.attributes || {}, id = attrs['data-object-id'] || `pptx-${pageIndex}-${index}`
      const image = component.type === 'image' || component.tagName === 'img'
      const imageWrapper = attrs['data-pptx-kind'] === 'image'
      const content = image ? markup({ ...component, style: { width: '100%', height: '100%', 'object-fit': component.style?.['object-fit'] || 'contain' } })
        : typeof component.components === 'string' ? component.components : (component.components || []).map(markup).join('')
      const text = document.createElement('div'); text.innerHTML = content
      const kind = image || imageWrapper ? 'image' : attrs['data-pptx-kind'] === 'table' ? 'table' : attrs['data-pptx-kind'] === 'group' ? 'container' : text.textContent?.trim() || text.querySelector('img,svg') ? 'text' : 'shape'
      return { type: 'report-object', tagName: image ? 'div' : component.tagName || 'div', classes: ['object'],
        attributes: { ...attrs, 'data-object-id': id, 'data-name': component.name || attrs['data-name'] || id, 'data-kind': kind,
          'data-content-layer': kind === 'shape' ? 'template' : 'manual', 'data-refresh-policy': 'preserve' }, style: component.style || {}, content }
    }),
  })) } }
}

Object.assign(window, { MonthlyPptx: { read: readPptxTemplate } })
