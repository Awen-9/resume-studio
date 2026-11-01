import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { createDefaultDocument, createId } from '@/domain/resume/defaults'
import { cloneResume } from '@/domain/resume/validation'
import {
  deleteStoredDocument,
  listDocumentHistory,
  listStoredDocuments,
  loadStoredDocument,
  saveStoredDocument,
} from '@/infrastructure/storage/indexedDbStorage'
import type {
  ResumeDocument,
  ResumeSection,
  ResumeSummary,
  SectionType,
  TemplateId,
} from '@/domain/resume/model'

/** 撤销栈最多保留的步数。 */
const MAX_UNDO_STEPS = 100

/** 比较两份文档的内容是否相同，忽略保存时间。 */
const sameContent = (left: ResumeDocument, right: ResumeDocument): boolean => {
  return JSON.stringify({ ...left, updatedAt: '' }) === JSON.stringify({ ...right, updatedAt: '' })
}

/**
 * 编辑状态仓库（Pinia）。
 *
 * 集中管理简历目录、当前编辑文档、历史版本与撤销/重做快照，
 * 所有持久化读写都委托给 {@link indexedDbStorage}，不在此处直接操作 IndexedDB。
 *
 * 撤销/重做使用内存中的快照栈，与持久化的历史版本相互独立：
 * 每次保存当前文档时，若内容有变化，就把上一次保存的状态压入撤销栈。
 * 历史版本只用于跨会话恢复，自动保存会按时间窗口合并，避免挤掉有用的版本。
 */
