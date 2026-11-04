import { ref, type Ref } from 'vue'
import type { ResumeDocument } from '@/domain/resume/model'
import type { useResumeStore } from '@/infrastructure/state/resumeStore'
import { resumeToPlainText } from '@/domain/interview'
import { exportResumeFile } from '@/infrastructure/api/localResumeApi'
import { loadStoredDocument } from '@/infrastructure/storage/indexedDbStorage'
import { downloadFile } from '@/shared/utils/fileDownload'
import type { ShowNotice } from './useBackup'

/** 文件名里不能出现这些字符，导入的标题常带空格和斜杠（`吴**` 会被替换成 `吴--`）。 */
const toSafeFileName = (title: string): string =>
  title
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[-\s]+|[-\s]+$/g, '')
    .trim() || 'resume'

export interface ResumeExportOptions {
  store: ReturnType<typeof useResumeStore>
  flushSave: () => Promise<void>
  notice: Ref<string>
  showNotice: ShowNotice
}

export interface ResumeExportApi {
  exporting: Ref<boolean>
  exportPdf: () => Promise<void>
  exportDocx: () => Promise<void>
  exportTxt: () => Promise<void>
  exportDocument: (id: string, format: 'pdf' | 'docx' | 'txt') => Promise<void>
}

/**
 * PDF / Word / TXT 导出。
 *
 * 导出前先 flush 自动保存；PDF 生成要几秒，期间再点一次会并发跑两个无头 Chromium，
 * 所以用 exporting 做互斥。
 */
export const useResumeExport = (options: ResumeExportOptions): ResumeExportApi => {
  const { store, flushSave, notice, showNotice } = options
  const exporting = ref(false)

  /**
   * 导出文件名：有真实姓名时用「姓名-岗位-简历」，比「未命名简历.pdf」更像成品，
   * 投递时 HR 也更容易认出来。
   */
  const exportFileName = (format: 'pdf' | 'docx', doc?: ResumeDocument): string => {
    const document = doc ?? store.currentDocument
    const { name, headline } = document.profile
    const cleanName = name.trim()
    const base =
      cleanName && cleanName !== '你的姓名'
        ? [cleanName, headline.trim(), '简历'].filter(Boolean).join('-')
        : document.title
    return `${toSafeFileName(base)}.${format}`
  }

  const exportResume = async (format: 'pdf' | 'docx'): Promise<void> => {
    if (exporting.value) return
    exporting.value = true
    const label = format === 'pdf' ? 'PDF' : 'Word'
    await flushSave()
    notice.value = `正在生成 ${label}...`
    try {
      const blob = await exportResumeFile(store.currentDocument, format)
      downloadFile(
        blob,
        exportFileName(format),
        format === 'pdf'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      )
      exporting.value = false
      showNotice(`${label} 已导出`, { label: '再导一次', run: () => void exportResume(format) })
    } catch (error) {
      exporting.value = false
      notice.value = ''
      showNotice(error instanceof Error ? error.message : `${label} 导出失败`)
    }
  }

  const exportTxt = async (): Promise<void> => {
    await flushSave()
    const text = resumeToPlainText(store.currentDocument)
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    downloadFile(blob, `${toSafeFileName(store.currentDocument.title)}.txt`, 'text/plain')
    showNotice('纯文本已导出')
  }

  const exportPdf = (): Promise<void> => exportResume('pdf')
  const exportDocx = (): Promise<void> => exportResume('docx')

  /** 首页直接导出某份简历，不用先进编辑器。 */
  const exportDocument = async (id: string, format: 'pdf' | 'docx' | 'txt'): Promise<void> => {
    try {
      const document = await loadStoredDocument(id)
      if (!document) {
        showNotice('简历不存在或已被删除')
        return
      }
      if (format === 'txt') {
        const text = resumeToPlainText(document)
        downloadFile(
          new Blob([text], { type: 'text/plain;charset=utf-8' }),
          `${toSafeFileName(document.title)}.txt`,
          'text/plain',
        )
        showNotice('纯文本已导出')
        return
      }
      showNotice(`正在生成 ${format === 'pdf' ? 'PDF' : 'Word'}...`)
      const blob = await exportResumeFile(document, format)
      downloadFile(
        blob,
        exportFileName(format, document),
        format === 'pdf'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      )
      showNotice(`${format === 'pdf' ? 'PDF' : 'Word'} 已导出`)
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '导出失败')
    }
  }

  return { exporting, exportPdf, exportDocx, exportTxt, exportDocument }
}
