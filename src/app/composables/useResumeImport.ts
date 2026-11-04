import { onUnmounted, ref, type Ref } from 'vue'
import type { ResumeImportResult } from '@/domain/resume/importParser'
import type { useResumeStore } from '@/infrastructure/state/resumeStore'
import {
  importResumeDocx,
  importResumePdf,
  type ImportFileKind,
} from '@/infrastructure/api/localResumeApi'
import type { ShowNotice } from './useBackup'

export interface ResumeImportOptions {
  store: ReturnType<typeof useResumeStore>
  notice: Ref<string>
  showNotice: ShowNotice
  goReview: () => void
  goEditor: () => void
  goHome: () => void
}

export interface ResumeImportApi {
  importReview: Ref<ResumeImportResult | null>
  importSourceUrl: Ref<string>
  importSourceKind: Ref<ImportFileKind>
  importPdf: (file: File) => Promise<void>
  importDocx: (file: File) => Promise<void>
  confirmImport: () => Promise<void>
  cancelImport: () => void
}

/**
 * PDF / Word 导入。
 *
 * 两者走同一条确认流程，只是来源和文案不同；解析失败时把文件留在内存里，
 * toast 上给「重试」，不用让用户重新选一遍。
 */
export const useResumeImport = (options: ResumeImportOptions): ResumeImportApi => {
  const { store, notice, showNotice, goReview, goEditor, goHome } = options
  const importReview = ref<ResumeImportResult | null>(null)
  const importSourceUrl = ref('')
  const importSourceKind = ref<ImportFileKind>('pdf')
  /** 最近一次导入的文件：失败了要给「重试」。 */
  let lastImport: { file: File; kind: ImportFileKind } | null = null

  const startImport = async (file: File, kind: ImportFileKind): Promise<void> => {
    lastImport = { file, kind }
    importSourceKind.value = kind
    notice.value = kind === 'pdf' ? '正在解析 PDF 简历...' : '正在解析 Word 简历...'
    if (importSourceUrl.value) URL.revokeObjectURL(importSourceUrl.value)
    importSourceUrl.value = URL.createObjectURL(file)
    try {
      importReview.value =
        kind === 'pdf' ? await importResumePdf(file) : await importResumeDocx(file)
      notice.value = ''
      goReview()
    } catch (error) {
      URL.revokeObjectURL(importSourceUrl.value)
      importSourceUrl.value = ''
      notice.value = ''
      const message =
        error instanceof Error ? error.message : `${kind === 'pdf' ? 'PDF' : 'Word'} 导入失败`
      showNotice(message, {
        label: '重试',
        run: () => {
          if (lastImport) void startImport(lastImport.file, lastImport.kind)
        },
      })
    }
  }

  const importPdf = (file: File): Promise<void> => startImport(file, 'pdf')
  const importDocx = (file: File): Promise<void> => startImport(file, 'docx')

  const confirmImport = async (): Promise<void> => {
    if (!importReview.value) return
    await store.importDocument(importReview.value.document)
    importReview.value = null
    URL.revokeObjectURL(importSourceUrl.value)
    importSourceUrl.value = ''
    goEditor()
    showNotice(`${importSourceKind.value === 'pdf' ? 'PDF' : 'Word'} 已导入模板`)
  }

  const cancelImport = (): void => {
    importReview.value = null
    URL.revokeObjectURL(importSourceUrl.value)
    importSourceUrl.value = ''
    goHome()
  }

  onUnmounted(() => {
    if (importSourceUrl.value) URL.revokeObjectURL(importSourceUrl.value)
  })

  return {
    importReview,
    importSourceUrl,
    importSourceKind,
    importPdf,
    importDocx,
    confirmImport,
    cancelImport,
  }
}
