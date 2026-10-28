import fs from 'node:fs'
import { TextDecoder, TextEncoder } from 'node:util'
import { createRequire } from 'node:module'
import { parsePptxArchive } from './pptx-import'
Object.assign(globalThis, { TextDecoder, TextEncoder })
const { unzipSync } = createRequire(import.meta.url)('fflate')
const fixture = process.env.PPTX_ACCEPTANCE_FILE
;(fixture ? it : it.skip)('imports the real monthly deck without losing chart data or pages', () => {
  const parsed = parsePptxArchive(unzipSync(fs.readFileSync(fixture!)), 'real-monthly-acceptance')
  const objects: any[] = []
  const walk = (items: any[]) => items.forEach(item => { objects.push(item); if (Array.isArray(item.components)) walk(item.components) })
  parsed.slides.forEach(slide => walk(slide.components))
  expect(parsed.slides).toHaveLength(9)
  expect(objects.filter(o => o.attributes?.['data-pptx-kind'] === 'chart')).toHaveLength(5)
  const ids = objects.map(o => o.attributes?.['data-object-id']).filter(Boolean)
  expect(new Set(ids).size).toBe(ids.length)
  const stats = { pages: parsed.slides.length, width: parsed.width, height: parsed.height, kinds: objects.reduce((result, o) => { const k = o.attributes?.['data-pptx-kind']; if (k) result[k] = (result[k] || 0) + 1; return result }, {} as Record<string,number>), unsupported: parsed.slides.map(s => s.unsupported) }
  if (process.env.PPTX_ACCEPTANCE_OUTPUT) fs.writeFileSync(process.env.PPTX_ACCEPTANCE_OUTPUT, JSON.stringify(stats, null, 2))
}, 30000)
