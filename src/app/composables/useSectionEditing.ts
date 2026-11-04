import type { SectionType } from '@/domain/resume/model'
import { cloneResume } from '@/domain/resume/validation'
import type { useResumeStore } from '@/infrastructure/state/resumeStore'
import type { ShowNotice } from './useBackup'

export interface SectionEditingOptions {
  store: ReturnType<typeof useResumeStore>
  scheduleSave: () => void
  showNotice: ShowNotice
}

export interface SectionEditingApi {
  addSection: (type: SectionType) => void
  removeSection: (id: string) => void
  moveSection: (id: string, direction: -1 | 1) => void
  moveItem: (sectionId: string, itemId: string, direction: -1 | 1) => void
  removeItem: (sectionId: string, itemId: string) => void
  reorderSection: (id: string, targetIndex: number) => void
}

/**
 * 模块 / 条目的增删与排序。
 *
 * 结构修改统一走自动保存的防抖队列：之前 store 内部直接落盘，而文本编辑还挂着
 * 350ms 防抖，同一次操作会被写两遍，历史里出现两条几乎一样的版本，撤销一次「没反应」。
 */
export const useSectionEditing = (options: SectionEditingOptions): SectionEditingApi => {
  const { store, scheduleSave, showNotice } = options

  const addSection = (type: SectionType): void => {
    store.addSection(type)
    scheduleSave()
    showNotice('模块已添加')
  }

  const removeSection = (id: string): void => {
    if (store.currentDocument.sections.length <= 1) {
      showNotice('至少保留一个内容模块')
      return
    }
    // 删除前留一份快照，toast 上给 6 秒「撤销」入口
    const snapshot = cloneResume(store.currentDocument)
    store.removeSection(id)
    scheduleSave()
    showNotice('模块已删除', {
      label: '撤销',
      run: () => {
        void store.restoreHistory(snapshot)
        showNotice('已恢复该模块')
      },
    })
  }

  const moveSection = (id: string, direction: -1 | 1): void => {
    store.moveSection(id, direction)
    scheduleSave()
  }

  /** 调整单条内容的先后：顺序就是简历里的顺序。 */
  const moveItem = (sectionId: string, itemId: string, direction: -1 | 1): void => {
    const section = store.currentDocument.sections.find((candidate) => candidate.id === sectionId)
    if (!section) return
    const index = section.items.findIndex((item) => item.id === itemId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= section.items.length) return
    const [item] = section.items.splice(index, 1)
    section.items.splice(target, 0, item)
    scheduleSave()
  }

  /** 删除单条内容：和删模块一样留快照，toast 里可撤销。 */
  const removeItem = (sectionId: string, itemId: string): void => {
    const section = store.currentDocument.sections.find((candidate) => candidate.id === sectionId)
    if (!section || section.items.length <= 1) return
    const snapshot = cloneResume(store.currentDocument)
    section.items = section.items.filter((item) => item.id !== itemId)
    scheduleSave()
    showNotice('内容已删除', {
      label: '撤销',
      run: () => {
        void store.restoreHistory(snapshot).then(() => showNotice('已恢复该条内容'))
      },
    })
  }

  const reorderSection = (id: string, targetIndex: number): void => {
    store.moveSectionTo(id, targetIndex)
    scheduleSave()
  }

  return { addSection, removeSection, moveSection, moveItem, removeItem, reorderSection }
}
