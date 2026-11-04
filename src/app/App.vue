<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  importResumePdf,
  importResumeDocx,
  exportResumeFile,
  type ImportFileKind,
} from '@/infrastructure/api/localResumeApi'
import EditorView from '@/features/editor/EditorView.vue'
import HomeView from '@/features/home/HomeView.vue'
// 这两个页面只在特定流程里出现，按需加载能让首屏少下载一块
const ImportReviewView = defineAsyncComponent(
  () => import('@/features/import-review/ImportReviewView.vue'),
)
const InterviewView = defineAsyncComponent(() => import('@/features/interview/InterviewView.vue'))
const AgentView = defineAsyncComponent(() => import('@/features/agent/AgentView.vue'))
const SettingsView = defineAsyncComponent(() => import('@/features/settings/SettingsView.vue'))
import { useResumeStore } from '@/infrastructure/state/resumeStore'
import {
  loadStoredDocument,
} from '@/infrastructure/storage/indexedDbStorage'
import type { ResumeImportResult } from '@/domain/resume/importParser'
import type { ResumeDocument, SectionType, TemplateId } from '@/domain/resume/model'
import { cloneResume } from '@/domain/resume/validation'
import { createSampleDocument } from '@/domain/resume/defaults'
import {
  activeEditor,
  textRedoAvailable,
  textUndoAvailable,
  touchEditor,
} from '@/shared/ui/activeEditor'
import { downloadFile } from '@/shared/utils/fileDownload'
import { onUnexpectedError } from '@/shared/ui/errorBus'
import { resumeToPlainText } from '@/domain/interview'
import { SYNC_KEY_PREFIX, useAutoSave } from './composables/useAutoSave'
import { useBackup } from './composables/useBackup'

/** 文件名里不能出现这些字符，导入的标题常带空格和斜杠（`吴**` 会被替换成 `吴--`）。 */
const toSafeFileName = (title: string): string =>
  title
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[-\s]+|[-\s]+$/g, '')
    .trim() || 'resume'

const store = useResumeStore()
const { dirty, scheduleSave, flushSave } = useAutoSave(store)
const screen = ref<'home' | 'editor' | 'import-review' | 'interview' | 'agent' | 'settings'>('home')
const notice = ref('')
/** toast 上的可选操作（例如「撤销删除」），没有操作时 2.4s 自动消失。 */
const noticeAction = ref<{ label: string; run: () => void } | null>(null)
const importReview = ref<ResumeImportResult | null>(null)
const importSourceUrl = ref('')
const shellRef = ref<HTMLElement | null>(null)
/** 意外错误的订阅句柄；卸载时退订。 */
let stopErrorListener: (() => void) | undefined

const showNotice = (message: string, action?: { label: string; run: () => void }): void => {
  notice.value = message
  noticeAction.value = action ?? null
  const ttl = action ? 6000 : 2400
  window.setTimeout(() => {
    if (notice.value !== message) return
    notice.value = ''
    noticeAction.value = null
  }, ttl)
}

/** 自动保存是背景行为，不再每 350ms 弹一次 toast——工具栏已有「已保存 hh:mm」。 */
const back = async (): Promise<void> => {
  await flushSave()
  screen.value = 'home'
}

const openEditor = async (id: string): Promise<void> => {
  await store.open(id)
  screen.value = 'editor'
}

const { lastBackupAt, backup, restore } = useBackup({
  store,
  flushSave,
  showNotice,
  openEditor,
  goHome: () => {
    screen.value = 'home'
  },
})

const createDocument = async (templateId: TemplateId): Promise<void> => {
  const id = await store.create(templateId)
  await openEditor(id)
}

const createSample = async (): Promise<void> => {
  await store.importDocument(createSampleDocument())
  screen.value = 'editor'
}

