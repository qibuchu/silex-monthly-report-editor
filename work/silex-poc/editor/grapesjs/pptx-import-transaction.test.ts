import { jest } from '@jest/globals'
import { createRequire } from 'node:module'
import { TextDecoder, TextEncoder } from 'node:util'
import { randomUUID } from 'node:crypto'
import grapesjs from 'grapesjs'
const zip = createRequire(import.meta.url)('fflate')
Object.assign(globalThis, { TextDecoder, TextEncoder })
Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: randomUUID })
jest.unstable_mockModule('fflate', () => ({ unzipSync: zip.unzipSync, unzip: zip.unzip }))
jest.unstable_mockModule('./monthly-service-storage', () => ({ serviceProjectId: null, serviceRequest: jest.fn() }))
const { importPptx } = await import('./pptx-import')
const archive = zip.zipSync(Object.fromEntries(Object.entries({
  'ppt/presentation.xml': '<p:presentation xmlns:p="p" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId r:id="slide"/></p:sldIdLst><p:sldSz cx="12192000" cy="9144000"/></p:presentation>',
  'ppt/_rels/presentation.xml.rels': '<Relationships><Relationship Id="slide" Target="slides/slide1.xml"/></Relationships>',
  'ppt/slides/slide1.xml': '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="1" name="标题"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="1000000"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>测试文字</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
}).map(([key, value]) => [key, zip.strToU8(value)])))
const file = { name: 'same.pptx', size: archive.byteLength, arrayBuffer: async () => archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) } as File
function setup() {
  const container = document.createElement('div'); document.body.append(container)
  const editor = grapesjs.init({ container, storageManager: false, panels: { defaults: [] } })
  editor.Commands.add('notifications:add', { run: () => {} })
  return { editor, close: () => { editor.destroy(); container.remove() } }
}
it('appends the same file twice with unique object IDs and preserves the 4:3 canvas', async () => {
  const { editor, close } = setup()
  try {
    jest.spyOn(editor, 'store').mockImplementation(async () => { editor.getModel().set('changesCount', 0); return editor.getProjectData() })
    await importPptx(editor, file, true)
    await importPptx(editor, file, false)
    expect(editor.Pages.getAll()).toHaveLength(2)
    const roots = editor.Pages.getAll().map(p => p.getMainComponent().components().at(0))
    expect(roots[0].getStyle().height).toBe('1440px')
    const ids = roots.map(root => root.components().at(0).getAttributes()['data-object-id'])
    expect(new Set(ids).size).toBe(2)
  } finally { close() }
})
it('restores the previous editable pages if the final save fails', async () => {
  const { editor, close } = setup()
  try {
    editor.Pages.getSelected()!.getMainComponent().components('<p>原人工内容</p>')
    editor.getModel().set('changesCount', 0)
    const oldId = editor.Pages.getSelected()!.getId()
    jest.spyOn(editor, 'store').mockRejectedValue(new Error('模拟保存失败'))
    await expect(importPptx(editor, file, true)).rejects.toThrow('模拟保存失败')
    expect(editor.Pages.getAll()).toHaveLength(1)
    expect(editor.Pages.getSelected()!.getId()).toBe(oldId)
    expect(editor.Pages.getSelected()!.getMainComponent().getInnerHTML()).toContain('原人工内容')
  } finally { close() }
})
