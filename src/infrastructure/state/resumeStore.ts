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

/**
 * 编辑状态仓库（Pinia）。
 *
 * 集中管理简历目录、当前编辑文档、历史版本与撤销/重做快照，
 * 所有持久化读写都委托给 {@link indexedDbStorage}，不在此处直接操作 IndexedDB。
 *
 * 撤销/重做基于「历史版本栈」实现：每次保存都会写入一条历史记录，
 * `undo` 回退到上一条、`redo` 基于暂存的 `redoSnapshot` 前进，
 * 因而天然兼容多份简历的隔离与恢复。
 */
export const useResumeStore = defineStore('resume', () => {
  const documents = ref<ResumeSummary[]>([])
  const currentDocument = ref<ResumeDocument>(createDefaultDocument())
  const currentId = ref<string | null>(null)
  const isReady = ref(false)
  const lastSavedAt = ref<string | null>(null)
  const history = ref<ResumeDocument[]>([])
  const redoSnapshot = ref<ResumeDocument | null>(null)
  const canUndo = computed(() => history.value.length > 1)
  const canRedo = computed(() => redoSnapshot.value !== null)

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

  const save = async (document: ResumeDocument = currentDocument.value): Promise<void> => {
    document.updatedAt = new Date().toISOString()
    await saveStoredDocument(document)
    lastSavedAt.value = document.updatedAt
    await refreshCatalog()
    history.value = await listDocumentHistory(document.id)
  }

  const open = async (id: string): Promise<void> => {
    const stored = await loadStoredDocument(id)
    if (!stored) return
    currentDocument.value = stored
    currentId.value = stored.id
    lastSavedAt.value = stored.updatedAt
    history.value = await listDocumentHistory(stored.id)
    redoSnapshot.value = null
  }

  const refreshHistory = async (): Promise<void> => {
    history.value = currentId.value ? await listDocumentHistory(currentId.value) : []
  }

  const restoreHistory = async (document: ResumeDocument): Promise<void> => {
    await save(cloneResume(document))
    await open(document.id)
  }

  const undo = async (): Promise<void> => {
    if (!currentId.value) return
    const versions = await listDocumentHistory(currentId.value)
    if (versions.length < 2) return
    redoSnapshot.value = cloneResume(versions[0])
    await save(cloneResume(versions[1]))
    await open(currentId.value)
  }

  const redo = async (): Promise<void> => {
    if (!redoSnapshot.value) return
    const snapshot = cloneResume(redoSnapshot.value)
    redoSnapshot.value = null
    await save(snapshot)
    await open(snapshot.id)
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
