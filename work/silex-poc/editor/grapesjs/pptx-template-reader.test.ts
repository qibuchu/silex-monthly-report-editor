import { TextDecoder, TextEncoder } from 'node:util'
import { jest } from '@jest/globals'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { readPptxTemplate } from './pptx-template-reader'

Object.assign(globalThis, { TextDecoder, TextEncoder })
Object.assign(crypto, { randomUUID })
const { zipSync, strToU8, unzipSync, unzip } = createRequire(import.meta.url)('fflate')
jest.unstable_mockModule('fflate', () => ({ unzipSync, unzip }))
const xml = {
  'ppt/presentation.xml': '<p:presentation xmlns:p="p" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId r:id="r1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>',
  'ppt/_rels/presentation.xml.rels': '<Relationships><Relationship Id="r1" Target="slides/slide1.xml"/></Relationships>',
  'ppt/slides/slide1.xml': '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="月份标题"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="100" y="100"/><a:ext cx="6096000" cy="685800"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>2026年8月月报</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="装饰"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="10000" cy="10000"/></a:xfrm><a:solidFill><a:srgbClr val="003366"/></a:solidFill></p:spPr></p:sp></p:spTree></p:cSld></p:sld>',
}
it('turns PPT into editable canonical pages without a running editor, preserving layout and safe layers', async () => {
  const bytes = zipSync(Object.fromEntries(Object.entries(xml).map(([k, v]) => [k, new Uint8Array(strToU8(v))])))
  const file = { name: '月报.pptx', size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } as File
  const project = await readPptxTemplate(file)
  expect(project.format).toBe('steam-grapesjs-v2')
  expect(project.deck.pages[0].width).toBe(1920)
  expect(project.deck.pages[0].objects[0].content).toContain('2026年8月月报')
  expect(project.deck.pages[0].objects[0].attributes['data-content-layer']).toBe('manual')
  expect(project.deck.pages[0].objects[1].attributes['data-content-layer']).toBe('template')
  expect(project.deck.notes.pptx_imports[0].filename).toBe('月报.pptx')
  expect(new Set(project.deck.pages[0].objects.map(o => o.attributes['data-object-id'])).size).toBe(2)
  await expect(readPptxTemplate({ ...file, name: '旧月报.ppt' } as File)).rejects.toThrow('.pptx')
})

