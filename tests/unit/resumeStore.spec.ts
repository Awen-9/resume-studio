import { createPinia, setActivePinia } from 'pinia'
import { useResumeStore } from '@/infrastructure/state/resumeStore'

describe('resume store undo/redo', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  const setup = async () => {
    const store = useResumeStore()
    await store.init()
    return store
  }

  /** 模拟一次编辑并触发自动保存。 */
  const edit = async (store: ReturnType<typeof useResumeStore>, name: string) => {
    store.currentDocument.profile.name = name
    await store.save()
  }

  it('walks back through several edits instead of toggling between two states', async () => {
    const store = await setup()
    const original = store.currentDocument.profile.name
    await edit(store, '甲')
    await edit(store, '乙')
    await edit(store, '丙')

    await store.undo()
    expect(store.currentDocument.profile.name).toBe('乙')
    await store.undo()
    expect(store.currentDocument.profile.name).toBe('甲')
    await store.undo()
    expect(store.currentDocument.profile.name).toBe(original)
    expect(store.canUndo).toBe(false)
  })

  it('redoes undone steps in order and clears redo after a new edit', async () => {
    const store = await setup()
    await edit(store, '甲')
    await edit(store, '乙')
    await store.undo()
    await store.undo()

    await store.redo()
    expect(store.currentDocument.profile.name).toBe('甲')
    await store.redo()
    expect(store.currentDocument.profile.name).toBe('乙')
    expect(store.canRedo).toBe(false)

    await store.undo()
    await edit(store, '丁')
    expect(store.canRedo).toBe(false)
  })

  it('undoes an edit that has not been saved yet', async () => {
    const store = await setup()
    await edit(store, '甲')
    store.currentDocument.profile.name = '未保存'
    await store.undo()
    expect(store.currentDocument.profile.name).toBe('甲')
    await store.redo()
    expect(store.currentDocument.profile.name).toBe('未保存')
  })

  it('does not record a step when saving without changes', async () => {
    const store = await setup()
    await store.save()
    await store.save()
    expect(store.canUndo).toBe(false)
  })

  it('merges rapid autosaves into one history version', async () => {
    const store = await setup()
    const before = store.history.length
    await edit(store, '甲')
    await edit(store, '乙')
    await edit(store, '丙')
    expect(store.history.length).toBeLessThanOrEqual(before + 1)

    await store.save(undefined, { checkpoint: true })
    expect(store.history.length).toBeGreaterThan(before)
  })
})
