import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { createDefaultDocument, createId } from '@/domain/resume/defaults'
import { cloneResume } from '@/domain/resume/validation'
import {
  deleteStoredDocument,
  listDocumentHistory,
  listStoredDocuments,
  loadStoredDocument,
  overwriteStoredDocument,
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
 * 撤销/重做基于「历史版本栈 + 游标」实现：每次保存写入一条历史记录并把游标归零，
 * `undo` 把游标往后移一位、`redo` 往前移一位，移动本身不产生新版本。
 * 因而天然兼容多份简历的隔离与恢复。
 */
export const useResumeStore = defineStore('resume', () => {
  const documents = ref<ResumeSummary[]>([])
  const currentDocument = ref<ResumeDocument>(createDefaultDocument())
  const currentId = ref<string | null>(null)
  const isReady = ref(false)
  /** 本地库打不开时为 true：界面要给出可读原因和重试入口，而不是白屏。 */
  const fatalError = ref<string | null>(null)
  /** 最近一次读写本地库失败的原因；成功后清空。非阻断，但必须让用户看见。 */
  const storageError = ref<string | null>(null)
  const lastSavedAt = ref<string | null>(null)
  /** 历史版本，最新在前（index 0 就是当前保存点）。 */
  const history = ref<ResumeDocument[]>([])
  /** 撤销指针：0 表示停在最新版本，1 表示回退了一步，以此类推。 */
  const historyCursor = ref(0)
  const canUndo = computed(() => historyCursor.value < history.value.length - 1)
  const canRedo = computed(() => historyCursor.value > 0)

  const currentTitle = computed(() => currentDocument.value.title)

  const refreshCatalog = async (): Promise<void> => {
    documents.value = await listStoredDocuments()
  }

  const init = async (): Promise<void> => {
    fatalError.value = null
    try {
      await refreshCatalog()
      // 没有简历时不自动创建"我的简历"——新用户看到的应该是空状态和两个明确入口，
      // 而不是一份全是占位文案的空白简历。
      const first = documents.value[0]
      if (first) await open(first.id)
    } catch (error) {
      // 打不开本地库（隐私模式、配额、IndexedDB 损坏）时不要把用户留在空白页上
      fatalError.value =
        error instanceof Error ? error.message : '本地存储初始化失败，可能被浏览器限制'
    } finally {
      isReady.value = true
    }
  }

  /** 撤销删除：把刚删掉的文档整体写回存储。 */
  const restoreDocument = async (document: ResumeDocument): Promise<void> => {
    await saveStoredDocument(cloneResume(document))
    await refreshCatalog()
  }

  const describe = (error: unknown, prefix: string): string =>
    `${prefix}：${error instanceof Error ? error.message : '未知错误'}`

  const save = async (document: ResumeDocument = currentDocument.value): Promise<void> => {
    document.updatedAt = new Date().toISOString()
    try {
      await saveStoredDocument(document)
      lastSavedAt.value = document.updatedAt
      await refreshCatalog()
      history.value = await listDocumentHistory(document.id)
      // 刚写入的版本就是最新版，指针回到 0（之前若撤销过，重做栈随之失效）
      historyCursor.value = 0
      storageError.value = null
    } catch (error) {
      // 配额写满 / 隐私模式：不能让用户以为「已保存」，工具栏会改用错误态显示
      storageError.value = describe(error, '自动保存失败')
    }
  }

  const open = async (id: string): Promise<void> => {
    try {
      const stored = await loadStoredDocument(id)
      if (!stored) return
      currentDocument.value = stored
      currentId.value = stored.id
      lastSavedAt.value = stored.updatedAt
      history.value = await listDocumentHistory(stored.id)
      historyCursor.value = 0
      storageError.value = null
    } catch (error) {
      storageError.value = describe(error, '打开简历失败')
    }
  }

  const refreshHistory = async (): Promise<void> => {
    history.value = currentId.value ? await listDocumentHistory(currentId.value) : []
    historyCursor.value = 0
  }

  const restoreHistory = async (document: ResumeDocument): Promise<void> => {
    await save(cloneResume(document))
    await open(document.id)
  }

  /**
   * 把历史里的某个版本写回当前文档（不新增历史记录）。
   *
   * 撤销/重做只是移动 `historyCursor`，不产生新版本——否则每撤销一次历史就多一条，
   * 连按两次会在两个版本之间来回跳（旧实现的实测行为）。
   */
  const applyHistoryVersion = async (index: number): Promise<void> => {
    const target = history.value[index]
    if (!target) return
    const snapshot = cloneResume(target)
    try {
      await overwriteStoredDocument(snapshot)
      currentDocument.value = snapshot
      lastSavedAt.value = snapshot.updatedAt
      historyCursor.value = index
      storageError.value = null
    } catch (error) {
      storageError.value = describe(error, '恢复历史版本失败')
    }
  }

  const undo = async (): Promise<void> => {
    if (!currentId.value) return
    // 打开抽屉后历史可能已变化，先同步再移动指针
    history.value = await listDocumentHistory(currentId.value)
    const next = historyCursor.value + 1
    if (next >= history.value.length) return
    await applyHistoryVersion(next)
  }

  const redo = async (): Promise<void> => {
    if (!currentId.value) return
    const next = historyCursor.value - 1
    if (next < 0) return
    await applyHistoryVersion(next)
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
    try {
      await deleteStoredDocument(id)
    } catch (error) {
      storageError.value = describe(error, '删除简历失败')
      return
    }
    await refreshCatalog()
    if (currentId.value === id) {
      const next = documents.value[0]
      if (next) await open(next.id)
      else {
        // 删掉最后一份时回到空状态，而不是偷偷再建一份「我的简历」
        currentId.value = null
        currentDocument.value = createDefaultDocument()
        history.value = []
        historyCursor.value = 0
        lastSavedAt.value = null
      }
    }
  }

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
  }

  const removeSection = (sectionId: string): void => {
    currentDocument.value.sections = currentDocument.value.sections.filter(
      (section) => section.id !== sectionId,
    )
  }

  const moveSection = (sectionId: string, direction: -1 | 1): void => {
    const sections = currentDocument.value.sections
    const index = sections.findIndex((section) => section.id === sectionId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= sections.length) return
    ;[sections[index], sections[target]] = [sections[target], sections[index]]
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
  }

  return {
    documents,
    currentDocument,
    currentId,
    currentTitle,
    isReady,
    fatalError,
    storageError,
    lastSavedAt,
    history,
    canUndo,
    canRedo,
    init,
    refreshCatalog,
    save,
    open,
    clearStorageError: () => {
      storageError.value = null
    },
    refreshHistory,
    restoreHistory,
    restoreDocument,
    undo,
    redo,
    create,
    importDocument,
    duplicate,
    remove,
    addSection,
    removeSection,
    moveSection,
    moveSectionTo,
  }
})