const removeDocument = async (id: string): Promise<void> => {
  // 不再弹原生 confirm：删完给 6 秒撤销，一步误触也能救回来
  const snapshot = await loadStoredDocument(id)
  await store.remove(id)
  if (!snapshot) return
  showNotice('简历已删除', {
    label: '撤销',
    run: () => {
      void store.restoreDocument(snapshot).then(() => showNotice('已恢复该简历'))
    },
  })
}

const retryInit = (): void => {
  void store.init()
}

/** PDF 与 Word 走同一条确认流程，只是来源和文案不同。 */
const importSourceKind = ref<ImportFileKind>('pdf')
/** 最近一次导入的文件：失败了要给「重试」，不用让用户重新选一遍。 */
let lastImport: { file: File; kind: ImportFileKind } | null = null

const startImport = async (file: File, kind: ImportFileKind): Promise<void> => {
  lastImport = { file, kind }
  importSourceKind.value = kind
  notice.value = kind === 'pdf' ? '正在解析 PDF 简历...' : '正在解析 Word 简历...'
  if (importSourceUrl.value) URL.revokeObjectURL(importSourceUrl.value)
  importSourceUrl.value = URL.createObjectURL(file)
  try {
    importReview.value = kind === 'pdf' ? await importResumePdf(file) : await importResumeDocx(file)
    notice.value = ''
    screen.value = 'import-review'
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
  screen.value = 'editor'
  showNotice(`${importSourceKind.value === 'pdf' ? 'PDF' : 'Word'} 已导入模板`)
}

const cancelImport = (): void => {
  importReview.value = null
  URL.revokeObjectURL(importSourceUrl.value)
  importSourceUrl.value = ''
  screen.value = 'home'
}

/**
 * 导出中标记：生成 PDF 要几秒，这期间再点一次会并发跑两个无头 Chromium，
 * 所以按钮要禁用，重复调用也直接忽略。
 */
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

/**
 * 结构修改统一走自动保存的防抖队列。
 *
 * 之前 store 内部直接落盘，而文本编辑还挂着一个 350ms 的防抖保存，
 * 于是同一次操作会被写两遍，历史里出现两条几乎一样的版本，撤销一次「没反应」。
 */
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

/**
 * 撤销/重做只有一个入口，粒度按焦点决定：
 * - 焦点在正文编辑器或输入框里 → 交给编辑器/浏览器自己的历史（按字符、按段）；
 * - 否则 → 走应用历史栈（按保存点，覆盖加模块、删条目、换版式这类结构修改）。
 *
 * 这样用户不需要记「哪个按钮是哪套语义」：Ctrl+Z 永远撤销刚才那一步，
 * 只是文本里更细、结构上更粗。
 */
const canUndo = computed(() => textUndoAvailable() || store.canUndo)
const canRedo = computed(() => textRedoAvailable() || store.canRedo)

const undo = (): void => {
  const editor = activeEditor.value
  if (editor?.can().undo()) {
    editor.commands.undo()
    touchEditor()
    return
  }
  void store.undo()
}

const redo = (): void => {
  const editor = activeEditor.value
  if (editor?.can().redo()) {
    editor.commands.redo()
    touchEditor()
    return
  }
  void store.redo()
}

/** 输入框和正文编辑器里已经有原生/编辑器级撤销，别再插一手。 */
const isTextEntryFocused = (): boolean =>
  Boolean(document.activeElement?.closest('[contenteditable="true"], input, textarea, select'))

const onKeyDown = (event: KeyboardEvent): void => {
  if (!(event.metaKey || event.ctrlKey)) return
  const key = event.key.toLowerCase()
  if (key === 's') {
    event.preventDefault()
    void store.save()
    showNotice('已保存到本机')
    return
  }
  if (key === 'z' && !isTextEntryFocused()) {
    event.preventDefault()
    if (event.shiftKey) redo()
    else undo()
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

/** 另一个标签页保存了当前简历时提醒：IndexedDB 没有锁，后写的会覆盖先写的。 */
const onStorage = (event: { key: string | null }): void => {
  if (!event.key?.startsWith(SYNC_KEY_PREFIX)) return
  if (event.key !== `${SYNC_KEY_PREFIX}${store.currentDocument.id}`) return
  showNotice('另一个标签页保存了这份简历，刷新可同步最新内容')
}

onMounted(() => {
  void store.init()
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('storage', onStorage)
  // 组件里抛的错 / 未 catch 的 promise 统一在这里露个面，而不是只进 console
  stopErrorListener = onUnexpectedError((message) => {
    showNotice(`出了点意外：${message}`)
  })
})

/** 切屏后把焦点移到页面根节点，键盘/读屏用户才知道界面已经换了。 */
watch(screen, async () => {
  await nextTick()
  shellRef.value?.focus()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('storage', onStorage)
  stopErrorListener?.()
  if (importSourceUrl.value) URL.revokeObjectURL(importSourceUrl.value)
})
</script>

<template>
  <div ref="shellRef" class="app-shell" tabindex="-1">
    <section v-if="store.isReady && store.fatalError" class="app-fatal" role="alert">
      <span class="eyebrow">LOCAL STORAGE</span>
      <h1>本地简历打不开</h1>
      <p class="app-fatal__reason">{{ store.fatalError }}</p>
      <p class="app-fatal__hint">
        简历只保存在这台浏览器的本地存储里。无痕模式、禁用了网站数据，或浏览器配额写满都会导致这个页面。
        处理后点「重试」即可，不会自动清空任何数据。
      </p>
      <button type="button" class="button button--primary" @click="retryInit">重试</button>
    </section>
    <p v-else-if="!store.isReady" class="app-loading" role="status">正在打开本地简历…</p>
    <HomeView
      v-else-if="screen === 'home'"
      :documents="store.documents"
      :last-backup-at="lastBackupAt"
      @open="openEditor"
      @create="createDocument"
      @remove="removeDocument"
      @export="exportDocument"
      @sample="createSample"
      @backup="backup"
      @restore="restore"
      @import-pdf="importPdf"
      @import-docx="importDocx"
      @interview="screen = 'interview'"
      @agent="screen = 'agent'"
      @settings="screen = 'settings'"
    />
    <EditorView
      v-else-if="screen === 'editor'"
      :document="store.currentDocument"
      :saved-at="store.lastSavedAt"
      :dirty="dirty"
      :history="store.history"
      :can-undo="canUndo"
      :can-redo="canRedo"
      :exporting="exporting"
      @back="back"
      @save="scheduleSave"
      @duplicate="duplicateDocument"
      @export-pdf="exportPdf"
      @export-docx="exportDocx"
      @export-txt="exportTxt"
      @add-section="addSection"
      @remove-section="removeSection"
      @remove-item="removeItem"
      @move-item="moveItem"
      @move-section="moveSection"
      @reorder-section="reorderSection"
      @history="openHistory"
      @restore-history="restoreHistory"
      @undo="undo"
      @redo="redo"
    />
    <InterviewView
      v-else-if="screen === 'interview'"
      :documents="store.documents"
      @back="screen = 'home'"
      @go-settings="screen = 'settings'"
    />
    <AgentView
      v-else-if="screen === 'agent'"
      :documents="store.documents"
      @back="screen = 'home'"
      @go-settings="screen = 'settings'"
    />
    <SettingsView v-else-if="screen === 'settings'" @back="screen = 'home'" />
    <ImportReviewView
      v-else-if="screen === 'import-review' && importReview"
      :result="importReview"
      :source-url="importSourceUrl"
      :source-kind="importSourceKind"
      @cancel="cancelImport"
      @confirm="confirmImport"
    />
    <div v-if="store.storageError" class="app-banner" role="alert">
      <span>{{ store.storageError }}</span>
      <button type="button" class="text-button" @click="store.clearStorageError()">知道了</button>
    </div>
    <div v-if="notice" class="toast" role="status">
      <span>{{ notice }}</span>
      <button v-if="noticeAction" type="button" class="toast__action" @click="noticeAction.run()">
        {{ noticeAction.label }}
      </button>
    </div>
  </div>
</template>
