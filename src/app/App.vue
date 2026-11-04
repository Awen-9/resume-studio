<script setup lang="ts">
import { defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
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
import type { ResumeDocument, TemplateId } from '@/domain/resume/model'
import { createSampleDocument } from '@/domain/resume/defaults'
import { onUnexpectedError } from '@/shared/ui/errorBus'
import { SYNC_KEY_PREFIX, useAutoSave } from './composables/useAutoSave'
import { useBackup } from './composables/useBackup'
import { useResumeImport } from './composables/useResumeImport'
import { useResumeExport } from './composables/useResumeExport'
import { useSectionEditing } from './composables/useSectionEditing'
import { useShortcuts } from './composables/useShortcuts'

const store = useResumeStore()
const { dirty, scheduleSave, flushSave } = useAutoSave(store)
const screen = ref<'home' | 'editor' | 'import-review' | 'interview' | 'agent' | 'settings'>('home')
const notice = ref('')
/** toast 上的可选操作（例如「撤销删除」），没有操作时 2.4s 自动消失。 */
const noticeAction = ref<{ label: string; run: () => void } | null>(null)
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

const { importReview, importSourceUrl, importSourceKind, importPdf, importDocx, confirmImport, cancelImport } =
  useResumeImport({
    store,
    notice,
    showNotice,
    goReview: () => {
      screen.value = 'import-review'
    },
    goEditor: () => {
      screen.value = 'editor'
    },
    goHome: () => {
      screen.value = 'home'
    },
  })

const { exporting, exportPdf, exportDocx, exportTxt, exportDocument } = useResumeExport({
  store,
  flushSave,
  notice,
  showNotice,
})

const { addSection, removeSection, moveSection, moveItem, removeItem, reorderSection } =
  useSectionEditing({ store, scheduleSave, showNotice })

const { canUndo, canRedo, undo, redo } = useShortcuts({ store, showNotice })

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
  window.removeEventListener('storage', onStorage)
  stopErrorListener?.()
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
