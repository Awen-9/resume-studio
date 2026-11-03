<script setup lang="ts">
import { computed, ref } from 'vue'
import { TEMPLATE_LABELS } from '@/domain/resume/model'
import type { ResumeSummary, TemplateId } from '@/domain/resume/model'

const props = defineProps<{
  documents: ResumeSummary[]
  lastBackupAt?: string | null
}>()

const emit = defineEmits<{
  open: [id: string]
  create: [templateId: TemplateId]
  remove: [id: string]
  backup: []
  restore: [file: File]
  importPdf: [file: File]
  importDocx: [file: File]
  export: [id: string, format: 'pdf' | 'docx' | 'txt']
  sample: []
  interview: []
  agent: []
  settings: []
}>()

const query = ref('')

/** 备份提醒：本地存储清空即丢，超过 7 天没备份就提示。 */
const backupHint = computed(() => {
  if (!props.lastBackupAt) return { text: '还没有做过备份', stale: true }
  const days = Math.floor(
    (Date.now() - new Date(props.lastBackupAt).getTime()) / (24 * 60 * 60 * 1000),
  )
  if (days <= 0) return { text: '今天已备份', stale: false }
  return { text: `上次备份 ${days} 天前`, stale: days >= 7 }
})

const isEmpty = computed(() => props.documents.length === 0)

const formatTime = (value: string): string =>
  new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))

/** 按「今天 / 昨天 / 本周 / 本月 / 更早」分组，比一串绝对时间好找。 */
const dayLabel = (value: string): string => {
  const date = new Date(value)
  const now = new Date()
  const startOfDay = (input: Date): number =>
    new Date(input.getFullYear(), input.getMonth(), input.getDate()).getTime()
  const diffDays = Math.floor((startOfDay(now) - startOfDay(date)) / 86_400_000)
  if (diffDays <= 0) return '今天'
  if (diffDays === 1) return '昨天'
  if (diffDays < 7) return '本周'
  if (diffDays < 30) return '本月'
  return '更早'
}

const groups = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  const matched = props.documents.filter((document) =>
    keyword
      ? `${document.title} ${document.targetRole ?? ''}`.toLowerCase().includes(keyword)
      : true,
  )
  const order = ['今天', '昨天', '本周', '本月', '更早']
  const buckets = new Map<string, ResumeSummary[]>()
  for (const document of matched) {
    const label = dayLabel(document.updatedAt)
    buckets.set(label, [...(buckets.get(label) ?? []), document])
  }
  return order
    .filter((label) => buckets.has(label))
    .map((label) => ({ label, items: buckets.get(label) ?? [] }))
})

const onRestore = (event: Event): void => {
  const input = event.target as HTMLInputElement
  if (input.files?.[0]) emit('restore', input.files[0])
  input.value = ''
}

/** 合并导入：按扩展名自动分发到 PDF 或 Word 解析。 */
const onImport = (event: Event): void => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (/\.docx?$/i.test(file.name)) emit('importDocx', file)
  else emit('importPdf', file)
  input.value = ''
}
</script>

