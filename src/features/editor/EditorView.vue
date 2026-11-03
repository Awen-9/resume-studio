<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ExportCheckDialog from './ExportCheckDialog.vue'
import InspectorPanel from './InspectorPanel.vue'
import ResumePreview from './ResumePreview.vue'
import ResumeOptimizeDialog from './ResumeOptimizeDialog.vue'
import SectionOutline from './SectionOutline.vue'
import type { ResumeDocument, ResumeSection, SectionType } from '@/domain/resume/model'
import type { ResumeLayoutStatus } from '@/domain/resume/checks'
import { checkResumeBeforeExport } from '@/domain/resume/checks'
import { stripHtml } from '@/domain/resume/validation'

/**
 * JD 体检弹窗只在用户点开时才需要，单独切一个 chunk：
 * 它带着自己的状态机和样式，没必要让首页/编辑器首屏为它买单。
 */
const JobMatchDialog = defineAsyncComponent(() => import('./JobMatchDialog.vue'))

const props = defineProps<{
  document: ResumeDocument
  savedAt: string | null
  /** 有编辑还没落盘：工具栏显示「保存中…」，也用于自动化等待保存完成。 */
  dirty: boolean
  history: ResumeDocument[]
  canUndo: boolean
  canRedo: boolean
  /** 正在生成导出文件：期间禁用导出入口，避免同时跑两个无头浏览器。 */
  exporting?: boolean
}>()

const emit = defineEmits<{
  back: []
  save: []
  exportPdf: []
  exportDocx: []
  exportTxt: []
  duplicate: []
  addSection: [type: SectionType]
  removeSection: [id: string]
  removeItem: [sectionId: string, itemId: string]
  moveItem: [sectionId: string, itemId: string, direction: -1 | 1]
  moveSection: [id: string, direction: -1 | 1]
  reorderSection: [id: string, targetIndex: number]
  history: []
  restoreHistory: [document: ResumeDocument]
  undo: []
  redo: []
}>()

const selectedSectionId = ref(props.document.sections[0]?.id ?? '')
const showInspector = ref(true)

/**
 * 窄屏（<980px）下属性面板是覆盖式抽屉，默认收起；
 * 变宽时不自动展开——那是用户的主动选择，不该被窗口尺寸改掉。
 */
const narrowLayout = window.matchMedia('(max-width: 979px)')
const onLayoutChange = (event: { matches: boolean }): void => {
  if (event.matches) showInspector.value = false
}

onMounted(() => {
  onLayoutChange(narrowLayout)
  narrowLayout.addEventListener('change', onLayoutChange)
})

onBeforeUnmount(() => {
  narrowLayout.removeEventListener('change', onLayoutChange)
})
const showHistory = ref(false)
const showExportCheck = ref(false)
/** 检查弹窗的两种用法：导出前检查 / 随手检查。 */
const checkOnly = ref(false)
const showJobMatch = ref(false)
const showOptimize = ref(false)
/** 首次打开后保持挂载：关闭再打开时体检结果还在，不用重新等一次深度评估。 */
const jobMatchMounted = ref(false)
const openJobMatch = (): void => {
  jobMatchMounted.value = true
  showJobMatch.value = true
}
const exportFormat = ref<'pdf' | 'docx'>('pdf')
/**
 * 排版状态由预览组件实测后上报，这里是唯一来源。
 * `ready: false` 表示还没测完，导出检查会据此拦住导出。
 */
const layoutStatus = ref<ResumeLayoutStatus>({ pageCount: 1, overflowPages: [], ready: false })
const savedLabel = computed(() => {
  if (props.dirty) return '保存中…'
  return props.savedAt
    ? `已保存 ${new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(props.savedAt))}`
    : '未保存'
})

const selectSection = (id: string): void => {
  selectedSectionId.value = id
}

/**
 * 新增模块后自动选中它。
 *
 * store 的 `addSection` 是同步 push，回调返回时新模块已经在列表末尾；
 * 不选中的话用户加完还得自己去列表里找一遍。
 */
