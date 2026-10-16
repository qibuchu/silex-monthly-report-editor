import grapesjs from 'grapesjs'
import pptxImportPlugin, { cmdImportPptx } from './pptx-import'
it('keeps the entire upload form in the modal, including mode and submit controls', () => {
  const container = document.createElement('div'); document.body.append(container)
  const editor = grapesjs.init({ container, storageManager: false, panels: { defaults: [] } })
  try {
    pptxImportPlugin(editor)
    editor.runCommand(cmdImportPptx)
    const form = document.querySelector('.silex-pptx-import') as HTMLFormElement
    expect(form).not.toBeNull()
    expect(form.querySelector('input[name="replace"]')).not.toBeNull()
    expect(form.querySelector('button[type="submit"]')?.textContent).toBe('识别并导入页面')
    expect(form.textContent).toContain('主题色')
  } finally { editor.destroy(); container.remove() }
})
