import { createPinia, setActivePinia } from 'pinia'
import { useResumeStore } from '@/infrastructure/state/resumeStore'
import { listStoredDocuments } from '@/infrastructure/storage/indexedDbStorage'

/**
 * 编辑状态仓库的回归测试。
 *
 * 这里覆盖的是最容易出错、之前完全没有测试的那部分：撤销/重做的语义、
 * 删除最后一份简历后的空态、模块顺序，以及保存失败时不要把用户蒙在鼓里。
 */
describe('resume store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('starts empty and creates a document with the chosen template', async () => {
    const store = useResumeStore()
    await store.init()
    expect(store.isReady).toBe(true)
    expect(store.documents).toHaveLength(0)

    const id = await store.create('compact')
    expect(store.currentDocument.id).toBe(id)
    expect(store.currentDocument.theme.templateId).toBe('compact')
    expect(store.currentDocument.theme.pageMode).toBe('one-page-preferred')
    expect(store.documents).toHaveLength(1)
    expect(store.lastSavedAt).not.toBeNull()
  })

  it('undoes and redoes one save step at a time', async () => {
    const store = useResumeStore()
    const id = await store.create()
    await store.open(id)

    store.currentDocument.profile.name = '第一版'
    await store.save()
    store.currentDocument.profile.name = '第二版'
    await store.save()
    expect(store.canUndo).toBe(true)

    await store.undo()
    expect(store.currentDocument.profile.name).toBe('第一版')
    expect(store.canRedo).toBe(true)

    await store.redo()
    expect(store.currentDocument.profile.name).toBe('第二版')
    expect(store.canRedo).toBe(false)
  })

  it('keeps the save order stable when two saves land in the same millisecond', async () => {
    const store = useResumeStore()
    const id = await store.create()
    await store.open(id)
    // 连续保存不等待：两条历史记录的 createdAt 可能落在同一毫秒
    store.currentDocument.profile.name = 'A'
    await store.save()
    store.currentDocument.profile.name = 'B'
    await store.save()
    store.currentDocument.profile.name = 'C'
    await store.save()

    await store.undo()
    expect(store.currentDocument.profile.name).toBe('B')
    await store.undo()
    expect(store.currentDocument.profile.name).toBe('A')
  })

  it('duplicates the current document as an independent copy', async () => {
    const store = useResumeStore()
    const id = await store.create()
    await store.open(id)
    store.currentDocument.profile.name = '张三'
    await store.save()

    await store.duplicate()
    expect(store.currentDocument.id).not.toBe(id)
    expect(store.currentDocument.title).toContain('副本')
    expect(store.currentDocument.profile.name).toBe('张三')
    expect(store.documents).toHaveLength(2)
  })

  it('returns to an empty state after deleting the last document', async () => {
    const store = useResumeStore()
    const id = await store.create()
    await store.remove(id)
    expect(store.documents).toHaveLength(0)
    expect(store.currentId).toBeNull()
    // 不要偷偷再建一份「我的简历」
    expect(await listStoredDocuments()).toHaveLength(0)
  })

  it('restores a deleted document', async () => {
    const store = useResumeStore()
    const id = await store.create()
    await store.open(id)
    store.currentDocument.title = '要删掉的简历'
    await store.save()
    const snapshot = JSON.parse(
      JSON.stringify(store.currentDocument),
    ) as typeof store.currentDocument

    await store.remove(id)
    expect(store.documents).toHaveLength(0)

    await store.restoreDocument(snapshot)
    expect(store.documents).toHaveLength(1)
    expect(store.documents[0].title).toBe('要删掉的简历')
  })

  it('adds, reorders and removes sections', async () => {
    const store = useResumeStore()
    const id = await store.create()
    await store.open(id)
    const before = store.currentDocument.sections.length

    store.addSection('skills')
    expect(store.currentDocument.sections).toHaveLength(before + 1)
    const added = store.currentDocument.sections[store.currentDocument.sections.length - 1]
    expect(added.title).toBe('专业技能')

    store.moveSectionTo(added.id, 0)
    expect(store.currentDocument.sections[0].id).toBe(added.id)

    store.moveSection(added.id, 1)
    expect(store.currentDocument.sections[1].id).toBe(added.id)

    store.removeSection(added.id)
    expect(store.currentDocument.sections).toHaveLength(before)
  })

  it('surfaces a save failure instead of pretending it was saved', async () => {
    const store = useResumeStore()
    const id = await store.create()
    await store.open(id)
    const savedBefore = store.lastSavedAt
    const original = window.localStorage.setItem
    window.localStorage.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    try {
      store.currentDocument.profile.name = '写不进去'
      await store.save()
      expect(store.storageError).toContain('自动保存失败')
    } finally {
      window.localStorage.setItem = original
    }
    // 失败后不要误报「已保存」
    expect(store.lastSavedAt).toBe(savedBefore)
  })
})
