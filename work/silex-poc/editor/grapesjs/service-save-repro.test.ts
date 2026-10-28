import { jest } from '@jest/globals'
import fs from 'node:fs'
import path from 'node:path'
import { Buffer } from 'node:buffer'
import grapesjs from 'grapesjs'
import rateLimit from '@silexlabs/grapesjs-storage-rate-limit'

const fixture = process.env.SAVE_REPRO_FIXTURE
;(fixture ? describe : describe.skip)('full native project save regression', () => {
  it('serializes and stores the full native project', async () => {
    const value = JSON.parse(fs.readFileSync(path.resolve(fixture!), 'utf8'))
    window.history.replaceState({}, '', '/?serviceProject=repro')
    const request = jest.fn(async (_url: string, init?: RequestInit) => ({
      ok: true, json: async () => init?.method === 'PUT' ? { revision: 3 } : value,
    }))
    Object.assign(globalThis, { fetch: request, CSS: { escape: (v: string) => v } })
    const { attachServiceSync, loadServiceProject, storeServiceProject } = await import('./monthly-service-storage')
    const editor = grapesjs.init({ headless: true, storageManager: { autoload: false, autosave: false, type: 'connector' } })
    attachServiceSync(editor)
    editor.Storage.add('connector', { load: async () => loadServiceProject(editor), store: async data => storeServiceProject(editor, data) })
    rateLimit(editor, { time: 50 })
    try {
      const data = await loadServiceProject(editor)
      editor.loadProjectData(data)
      await editor.store()
      console.log('SAVE_BYTES', request.mock.calls.filter(call => call[1]?.method === 'PUT').map(call => String(call[1]?.body).length))
      expect(request.mock.calls.some(call => call[1]?.method === 'PUT')).toBe(true)
      for (const call of request.mock.calls.filter(call => call[1]?.method === 'PUT')) {
        expect(Buffer.byteLength(String(call[1]?.body))).toBeLessThan(180 * 1024 * 1024)
      }
    } finally { editor.destroy() }
  }, 60000)
})
