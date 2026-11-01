<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref } from 'vue'
import { importResumePdf, exportResumeFile } from '@/infrastructure/api/localResumeApi'
import HomeView from '@/features/home/HomeView.vue'
import { useResumeStore } from '@/infrastructure/state/resumeStore'
import {
  exportStoredDocuments,
  importStoredDocuments,
} from '@/infrastructure/storage/indexedDbStorage'
import {
  loadBackupReference,
  markBackupDone,
  needsBackupReminder,
  requestPersistentStorage,
} from '@/infrastructure/storage/persistence'
import type { ResumeImportResult } from '@/domain/resume/importParser'
import type { ResumeDocument, SectionType, TemplateId } from '@/domain/resume/model'
import { downloadFile } from '@/shared/utils/fileDownload'

// 编辑器和导入确认页依赖 Tiptap 等较大的依赖，首页用不到，按需加载。
const EditorView = defineAsyncComponent(() => import('@/features/editor/EditorView.vue'))
const ImportReviewView = defineAsyncComponent(
  () => import('@/features/import-review/ImportReviewView.vue'),
)

const store = useResumeStore()
const screen = ref<'home' | 'editor' | 'import-review'>('home')
const notice = ref('')
const importReview = ref<ResumeImportResult | null>(null)
const importSourceUrl = ref('')
const backupReference = ref(loadBackupReference())
const showBackupReminder = computed(
  () => store.documents.length > 0 && needsBackupReminder(backupReference.value),
)
let saveTimer: number | undefined

const showNotice = (message: string): void => {
  notice.value = message
  window.setTimeout(() => {
    if (notice.value === message) notice.value = ''
  }, 2400)
}

const scheduleSave = (): void => {
  if (saveTimer) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    void store.save()
    showNotice('已保存到本机')
  }, 350)
}

/**
 * 立即落盘：把还在 350ms 防抖里的保存取消掉、当场写完。
 * 导出备份、返回列表、导出 PDF 之前都要等它，否则会按 IndexedDB 里的旧数据走，
 * 最后一次改动就丢了（备份文件里少了刚填的内容）。
 */
const flushSave = async (): Promise<void> => {
  if (saveTimer) {
    window.clearTimeout(saveTimer)
    saveTimer = undefined
  }
  await store.save()
}

const back = async (): Promise<void> => {
  await flushSave()
  screen.value = 'home'
}

const openEditor = async (id: string): Promise<void> => {
  await store.open(id)
  screen.value = 'editor'
}

const createDocument = async (templateId: TemplateId): Promise<void> => {
  const id = await store.create(templateId)
  await openEditor(id)
}

const removeDocument = async (id: string): Promise<void> => {
  if (!window.confirm('确定删除这份简历吗？')) return
  await store.remove(id)
  showNotice('简历已删除')
}

const backup = async (): Promise<void> => {
  await flushSave()
  downloadFile(
    await exportStoredDocuments(),
    `resume-studio-backup-${new Date().toISOString().slice(0, 10)}.json`,
    'application/json',
  )
  backupReference.value = markBackupDone()
  showNotice('备份文件已导出')
}

const restore = async (file: File): Promise<void> => {
  try {
    const count = await importStoredDocuments(await file.text())
    await store.refreshCatalog()
    if (store.documents[0]) await openEditor(store.documents[0].id)
    showNotice(`已恢复 ${count} 份简历`)
  } catch (error) {
    showNotice(error instanceof Error ? error.message : '备份恢复失败')
  }
}

const importPdf = async (file: File): Promise<void> => {
  notice.value = '正在解析 PDF 简历...'
  if (importSourceUrl.value) URL.revokeObjectURL(importSourceUrl.value)
  importSourceUrl.value = URL.createObjectURL(file)
  try {
    importReview.value = await importResumePdf(file)
    notice.value = ''
    screen.value = 'import-review'
  } catch (error) {
    URL.revokeObjectURL(importSourceUrl.value)
    importSourceUrl.value = ''
    notice.value = ''
    showNotice(error instanceof Error ? error.message : 'PDF 导入失败')
  }
}

