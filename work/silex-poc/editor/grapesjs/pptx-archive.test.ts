import { jest } from '@jest/globals'
import { createRequire } from 'node:module'
import { TextEncoder, TextDecoder } from 'node:util'
Object.assign(globalThis, { TextEncoder, TextDecoder })
const {zipSync,strToU8,unzipSync,unzip}=createRequire(import.meta.url)('fflate')
jest.unstable_mockModule('fflate',()=>({unzipSync,unzip}))
const {checkPptxArchive,unzipPptx}=await import('./pptx-archive')

it('checks directory sizes before inflation and extracts valid archives', async () => {
  const bytes = zipSync({ 'ppt/presentation.xml': new Uint8Array(strToU8('<presentation/>')) })
  expect(() => checkPptxArchive(bytes)).not.toThrow()
  const result = await unzipPptx(bytes)
  expect(Object.keys(unzipSync(bytes))).toEqual(['ppt/presentation.xml'])
  expect(Object.keys(result)).toEqual(['ppt/presentation.xml'])
  expect(result['ppt/presentation.xml']).toEqual(strToU8('<presentation/>'))
  const modified = bytes.slice()
  const view = new DataView(modified.buffer)
  for (let i = 0; i < modified.length - 24; i++) if (view.getUint32(i, true) === 0x02014b50) {
    view.setUint32(i + 24, 251 * 1024 * 1024, true)
    break
  }
  expect(() => checkPptxArchive(modified)).toThrow('250MB')
})
