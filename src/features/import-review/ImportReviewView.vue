<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import ResumePreview from '@/features/editor/ResumePreview.vue'
import { createId } from '@/domain/resume/defaults'
import { SECTION_LABELS, type SectionType } from '@/domain/resume/model'
import { reparseImportSection } from '@/infrastructure/api/localResumeApi'
import type { ResumeImportResult } from '@/domain/resume/importParser'

const definePropsResult = defineProps<{
  result: ResumeImportResult
  sourceUrl: string
  /** 原文来源：PDF 或 Word，仅影响文案。 */
  sourceKind?: 'pdf' | 'docx'
}>()
const result = definePropsResult.result
const sourceUrl = definePropsResult.sourceUrl
const sourceLabel = definePropsResult.sourceKind === 'docx' ? 'Word' : 'PDF'

const emit = defineEmits<{
  cancel: []
  confirm: []
}>()

const selectedSectionId = ref(definePropsResult.result.document.sections[0]?.id ?? '')

const sourceLines = computed(() => (result.sourceText ?? '').split(/\r?\n/))

/** 当前选中模块对应的原文范围，用于并排对比时高亮。 */
const activeSource = computed(() => result.sectionSources?.[selectedSectionId.value])

const pinnedLine = ref<number | null>(null)

const isActiveLine = (index: number): boolean => {
  if (index === pinnedLine.value) return true
  const range = activeSource.value
  if (!range) return false
  return index >= range.start && index < range.start + range.lines.length
}

/** 原文列的滚动容器：选中模块后把命中行滚到中间。 */
const sourceScrollRef = ref<HTMLElement | null>(null)

const scrollToActiveLine = async (): Promise<void> => {
  await nextTick()
  const container = sourceScrollRef.value
  const line = container?.querySelector<HTMLElement>('.import-source__line--active')
  if (!container || !line) return
  // 只滚这一列，别把整页也带着滚
  const target = line.offsetTop - container.clientHeight / 2 + line.clientHeight / 2
  container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
}

watch(() => [selectedSectionId.value, pinnedLine.value], scrollToActiveLine)

/** 字段级溯源：这个值是从原文哪一行抽出来的。 */
const sourceLineOf = (value: string): number | null => {
  const needle = value?.trim()
  if (!needle) return null
  const index = sourceLines.value.findIndex((line) => line.includes(needle))
  return index >= 0 ? index : null
}

const focusField = (value: string): void => {
  pinnedLine.value = sourceLineOf(value)
}

const sectionTypeOptions = Object.entries(SECTION_LABELS) as Array<[SectionType, string]>

const sectionCount = computed(() => result.document.sections.length)

/** 折叠标题里直接列出模块名，用户不用展开就能知道解析成了哪几块。 */
const sectionNames = computed(() =>
  result.document.sections.map((section) => section.title).join('、'),
)

/** 操作栏只作用于「当前选中」的模块，避免每行都塞一排按钮。 */
const selectedSection = computed(
  () => result.document.sections.find((section) => section.id === selectedSectionId.value) ?? null,
)

const reparseBusy = ref(false)
const reparseError = ref('')

/** 单模块重新解析：改完模块类型后，只重跑这一块的原文。 */
const reparseSection = async (sectionId: string): Promise<void> => {
  const section = result.document.sections.find((item) => item.id === sectionId)
  const source = result.sectionSources?.[sectionId]
  if (!section || !source) return
  reparseBusy.value = true
  reparseError.value = ''
  try {
    const updated = await reparseImportSection({
      id: section.id,
      type: section.type,
      title: section.title,
      lines: source.lines,
    })
    const index = result.document.sections.findIndex((item) => item.id === section.id)
    if (index >= 0) result.document.sections.splice(index, 1, updated)
  } catch (error) {
    reparseError.value = error instanceof Error ? error.message : '重新解析失败'
  } finally {
    reparseBusy.value = false
  }
}

