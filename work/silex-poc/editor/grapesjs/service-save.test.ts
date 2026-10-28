import { jest } from '@jest/globals'
import type { Editor } from 'grapesjs'
import { createServiceSaver } from './service-save'

function harness() {
  const handlers = new Map<string, Array<(...args: any[]) => void>>()
  let text = 'before'
  const clearDirtyCount = jest.fn()
  const editor = {
    on: (name: string, fn: (...args: any[]) => void) => { handlers.set(name, [...(handlers.get(name) || []), fn]) },
    trigger: (name: string, ...args: any[]) => { handlers.get(name)?.forEach(fn => fn(...args)) },
    getProjectData: jest.fn(() => ({ text })), clearDirtyCount,
  } as unknown as Editor
  const edit = (value: string) => { text = value; editor.trigger('update') }
  return { editor, edit, clearDirtyCount }
}

describe('durable monthly service saving', () => {
  it('keeps export waiting until the server confirms persistence', async () => {
    const { editor } = harness()
    let finish!: () => void
    const save = createServiceSaver(editor, () => new Promise<void>(resolve => { finish = resolve }))
    let completed = false
    const promise = save().then(() => { completed = true })
    await Promise.resolve()
    expect(completed).toBe(false)
    finish()
    await promise
    expect(completed).toBe(true)
  })

  it('retains dirty edits on failure and allows a successful retry', async () => {
    const { editor, clearDirtyCount } = harness()
    const persist = jest.fn<() => Promise<void>>().mockRejectedValueOnce(new Error('HTTP 413')).mockResolvedValue(undefined)
    const save = createServiceSaver(editor, persist)
    await expect(save()).rejects.toThrow('HTTP 413')
    expect(clearDirtyCount).not.toHaveBeenCalled()
    await save()
    expect(persist).toHaveBeenCalledTimes(2)
    expect(clearDirtyCount).toHaveBeenCalledTimes(1)
  })

  it('does not clear edits made during a write; concurrent save persists them next', async () => {
    const { editor, edit, clearDirtyCount } = harness()
    let finish!: () => void
    const persist = jest.fn<() => Promise<void>>()
      .mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
      .mockResolvedValue(undefined)
    const save = createServiceSaver(editor, persist)
    const first = save()
    edit('operator edit during request')
    const second = save()
    finish()
    await first
    expect(clearDirtyCount).not.toHaveBeenCalled()
    await second
    expect(persist.mock.calls[1][0]).toEqual({ text: 'operator edit during request' })
    expect(clearDirtyCount).toHaveBeenCalledTimes(1)
  })

  it('unlocks after a serialization error and reports failure', async () => {
    const { editor } = harness()
    let errors = 0
    editor.on('storage:error:store', () => errors++)
    const serialize = editor.getProjectData as ReturnType<typeof jest.fn>
    serialize.mockImplementationOnce(() => { throw new Error('serialization failed') })
    const save = createServiceSaver(editor, async () => {})
    await expect(save()).rejects.toThrow('serialization failed')
    await save()
    expect(errors).toBe(1)
  })
})