const addSection = (type: SectionType): void => {
  emit('addSection', type)
  const added = props.document.sections[props.document.sections.length - 1]
  if (added) selectedSectionId.value = added.id
}

/** 删除模块后选中相邻的一个，避免右栏的模块编辑区整块消失。 */
const removeSection = (id: string): void => {
  const index = props.document.sections.findIndex((section) => section.id === id)
  const neighbour = props.document.sections[index + 1] ?? props.document.sections[index - 1]
  emit('removeSection', id)
  if (neighbour && neighbour.id !== id) selectedSectionId.value = neighbour.id
}

/**
 * JD 建议里的「去修改」：按关键词找到最相关的模块并选中。
 *
 * 关键词可能出现在模块标题、条目抬头，也可能只出现在富文本正文里，
 * 所以这里把 `content` 去掉标签后一起参与匹配；实在找不到才落到第一个模块。
 */
const gotoFromSuggestion = (keyword: string): void => {
  showJobMatch.value = false
  const needle = keyword.trim().toLowerCase()
  const target = needle
    ? (props.document.sections.find((section) =>
        [
          section.title,
          ...section.items.flatMap((item) => [
            item.title,
            item.subtitle,
            item.period,
            item.location,
            stripHtml(item.content),
            ...item.bullets,
          ]),
        ]
          .join(' ')
          .toLowerCase()
          .includes(needle),
      ) ?? props.document.sections[0])
    : props.document.sections[0]
  if (target) selectedSectionId.value = target.id
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

/**
 * 历史抽屉也要能 Esc 关闭。
 *
 * 导出台账/体检弹窗都支持 Esc，抽屉不支持就成了「同一个手势，时灵时不灵」。
 * 有弹窗压在上面时先让弹窗处理，避免一次关两层。
 */
const onHistoryKey = (event: KeyboardEvent): void => {
  if (event.key !== 'Escape' || !showHistory.value) return
  if (showJobMatch.value || showExportCheck.value) return
  showHistory.value = false
}

watch(showHistory, (open) => {
  if (open) window.addEventListener('keydown', onHistoryKey)
  else window.removeEventListener('keydown', onHistoryKey)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onHistoryKey)
})

const confirmExport = (): void => {
  showExportCheck.value = false
  if (exportFormat.value === 'docx') emit('exportDocx')
  else emit('exportPdf')
}

const requestExport = (format: 'pdf' | 'docx'): void => {
  exportFormat.value = format
  checkOnly.value = false
  showExportCheck.value = true
}

/** 随手检查：不导出，只看问题清单，让用户早点发现问题而不是等到最后一步。 */
const openCheck = (): void => {
  checkOnly.value = true
  showExportCheck.value = true
}

/** 工具栏上的问题数：有错才算，成功项不计入。 */
const issueCount = computed(
  () =>
    checkResumeBeforeExport(props.document, layoutStatus.value).filter(
      (issue) => issue.severity !== 'success',
    ).length,
)
</script>