const removeSection = (sectionId: string): void => {
  if (definePropsResult.result.document.sections.length <= 1) return
  definePropsResult.result.document.sections = definePropsResult.result.document.sections.filter(
    (section) => section.id !== sectionId,
  )
  if (selectedSectionId.value === sectionId)
    selectedSectionId.value = definePropsResult.result.document.sections[0]?.id ?? ''
}

const addCustomSection = (): void => {
  const section = {
    id: createId('import-section'),
    type: 'custom' as const,
    title: '新模块',
    visible: true,
    items: [
      {
        id: createId('import-item'),
        title: '',
        subtitle: '',
        period: '',
        location: '',
        content: '',
        bullets: [],
      },
    ],
  }
  definePropsResult.result.document.sections.push(section)
  selectedSectionId.value = section.id
}
</script>

<template>
  <main class="import-review">
    <header class="import-review__toolbar">
      <div class="editor-toolbar__left">
        <button type="button" class="icon-button" title="取消导入" @click="emit('cancel')">
          ←
        </button>
        <div class="document-name">
          <strong>确认导入内容</strong>
          <span>解析结果不会自动覆盖已有简历</span>
        </div>
      </div>
      <div class="editor-toolbar__actions">
        <button type="button" class="button button--secondary" @click="emit('cancel')">取消</button>
        <button type="button" class="button button--primary" @click="emit('confirm')">
          导入并开始编辑
        </button>
      </div>
    </header>

    <div class="import-review__workspace">
      <aside class="import-review__panel">
        <span class="eyebrow">IMPORT REVIEW</span>
        <h1>{{ result.document.title }}</h1>
        <p class="import-review__lead">检查一下姓名和联系方式，没问题就点右上角导入。</p>

        <ul class="import-summary">
          <li>
            识别到 <strong>{{ result.extractedLines }}</strong> 行、
            <strong>{{ sectionCount }}</strong> 个模块<template v-if="result.pages">
              （{{ sourceLabel }} 共 {{ result.pages }} 页）
            </template>
          </li>
          <li :class="{ 'is-warn': result.warnings.length > 0 }">
            {{
              result.warnings.length > 0 ? `${result.warnings.length} 项需要确认` : '没有明显异常'
            }}
          </li>
        </ul>

        <section class="review-block">
          <div class="review-block__title">个人信息</div>
          <dl class="review-fields">
            <div>
              <dt>姓名</dt>
              <dd>
                <input v-model="result.document.profile.name" aria-label="导入姓名" /><button
                  v-if="sourceLineOf(result.document.profile.name) !== null"
                  type="button"
                  class="import-src"
                  title="定位到原文这一行"
                  @click="focusField(result.document.profile.name)"
                >
                  第 {{ (sourceLineOf(result.document.profile.name) ?? 0) + 1 }} 行
                </button>
              </dd>
            </div>
            <div>
              <dt>目标职位</dt>
              <dd>
                <input
                  v-model="result.document.profile.headline"
                  aria-label="导入目标职位"
                /><button
                  v-if="sourceLineOf(result.document.profile.headline) !== null"
                  type="button"
                  class="import-src"
                  title="定位到原文这一行"
                  @click="focusField(result.document.profile.headline)"
                >
                  第 {{ (sourceLineOf(result.document.profile.headline) ?? 0) + 1 }} 行
                </button>
              </dd>
            </div>
            <div>
              <dt>电话</dt>
              <dd>
                <input v-model="result.document.profile.phone" aria-label="导入电话" /><button
                  v-if="sourceLineOf(result.document.profile.phone) !== null"
                  type="button"
                  class="import-src"
                  title="定位到原文这一行"
                  @click="focusField(result.document.profile.phone)"
                >
                  第 {{ (sourceLineOf(result.document.profile.phone) ?? 0) + 1 }} 行
                </button>
              </dd>
            </div>
            <div>
              <dt>邮箱</dt>
              <dd>
                <input v-model="result.document.profile.email" aria-label="导入邮箱" /><button
                  v-if="sourceLineOf(result.document.profile.email) !== null"
                  type="button"
                  class="import-src"
                  title="定位到原文这一行"
                  @click="focusField(result.document.profile.email)"
                >
                  第 {{ (sourceLineOf(result.document.profile.email) ?? 0) + 1 }} 行
                </button>
              </dd>
            </div>
          </dl>
        </section>

        <details class="review-block review-block--optional">
          <summary>
            <span>解析出 {{ sectionCount }} 个模块</span>
            <span class="review-block__hint">{{ sectionNames }}</span>
          </summary>
          <p class="review-modules__hint">
            解析器按标题把 {{ sourceLabel }}
            切成了这几块。通常不用管，直接导入即可；只有归类明显不对（比如实习被当成教育经历）时才需要改。
          </p>
          <div class="review-modules">
            <button
              v-for="section in result.document.sections"
              :key="section.id"
              type="button"
              class="review-module-row"
              :class="{ selected: selectedSectionId === section.id }"
              @click="selectedSectionId = section.id"
            >
              <span class="review-module-row__name">{{ section.title }}</span>
              <span class="review-module-row__meta">{{ section.items.length }} 条</span>
            </button>
          </div>

          <div v-if="selectedSection" class="review-module-bar">
            <div class="review-module-bar__head">
              <strong>{{ selectedSection.title || '未命名模块' }}</strong>
              <span v-if="reparseBusy">解析中…</span>
              <span v-else>改成别的类型会按新规则重新拆分内容</span>
            </div>
            <div class="review-module-bar__row">
              <label class="review-module-bar__field">
                这段属于
                <select
                  v-model="selectedSection.type"
                  class="review-module-type"
                  @change="reparseSection(selectedSection.id)"
                >
                  <option v-for="[value, label] in sectionTypeOptions" :key="value" :value="value">
                    {{ label }}
                  </option>
                </select>
              </label>
              <span class="review-module-bar__spacer"></span>
              <button
                type="button"
                class="text-button text-button--danger"
                @click="removeSection(selectedSection.id)"
              >
                删掉这块
              </button>
            </div>
          </div>
          <p v-if="reparseError" class="review-module-error">{{ reparseError }}</p>
          <button type="button" class="text-button import-add-module" @click="addCustomSection">
            + 添加自定义模块
          </button>
        </details>

        <section v-if="result.warnings.length" class="review-block review-block--warning">
          <div class="review-block__title">需要确认</div>
          <ul>
            <li v-for="warning in result.warnings" :key="warning">{{ warning }}</li>
          </ul>
        </section>

        <p class="import-review__meta">已提取 {{ result.extractedLines }} 行文字</p>
      </aside>

      <section class="import-result">
        <div class="import-column-heading">
          <strong>模板结果</strong>
          <span>点击模块可核对归类</span>
        </div>
        <ResumePreview
          :document="result.document"
          :selected-section-id="selectedSectionId"
          @select="selectedSectionId = $event"
        />
      </section>

      <section class="import-source">
        <div class="import-column-heading">
          <strong>{{ sourceLabel }} 原文</strong>
          <a :href="sourceUrl" target="_blank" rel="noopener">打开原文件</a>
        </div>
        <div ref="sourceScrollRef" class="import-source__text">
          <p v-if="!result.sourceText" class="import-source__empty">没有可显示的文字内容。</p>
          <div
            v-for="(line, index) in sourceLines"
            :key="index"
            class="import-source__line"
            :class="{ 'import-source__line--active': isActiveLine(index) }"
          >
            <span class="import-source__no">{{ index + 1 }}</span>
            <span class="import-source__body">{{ line }}</span>
          </div>
        </div>
      </section>
    </div>
  </main>
</template>