export const useResumeStore = defineStore('resume', () => {
  const documents = ref<ResumeSummary[]>([])
  const currentDocument = ref<ResumeDocument>(createDefaultDocument())
  const currentId = ref<string | null>(null)
  const isReady = ref(false)
  const lastSavedAt = ref<string | null>(null)
  const history = ref<ResumeDocument[]>([])
  const undoStack = ref<ResumeDocument[]>([])
  const redoStack = ref<ResumeDocument[]>([])
  /** 最近一次保存或打开时的文档状态，用作下一步撤销的目标。 */
  let baseline: ResumeDocument | null = null
  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)

  const currentTitle = computed(() => currentDocument.value.title)

  const refreshCatalog = async (): Promise<void> => {
    documents.value = await listStoredDocuments()
  }

  const init = async (): Promise<void> => {
    await refreshCatalog()
    const first = documents.value[0]
    if (first) await open(first.id)
    else {
      const fresh = createDefaultDocument()
      await save(fresh)
      await open(fresh.id)
    }
    isReady.value = true
  }

  /** 把当前文档相对上次保存的变化记为一步撤销，返回是否有变化。 */
  const recordChange = (): boolean => {
    const snapshot = cloneResume(currentDocument.value)
    if (!baseline || sameContent(baseline, snapshot)) return false
    undoStack.value = [...undoStack.value, baseline].slice(-MAX_UNDO_STEPS)
    redoStack.value = []
    baseline = snapshot
    return true
  }

  /**
   * 保存文档。`checkpoint` 为 true 时（手动保存、恢复历史）一定生成新的历史版本，
   * 否则在时间窗口内合并到最近一条历史版本。
   */
  const save = async (
    document: ResumeDocument = currentDocument.value,
    options: { checkpoint?: boolean } = {},
  ): Promise<void> => {
    if (document === currentDocument.value) recordChange()
    document.updatedAt = new Date().toISOString()
    await saveStoredDocument(document, { coalesce: !options.checkpoint })
    lastSavedAt.value = document.updatedAt
    await refreshCatalog()
    if (document.id === currentId.value) history.value = await listDocumentHistory(document.id)
  }

  const open = async (id: string): Promise<void> => {
    const stored = await loadStoredDocument(id)
    if (!stored) return
    currentDocument.value = stored
    currentId.value = stored.id
    lastSavedAt.value = stored.updatedAt
    history.value = await listDocumentHistory(stored.id)
    undoStack.value = []
    redoStack.value = []
    baseline = cloneResume(stored)
  }

  /** 把内存中的某个快照设为当前文档并保存，不计入撤销栈。 */
  const applySnapshot = async (snapshot: ResumeDocument): Promise<void> => {
    currentDocument.value = snapshot
    baseline = cloneResume(snapshot)
    await save()
  }

  const refreshHistory = async (): Promise<void> => {
    history.value = currentId.value ? await listDocumentHistory(currentId.value) : []
  }

  const restoreHistory = async (document: ResumeDocument): Promise<void> => {
    await save(cloneResume(document), { checkpoint: true })
    await open(document.id)
  }

  const undo = async (): Promise<void> => {
    // 先把尚未保存的编辑记为一步，保证撤销回到的是这次编辑之前的状态。
    recordChange()
    const previous = undoStack.value.at(-1)
    if (!previous) return
    undoStack.value = undoStack.value.slice(0, -1)
    redoStack.value = [...redoStack.value, cloneResume(currentDocument.value)]
    await applySnapshot(cloneResume(previous))
  }

  const redo = async (): Promise<void> => {
    const next = redoStack.value.at(-1)
    if (!next) return
    redoStack.value = redoStack.value.slice(0, -1)
    undoStack.value = [...undoStack.value, cloneResume(currentDocument.value)]
    await applySnapshot(cloneResume(next))
  }

  const create = async (templateId: TemplateId = 'classic'): Promise<string> => {
    const fresh = createDefaultDocument()
    fresh.id = createId('resume')
    fresh.title = '未命名简历'
    fresh.theme.templateId = templateId
    fresh.theme.pageMode = templateId === 'compact' ? 'one-page-preferred' : 'standard'
    await save(fresh)
    await open(fresh.id)
    return fresh.id
  }

  const importDocument = async (document: ResumeDocument): Promise<void> => {
    await save(document)
    await open(document.id)
  }

  const duplicate = async (): Promise<string> => {
    const duplicateDocument = cloneResume(currentDocument.value)
    duplicateDocument.id = createId('resume')
    duplicateDocument.title = `${duplicateDocument.title} 副本`
    await save(duplicateDocument)
    await open(duplicateDocument.id)
    return duplicateDocument.id
  }

  const remove = async (id: string): Promise<void> => {
    await deleteStoredDocument(id)
    await refreshCatalog()
    if (currentId.value === id) {
      const next = documents.value[0]
      if (next) await open(next.id)
      else await create()
    }
  }

  const touch = (): Promise<void> => save(currentDocument.value)

  const addSection = (type: SectionType): void => {
    const section: ResumeSection = {
      id: createId('section'),
      type,
      title:
        type === 'custom'
          ? '新模块'
          : type === 'education'
            ? '教育经历'
            : type === 'experience'
              ? '工作经历'
              : type === 'project'
                ? '项目经历'
                : type === 'skills'
                  ? '专业技能'
                  : '个人总结',
      visible: true,
      items: [
        {
          id: createId('item'),
          title: '',
          subtitle: '',
          period: '',
          location: '',
          content: '',
          bullets: [],
        },
      ],
    }
    currentDocument.value.sections.push(section)
    void touch()
  }

  const removeSection = (sectionId: string): void => {
    currentDocument.value.sections = currentDocument.value.sections.filter(
      (section) => section.id !== sectionId,
    )
    void touch()
  }

  const moveSection = (sectionId: string, direction: -1 | 1): void => {
    const sections = currentDocument.value.sections
    const index = sections.findIndex((section) => section.id === sectionId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= sections.length) return
    ;[sections[index], sections[target]] = [sections[target], sections[index]]
    void touch()
  }

  const moveSectionTo = (sectionId: string, targetIndex: number): void => {
    const sections = currentDocument.value.sections
    const sourceIndex = sections.findIndex((section) => section.id === sectionId)
    if (
      sourceIndex < 0 ||
      targetIndex < 0 ||
      targetIndex >= sections.length ||
      sourceIndex === targetIndex
    )
      return
    const [section] = sections.splice(sourceIndex, 1)
    sections.splice(targetIndex, 0, section)
    void touch()
  }

  return {
    documents,
    currentDocument,
    currentId,
    currentTitle,
    isReady,
    lastSavedAt,
    history,
    canUndo,
    canRedo,
    init,
    refreshCatalog,
    save,
    open,
    refreshHistory,
    restoreHistory,
    undo,
    redo,
    create,
    importDocument,
    duplicate,
    remove,
    touch,
    addSection,
    removeSection,
    moveSection,
    moveSectionTo,
  }
})
