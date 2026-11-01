<script setup lang="ts">
import { computed, ref } from 'vue'
import ExportCheckDialog from './ExportCheckDialog.vue'
import InspectorPanel from './InspectorPanel.vue'
import ResumePreview from './ResumePreview.vue'
import SectionOutline from './SectionOutline.vue'
import type { ResumeDocument, ResumeSection, SectionType } from '@/domain/resume/model'
import type { ResumeLayoutStatus } from '@/domain/resume/checks'

const props = defineProps<{
  document: ResumeDocument
  savedAt: string | null
  history: ResumeDocument[]
  canUndo: boolean
  canRedo: boolean
}>()

const emit = defineEmits<{
  back: []
  save: []
  exportPdf: []
  exportDocx: []
  duplicate: []
  addSection: [type: SectionType]
  removeSection: [id: string]
  moveSection: [id: string, direction: -1 | 1]
  reorderSection: [id: string, targetIndex: number]
  history: []
  restoreHistory: [document: ResumeDocument]
  undo: []
  redo: []
}>()

const selectedSectionId = ref(props.document.sections[0]?.id ?? '')
const showInspector = ref(true)
const showHistory = ref(false)
const showExportCheck = ref(false)
const exportFormat = ref<'pdf' | 'docx'>('pdf')
const layoutStatus = ref<ResumeLayoutStatus>({ pageCount: 1, overflowPages: [], ready: true })
const savedLabel = computed(() =>
  props.savedAt
    ? `已保存 ${new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(props.savedAt))}`
    : '未保存',
)

const selectSection = (id: string): void => {
  selectedSectionId.value = id
}

const toggleSection = (section: ResumeSection): void => {
  section.visible = !section.visible
  emit('save')
}

const formatHistoryDate = (value: string): string => {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

const toggleHistory = (): void => {
  showHistory.value = !showHistory.value
  emit('history')
}

const confirmExport = (): void => {
  showExportCheck.value = false
  if (exportFormat.value === 'docx') emit('exportDocx')
  else emit('exportPdf')
}

const requestExport = (format: 'pdf' | 'docx'): void => {
  exportFormat.value = format
  const pageElements = Array.from(
    window.document.querySelectorAll<HTMLElement>('.editor-view .resume-page'),
  )
  layoutStatus.value = {
    pageCount: Math.max(1, pageElements.length),
    overflowPages: pageElements
      .map((page, index) => (page.scrollHeight > page.clientHeight + 2 ? index + 1 : 0))
      .filter((pageNumber) => pageNumber > 0),
    ready: true,
  }
  showExportCheck.value = true
}
</script>

<template>
  <main class="editor-view" :data-layout-ready="layoutStatus.ready">
    <header class="editor-toolbar">
      <div class="editor-toolbar__left">
        <button type="button" class="icon-button" title="返回简历列表" @click="emit('back')">
          ←
        </button>
        <div class="document-name">
          <input
            v-model="document.title"
            aria-label="简历名称"
            type="text"
            @blur="emit('save')"
          /><span>{{ savedLabel }}</span>
        </div>
      </div>
      <div class="editor-toolbar__actions">
        <button type="button" class="icon-button" title="保存" @click="emit('save')">⌘S</button>
        <button
          type="button"
          class="icon-button"
          title="撤销"
          :disabled="!canUndo"
          @click="emit('undo')"
        >
          ↶
        </button>
        <button
          type="button"
          class="icon-button"
          title="重做"
          :disabled="!canRedo"
          @click="emit('redo')"
        >
          ↷
        </button>
        <button
          type="button"
          class="button button--secondary button--with-icon"
          @click="emit('duplicate')"
        >
          复制
        </button>
        <button type="button" class="button button--secondary" @click="toggleHistory">历史</button>
        <button
          type="button"
          class="button button--secondary button--with-icon"
          @click="requestExport('pdf')"
        >
          ↓ 导出 PDF
        </button>
        <button type="button" class="button button--secondary" @click="requestExport('docx')">
          ↓ 导出 Word
        </button>
        <button type="button" class="button button--primary" @click="requestExport('pdf')">
          预览并导出
        </button>
      </div>
    </header>

    <div class="editor-workspace">
      <SectionOutline
        :sections="document.sections"
        :selected-section-id="selectedSectionId"
        @select="selectSection"
        @layout-status="layoutStatus = $event"
        @toggle="toggleSection"
        @move="(id, direction) => emit('moveSection', id, direction)"
        @reorder="(id, targetIndex) => emit('reorderSection', id, targetIndex)"
        @remove="(id) => emit('removeSection', id)"
        @add="(type) => emit('addSection', type)"
      />

      <ResumePreview
        :document="document"
        :selected-section-id="selectedSectionId"
        @select="selectSection"
      />

      <div class="inspector-wrap" :class="{ collapsed: !showInspector }">
        <button
          type="button"
          class="inspector-toggle"
          :title="showInspector ? '收起属性面板' : '展开属性面板'"
          @click="showInspector = !showInspector"
        >
          {{ showInspector ? '›' : '‹' }}
        </button>
        <InspectorPanel
          v-if="showInspector"
          :document="document"
          :selected-section-id="selectedSectionId"
          @change="emit('save')"
          @remove-section="emit('removeSection', $event)"
        />
      </div>
    </div>

    <aside v-if="showHistory" class="history-drawer">
      <div class="history-drawer__header">
        <div>
          <span class="eyebrow">LOCAL HISTORY</span>
          <h2>历史版本</h2>
        </div>
        <button type="button" class="icon-button" title="关闭历史版本" @click="showHistory = false">
          ×
        </button>
      </div>
      <p v-if="history.length === 0" class="muted-text">还没有历史版本。</p>
      <div v-else class="history-list">
        <div
          v-for="(version, index) in history"
          :key="`${version.id}-${version.updatedAt}-${index}`"
          class="history-list__item"
        >
          <div>
            <strong>{{ index === 0 ? '最近版本' : '历史版本' }}</strong
            ><small>{{ formatHistoryDate(version.updatedAt) }}</small>
          </div>
          <button type="button" class="text-button" @click="emit('restoreHistory', version)">
            恢复
          </button>
        </div>
      </div>
    </aside>

    <ExportCheckDialog
      v-if="showExportCheck"
      :document="document"
      :layout="layoutStatus"
      :format="exportFormat"
      @close="showExportCheck = false"
      @confirm="confirmExport"
    />
  </main>
</template>