<template>
  <main class="editor-view" :data-layout-ready="layoutStatus.ready" :data-dirty="dirty">
    <header class="editor-toolbar">
      <div class="editor-toolbar__left">
        <button
          type="button"
          class="icon-button"
          aria-label="返回简历列表"
          title="返回简历列表"
          @click="emit('back')"
        >
          ←
        </button>
        <div class="document-name">
          <!-- 用 input 而不是 blur：只在失焦时保存的话，改完标题直接关页面会丢 -->
          <input
            v-model="document.title"
            aria-label="简历名称"
            type="text"
            @input="emit('save')"
          /><span>{{ savedLabel }}</span>
        </div>
      </div>
      <div class="editor-toolbar__actions">
        <!--
          mousedown.prevent 是刻意加的：点按钮时若先让编辑器失焦，
          就分不清该撤销文本还是撤销结构。保住焦点，路由才准确。
        -->
        <button
          type="button"
          class="icon-button"
          aria-label="撤销"
          title="撤销（正文里按字符、结构上按保存点）"
          :disabled="!canUndo"
          @mousedown.prevent
          @click="emit('undo')"
        >
          ↶
        </button>
        <button
          type="button"
          class="icon-button"
          aria-label="重做"
          title="重做"
          :disabled="!canRedo"
          @mousedown.prevent
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
        <button type="button" class="button button--secondary" @click="showOptimize = true">
          AI 改简历
        </button>
        <button type="button" class="button button--secondary" @click="openJobMatch">
          JD 匹配
        </button>
        <!-- 检查是常驻的，不用等到导出才发现问题 -->
        <button
          type="button"
          class="button button--secondary button--with-icon"
          :title="issueCount ? `${issueCount} 项待处理` : '检查简历是否有遗漏'"
          @click="openCheck"
        >
          检查<span v-if="issueCount" class="check-badge">{{ issueCount }}</span>
        </button>
        <button
          type="button"
          class="button button--secondary"
          :disabled="exporting"
          title="导出纯文本，方便粘贴到招聘网站表单"
          @click="emit('exportTxt')"
        >
          导出纯文本
        </button>
        <button
          type="button"
          class="button button--secondary"
          :disabled="exporting"
          :title="exporting ? '正在生成导出文件…' : '导出 Word 并保留格式'"
          @click="requestExport('docx')"
        >
          导出 Word
        </button>
        <button
          type="button"
          class="button button--primary"
          :disabled="exporting"
          @click="requestExport('pdf')"
        >
          {{ exporting ? '生成中…' : '预览并导出' }}
        </button>
      </div>
    </header>

    <div class="editor-workspace">
      <SectionOutline
        :sections="document.sections"
        :selected-section-id="selectedSectionId"
        @select="selectSection"
        @toggle="toggleSection"
        @move="(id, direction) => emit('moveSection', id, direction)"
        @reorder="(id, targetIndex) => emit('reorderSection', id, targetIndex)"
        @remove="removeSection"
        @add="addSection"
      />

      <ResumePreview
        :document="document"
        :selected-section-id="selectedSectionId"
        @select="selectSection"
        @layout-status="layoutStatus = $event"
      />

      <div class="inspector-wrap" :class="{ collapsed: !showInspector }">
        <button
          type="button"
          class="inspector-toggle"
          :title="showInspector ? '收起属性面板' : '展开属性面板'"
          :aria-label="showInspector ? '收起属性面板' : '展开属性面板'"
          :aria-expanded="showInspector"
          @click="showInspector = !showInspector"
        >
          {{ showInspector ? '›' : '‹' }}
        </button>
        <InspectorPanel
          v-if="showInspector"
          :document="document"
          :selected-section-id="selectedSectionId"
          :page-count="layoutStatus.pageCount"
          @change="emit('save')"
          @remove-section="removeSection"
          @remove-item="(sectionId, itemId) => emit('removeItem', sectionId, itemId)"
          @move-item="
            (sectionId, itemId, direction) => emit('moveItem', sectionId, itemId, direction)
          "
        />
      </div>
    </div>

    <aside v-if="showHistory" class="history-drawer">
      <div class="history-drawer__header">
        <div>
          <span class="eyebrow">LOCAL HISTORY</span>
          <h2>历史版本</h2>
        </div>
        <button
          type="button"
          class="icon-button"
          aria-label="关闭历史版本"
          title="关闭历史版本"
          @click="showHistory = false"
        >
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
      v-model:format="exportFormat"
      :document="document"
      :layout="layoutStatus"
      :mode="checkOnly ? 'check' : 'export'"
      @close="showExportCheck = false"
      @confirm="confirmExport"
    />

    <ResumeOptimizeDialog
      v-if="showOptimize"
      :document="document"
      @close="showOptimize = false"
      @change="emit('save')"
    />
    <JobMatchDialog
      v-if="jobMatchMounted"
      v-show="showJobMatch"
      :document="document"
      :open="showJobMatch"
      @close="showJobMatch = false"
      @goto="gotoFromSuggestion"
    />
  </main>
</template>