const confirmImport = async (): Promise<void> => {
  if (!importReview.value) return
  await store.importDocument(importReview.value.document)
  importReview.value = null
  URL.revokeObjectURL(importSourceUrl.value)
  importSourceUrl.value = ''
  screen.value = 'editor'
  showNotice('PDF 已导入模板')
}

const cancelImport = (): void => {
  importReview.value = null
  URL.revokeObjectURL(importSourceUrl.value)
  importSourceUrl.value = ''
  screen.value = 'home'
}

const exportPdf = async (): Promise<void> => {
  await flushSave()
  notice.value = '正在生成 PDF...'
  try {
    const blob = await exportResumeFile(store.currentDocument, 'pdf')
    downloadFile(blob, `${store.currentDocument.title || 'resume'}.pdf`, 'application/pdf')
    showNotice('PDF 已导出')
  } catch (error) {
    notice.value = ''
    showNotice(error instanceof Error ? error.message : 'PDF 导出失败')
  }
}

const exportDocx = async (): Promise<void> => {
  await flushSave()
  notice.value = '正在生成 Word...'
  try {
    const blob = await exportResumeFile(store.currentDocument, 'docx')
    downloadFile(
      blob,
      `${store.currentDocument.title || 'resume'}.docx`,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    showNotice('Word 已导出')
  } catch (error) {
    notice.value = ''
    showNotice(error instanceof Error ? error.message : 'Word 导出失败')
  }
}

const addSection = (type: SectionType): void => {
  store.addSection(type)
  showNotice('模块已添加')
}

const removeSection = (id: string): void => {
  if (store.currentDocument.sections.length <= 1) {
    showNotice('至少保留一个内容模块')
    return
  }
  store.removeSection(id)
  showNotice('模块已删除')
}

const onKeyDown = (event: KeyboardEvent): void => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    void store.save(undefined, { checkpoint: true })
    showNotice('已保存到本机')
  }
}

const duplicateDocument = async (): Promise<void> => {
  await store.duplicate()
  showNotice('已复制当前简历')
}

const openHistory = async (): Promise<void> => {
  await store.refreshHistory()
}

const restoreHistory = async (document: ResumeDocument): Promise<void> => {
  await store.restoreHistory(document)
  showNotice('已恢复历史版本')
}

onMounted(() => {
  void store.init()
  void requestPersistentStorage()
  window.addEventListener('keydown', onKeyDown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
  if (saveTimer) window.clearTimeout(saveTimer)
  if (importSourceUrl.value) URL.revokeObjectURL(importSourceUrl.value)
})
</script>

<template>
  <div class="app-shell">
    <HomeView
      v-if="screen === 'home' && store.isReady"
      :documents="store.documents"
      :backup-reminder="showBackupReminder"
      @open="openEditor"
      @create="createDocument"
      @remove="removeDocument"
      @backup="backup"
      @restore="restore"
      @import-pdf="importPdf"
    />
    <EditorView
      v-else-if="screen === 'editor' && store.isReady"
      :document="store.currentDocument"
      :saved-at="store.lastSavedAt"
      :history="store.history"
      :can-undo="store.canUndo"
      :can-redo="store.canRedo"
      @back="back"
      @save="scheduleSave"
      @duplicate="duplicateDocument"
      @export-pdf="exportPdf"
      @export-docx="exportDocx"
      @add-section="addSection"
      @remove-section="removeSection"
      @move-section="(id, direction) => store.moveSection(id, direction)"
      @reorder-section="(id, targetIndex) => store.moveSectionTo(id, targetIndex)"
      @history="openHistory"
      @restore-history="restoreHistory"
      @undo="store.undo"
      @redo="store.redo"
    />
    <ImportReviewView
      v-else-if="screen === 'import-review' && importReview"
      :result="importReview"
      :source-url="importSourceUrl"
      @cancel="cancelImport"
      @confirm="confirmImport"
    />
    <div v-if="notice" class="toast" role="status">{{ notice }}</div>
  </div>
</template>