<template>
  <main class="home-view">
    <header class="home-header">
      <div>
        <span class="eyebrow">LOCAL RESUME STUDIO</span>
        <h1>我的简历</h1>
        <p>内容保存在本机，打开就能继续编辑。</p>
        <p class="home-backup" :class="{ 'home-backup--stale': backupHint.stale }">
          <span class="home-backup__dot" aria-hidden="true"></span>{{ backupHint.text }}
          <button v-if="backupHint.stale" type="button" class="text-button" @click="emit('backup')">
            立即备份
          </button>
          <span v-else class="home-backup__tip">（清浏览器缓存会丢，建议定期导出备份）</span>
        </p>
      </div>
      <div class="home-actions">
        <button type="button" class="button button--secondary" @click="emit('backup')">
          导出备份
        </button>
        <label class="button button--secondary" for="restore-file"
          >导入备份<input
            id="restore-file"
            type="file"
            accept="application/json"
            hidden
            @change="onRestore"
        /></label>
        <label class="button button--secondary" for="import-file"
          >导入简历<input
            id="import-file"
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            hidden
            @change="onImport"
        /></label>
        <button type="button" class="button button--secondary" @click="emit('agent')">
          AI Agent
        </button>
        <button type="button" class="button button--secondary" @click="emit('settings')">
          设置
        </button>
        <button type="button" class="button button--secondary" @click="emit('interview')">
          面试出题
        </button>
        <button type="button" class="button button--primary" @click="emit('create', 'classic')">
          + 新建简历
        </button>
      </div>
    </header>

    <section v-if="isEmpty" class="home-empty">
      <h2>还没有简历</h2>
      <p>已经有 PDF 或 Word 简历的话，直接导入最快；也可以从空白模板开始写。</p>
      <div class="home-empty__actions">
        <label class="button button--primary" for="import-file-empty"
          >导入已有简历<input
            id="import-file-empty"
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            hidden
            @change="onImport"
        /></label>
        <button type="button" class="button button--secondary" @click="emit('create', 'classic')">
          从空白开始
        </button>
        <button type="button" class="button button--secondary" @click="emit('sample')">
          看看示例
        </button>
      </div>
      <p class="home-empty__hint">解析结果会先进入确认页，不会直接覆盖任何东西。</p>
    </section>

    <template v-else>
      <section class="home-section">
        <div class="section-heading-row">
          <div>
            <span class="eyebrow">DOCUMENTS</span>
            <h2>全部简历</h2>
          </div>
          <div class="home-search">
            <input
              v-model="query"
              type="search"
              placeholder="搜索名称或投递岗位"
              aria-label="搜索简历"
            />
            <span class="muted-text">{{ documents.length }} 份</span>
          </div>
        </div>

        <div v-for="group in groups" :key="group.label" class="document-group">
          <h3 class="document-group__title">{{ group.label }}</h3>
          <div class="document-grid">
            <!--
              卡片外层原来是 <button>，删除入口是嵌在它里面的 role="button"——
              HTML 不允许交互元素嵌套，读屏和键盘都会错乱。改成「卡片容器 + 两个平级按钮」。
            -->
            <div v-for="document in group.items" :key="document.id" class="document-card">
              <button
                type="button"
                class="document-card__open"
                :aria-label="`打开 ${document.title}`"
                @click="emit('open', document.id)"
              >
                <span class="document-card__preview" :class="`template-${document.templateId}`"
                  ><span></span><span></span><span></span><span></span
                ></span>
                <span class="document-card__body"
                  ><strong>{{ document.title }}</strong
                  ><small v-if="document.targetRole">投 · {{ document.targetRole }}</small
                  ><small
                    >{{ TEMPLATE_LABELS[document.templateId] }} ·
                    {{ formatTime(document.updatedAt) }}</small
                  ></span
                >
              </button>
              <button
                type="button"
                class="document-card__delete"
                :aria-label="`删除 ${document.title}`"
                title="删除简历"
                @click.stop="emit('remove', document.id)"
              >
                ×
              </button>
              <details class="document-card__export">
                <summary class="text-button" title="导出">导出</summary>
                <div class="document-card__export-menu">
                  <button type="button" @click.stop="emit('export', document.id, 'pdf')">
                    PDF
                  </button>
                  <button type="button" @click.stop="emit('export', document.id, 'docx')">
                    Word
                  </button>
                  <button type="button" @click.stop="emit('export', document.id, 'txt')">
                    纯文本
                  </button>
                </div>
              </details>
            </div>
            <button
              v-if="group.label === groups[0]?.label"
              type="button"
              class="document-card document-card--new"
              @click="emit('create', 'classic')"
            >
              <span class="document-card--new__icon">+</span><strong>创建一份新简历</strong
              ><small>从经典黑白模板开始</small>
            </button>
          </div>
        </div>

        <p v-if="query && groups.length === 0" class="muted-text">
          没有匹配「{{ query }}」的简历。
        </p>
      </section>

      <section class="home-section template-section">
        <div class="section-heading-row">
          <div>
            <span class="eyebrow">TEMPLATES</span>
            <h2>选择一个起点</h2>
          </div>
        </div>
        <div class="template-grid">
          <button
            v-for="template in ['classic', 'compact', 'accent'] as TemplateId[]"
            :key="template"
            type="button"
            class="template-card"
            @click="emit('create', template)"
          >
            <span class="document-card__preview" :class="`template-${template}`"
              ><span></span><span></span><span></span><span></span
            ></span>
            <span
              ><strong>{{ TEMPLATE_LABELS[template] }}</strong
              ><small>新建并开始编辑</small></span
            >
          </button>
        </div>
      </section>
    </template>
  </main>
</template>
