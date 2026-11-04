import { ref, type Ref } from 'vue'
import type { ResumeDocument } from '@/domain/resume/model'
import type { useResumeStore } from '@/infrastructure/state/resumeStore'
import {
  exportStoredDocuments,
  importStoredDocuments,
  loadAllStoredDocuments,
  replaceStoredDocuments,
} from '@/infrastructure/storage/indexedDbStorage'
import { downloadFile } from '@/shared/utils/fileDownload'

const BACKUP_KEY = 'resume-studio:last-backup-at'

export type ShowNotice = (message: string, action?: { label: string; run: () => void }) => void

export interface BackupOptions {
  store: ReturnType<typeof useResumeStore>
  flushSave: () => Promise<void>
  showNotice: ShowNotice
  openEditor: (id: string) => Promise<void>
  goHome: () => void
}

export interface BackupApi {
  lastBackupAt: Ref<string | null>
  backup: () => Promise<void>
  restore: (file: File) => Promise<void>
}

/**
 * JSON 备份与恢复。
 *
 * 导出前先 flush 自动保存，避免备份文件里少最后一次改动；
 * 恢复是覆盖式操作，成功后在 toast 上给一步撤销。
 */
export const useBackup = (options: BackupOptions): BackupApi => {
  const { store, flushSave, showNotice, openEditor, goHome } = options
  const lastBackupAt = ref<string | null>(window.localStorage.getItem(BACKUP_KEY))

  /** 整体替换本地数据并回到第一份简历；恢复与撤销恢复共用。 */
  const applyDocuments = async (documents: ResumeDocument[]): Promise<void> => {
    await replaceStoredDocuments(documents)
    await store.refreshCatalog()
    const first = store.documents[0]
    if (first) await openEditor(first.id)
    else goHome()
  }

  const backup = async (): Promise<void> => {
    await flushSave()
    downloadFile(
      await exportStoredDocuments(),
      `resume-studio-backup-${new Date().toISOString().slice(0, 10)}.json`,
      'application/json',
    )
    const stamp = new Date().toISOString()
    window.localStorage.setItem(BACKUP_KEY, stamp)
    lastBackupAt.value = stamp
    showNotice('备份文件已导出')
  }

  const revertRestore = async (snapshot: ResumeDocument[]): Promise<void> => {
    try {
      await applyDocuments(snapshot)
      showNotice('已恢复到导入前的数据')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '撤销恢复失败')
    }
  }

  const restore = async (file: File): Promise<void> => {
    // 恢复是覆盖式操作：先给当前数据拍快照，成功后再用 toast 提供一步撤销
    let snapshot: ResumeDocument[] = []
    try {
      snapshot = await loadAllStoredDocuments()
      const { documents, skipped } = await importStoredDocuments(await file.text())
      await store.refreshCatalog()
      if (store.documents[0]) await openEditor(store.documents[0].id)
      showNotice(
        skipped > 0
          ? `已恢复 ${documents.length} 份简历，跳过 ${skipped} 条无法识别的记录`
          : `已恢复 ${documents.length} 份简历`,
        { label: '撤销', run: () => void revertRestore(snapshot) },
      )
    } catch (error) {
      // 校验失败发生在落库之前，现有简历不受影响
      showNotice(error instanceof Error ? error.message : '备份恢复失败')
    }
  }

  return { lastBackupAt, backup, restore }
}
