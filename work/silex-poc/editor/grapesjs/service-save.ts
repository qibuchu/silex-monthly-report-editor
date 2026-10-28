import { Editor, ProjectData } from 'grapesjs'

/** A service save resolves only after persistence, and never clears edits made in flight. */
export function createServiceSaver(editor: Editor, persist: (data: ProjectData) => Promise<void>) {
  let pending: Promise<ProjectData> | undefined
  let generation = 0
  let savedGeneration = -1
  editor.on('update', () => { generation++ })

  const save = (): Promise<ProjectData> => {
    if (pending) return pending.then(() => generation === savedGeneration ? editor.getProjectData() : save())
    const operation = async () => {
      let data: ProjectData | undefined
      try {
        data = editor.getProjectData() // Also synchronizes an active rich text editor.
        const started = generation
        editor.trigger('storage:start', data)
        editor.trigger('storage:start:store', data)
        await persist(data)
        savedGeneration = started
        if (generation === started) editor.clearDirtyCount()
        editor.trigger('storage:store', data)
        editor.trigger('storage:end:store', data)
        editor.trigger('storage:end', data)
        return data
      } catch (error) {
        editor.trigger('storage:error:store', error)
        editor.trigger('storage:error', error, 'store')
        editor.trigger('storage:end', data)
        throw error
      }
    }
    pending = operation().finally(() => { pending = undefined })
    return pending
  }
  return save
}
