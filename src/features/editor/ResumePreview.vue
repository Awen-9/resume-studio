<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ResumeHeaderBlock from './ResumeHeaderBlock.vue'
import ResumeSectionBlock from './ResumeSectionBlock.vue'
import { planFragments, type SectionMetrics } from '@/domain/resume/layout'
import {
  applyItemSplits,
  computeItemSplits,
  getEffectiveTheme,
  nextFitFactor,
  prepareSections,
  scaleTheme,
} from '@/domain/resume/pagination'
import type { ResumeDocument, ResumeSection, ResumeTheme } from '@/domain/resume/model'

const props = defineProps<{
  document: ResumeDocument
  selectedSectionId: string
}>()

const emit = defineEmits<{
  select: [id: string]
  'layout-status': [status: { pageCount: number; overflowPages: number[]; ready: boolean }]
}>()

const stageRef = ref<HTMLElement | null>(null)
/** 离屏测量容器：结构与真实页面一致，只是不可见。 */
const measureRef = ref<HTMLElement | null>(null)

const renderTheme = computed(() => getEffectiveTheme(props.document.theme))
/**
 * 实际用于渲染的主题：固定页数且内容超页时，会按比例压缩字号/行距后再排版。
 * 测量层与真实页面都用它，保证「量到的」和「看到的」一致。
 */
const fitTheme = ref<ResumeTheme>(renderTheme.value)
/** 固定页数压缩的累计比例；主题变化时归零。 */
const fitFactor = ref(1)
watch(
  renderTheme,
  (value) => {
    fitFactor.value = 1
    fitTheme.value = value
  },
  { immediate: true },
)
/**
 * 内容整形（过滤隐藏模块、拆分超长条目）在域层完成，预览与导出走同一份。
 * 这里用 ref 而不是 computed：测量后发现某一条比一页还高时，要在原列表上再切一次。
 */
const baseSections = computed(() => prepareSections(props.document.sections, renderTheme.value))
const sections = ref<ResumeSection[]>([])
watch(baseSections, (value) => (sections.value = value), { immediate: true })

/** 一页渲染什么：同一个模块可能被切成多个片段，跨页时标题重复出现。 */
interface RenderFragment {
  section: ResumeSection
  start: number
  end: number
}

interface RenderedPage {
  fragments: RenderFragment[]
  /** 固定页数时把页底空白摊到条目之间。 */
  stretch: number
}

const pages = ref<RenderedPage[]>([{ fragments: [], stretch: 0 }])
const overflowPages = ref<number[]>([])
let layoutTimer: number | undefined

/** A4 宽 210mm，按 96dpi 折算成像素；用来算预览缩放比例。 */
const PAGE_WIDTH_PX = (210 * 96) / 25.4
const stageWidth = ref(0)
let stageObserver: ResizeObserver | undefined

/**
 * 预览自适应缩放。
 *
 * 三栏布局在 1280 宽的屏幕上放不下「大纲 + A4 纸 + 属性面板」，纸张会被横向裁掉。
 * 这里按容器可用宽度等比缩小纸张，保证一页始终完整可见；
 * 测量层是离屏且不缩放的，所以分页结果不受缩放影响。
 *
 * `ResizeObserver` 给的是 content-box 宽度（已扣掉预览区左右内边距），
 * 只需再留几像素给纸的描边和投影，不能再减一次 padding。
 */
const paperZoom = computed(() => {
  const available = Math.max(320, stageWidth.value - 8)
  return Math.min(1, Math.round((available / PAGE_WIDTH_PX) * 1000) / 1000)
})
const zoomLabel = computed(() =>
  paperZoom.value < 0.995 ? `${Math.round(paperZoom.value * 100)}%` : '',
)

const pageStyle = computed(() => ({
  '--resume-font-family': fitTheme.value.fontFamily,
  '--resume-font-size': `${fitTheme.value.fontSize}px`,
  '--resume-line-height': String(fitTheme.value.lineHeight),
  '--resume-page-margin': `${fitTheme.value.pageMargin}mm`,
  '--resume-section-gap': `${fitTheme.value.sectionGap}px`,
  '--resume-accent': fitTheme.value.accentColor,
}))

/** 每页的额外间距：与 pageStyle 叠加，不覆盖。 */
const pageStyleOf = (page: RenderedPage): Record<string, string> => ({
  ...pageStyle.value,
  '--resume-stretch': `${page.stretch}px`,
})

/**
 * 固定页数时的状态说明：页数没达成，或者为了塞进去缩得太狠，都要让用户看见，
 * 而不是默默给出一份「看着满、其实字很小」的简历。
 */
const fitNotice = computed(() => {
  const target = props.document.theme.targetPages
  if (!target) return ''
  const actual = pages.value.length
  const size = Math.round(fitTheme.value.fontSize * 10) / 10
  if (actual > target) {
    return `内容放不进 ${target} 页：已缩到最小字号仍需要 ${actual} 页，建议精简内容。`
  }
  if (actual < target) {
    return `内容不足以铺满 ${target} 页（当前 ${actual} 页），可以补充内容。`
  }
  if (fitFactor.value < 0.75) return `为放进 ${target} 页，正文已缩到约 ${size}px。`
  if (fitFactor.value > 1.02) return `为铺满 ${target} 页，正文已放大到约 ${size}px。`
  return ''
})

/**
 * 量一次，分一次，画一次；必要时再切一刀。
 *
 * 之前是「先按字符数猜，再在 DOM 里反复搬运溢出的块」，最多 40 轮，而且和导出的
 * 那份逻辑各写各的。现在只做：实测高度 → `planFragments` 装箱 → 渲染。
 * 预览与导出用的是同一个装箱函数，区别只在谁来量（浏览器 / 无头 Chromium）。
 *
 * `attempt` 用于「某一条内容比一整页还高」的情况：按实测高度再切一次并重新测量，
 * 最多补两轮，避免无限循环。
 */
const measureLayout = async (attempt = 0): Promise<void> => {
  await nextTick()
  const root = measureRef.value
  const host = root?.querySelector<HTMLElement>('.resume-page')
  if (!root || !host) return

  const style = getComputedStyle(host)
  const contentHeight =
    host.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
  const header = root.querySelector<HTMLElement>('[data-measure-header]')
  const headerHeight = header ? header.getBoundingClientRect().height : 0

  // 模块间距挂在 section 上，量标题时一并计入；条目间距同理
  const marginTop = (element: Element): number =>
    parseFloat(getComputedStyle(element).marginTop) || 0
  const metrics: SectionMetrics[] = Array.from(
    root.querySelectorAll<HTMLElement>('[data-measure-section]'),
  ).map((element) => {
    const heading = element.querySelector<HTMLElement>('[data-measure-heading]')
    const items = Array.from(element.querySelectorAll<HTMLElement>('[data-measure-item]'))
    return {
      sectionId: element.dataset.measureSection ?? '',
      headingHeight: (heading ? heading.getBoundingClientRect().height : 0) + marginTop(element),
      itemHeights: items.map((item) => item.getBoundingClientRect().height + marginTop(item)),
    }
  })

  // 一条内容本身高过整页：按实测高度切开，再量一次
  const splits = computeItemSplits(metrics, contentHeight)
  if (splits.length > 0 && attempt < 2) {
    sections.value = applyItemSplits(sections.value, splits)
    await nextTick()
    return measureLayout(attempt + 1)
  }

  // 第 1 页给头部让位，其余页用满整页
  const capacities = [
    contentHeight - headerHeight,
    ...Array.from({ length: 200 }, () => contentHeight),
  ]

  // 固定页数：页数不符就按比例缩放字号/行距/间距再量一次。
  // 「强制」的含义是不设人工下限——内容多就一路缩到放得下为止（直到 MIN_FIT_FACTOR）。
  const target = props.document.theme.targetPages ?? null
  if (target) {
    const natural = planFragments(metrics, capacities, null)
    const available = capacities[0] + (target - 1) * capacities[1]
    const total = metrics.reduce(
      (sum, section) =>
        sum + section.headingHeight + section.itemHeights.reduce((a, b) => a + b, 0),
      0,
    )
    const next = nextFitFactor(fitFactor.value, natural.pages.length, target, total, available)
    if (next !== null && attempt < 8) {
      fitFactor.value = next
      fitTheme.value = scaleTheme(renderTheme.value, next)
      await nextTick()
      return measureLayout(attempt + 1)
    }
  }

  const plan = planFragments(metrics, capacities, target)

  const byId = new Map(sections.value.map((section) => [section.id, section]))
  pages.value = plan.pages.map((fragments, index) => ({
    fragments: fragments.flatMap((fragment) => {
      const section = byId.get(fragment.sectionId)
      if (!section) return []
      return [{ section, start: fragment.start, end: fragment.end }]
    }),
    stretch: plan.stretch[index] ?? 0,
  }))
  overflowPages.value = plan.overflowPages
  emit('layout-status', {
    pageCount: pages.value.length,
    overflowPages: plan.overflowPages,
    ready: true,
  })
}

const scheduleLayout = (): void => {
  if (layoutTimer) window.clearTimeout(layoutTimer)
  layoutTimer = window.setTimeout(() => void measureLayout(), 60)
}

watch(() => props.document, scheduleLayout, { deep: true })

onMounted(async () => {
  // 预览区宽度变化（窗口缩放、属性面板收起）时重算缩放比例
  if (stageRef.value) {
    stageWidth.value = stageRef.value.clientWidth
    stageObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      if (width > 0) stageWidth.value = width
    })
    stageObserver.observe(stageRef.value)
  }
  scheduleLayout()
  // 自定义字体加载完高度会变，等字体就绪再重量一次
  await document.fonts?.ready
  scheduleLayout()
})

onBeforeUnmount(() => {
  stageObserver?.disconnect()
  if (layoutTimer) window.clearTimeout(layoutTimer)
})

/**
 * 一个超长模块会被预切成 `…-1`、`…-2` 这样的多段再分别渲染，
 * 所以要用「等于 id 或以 id- 开头」来匹配，不能只比全等。
 */
const matchesSelection = (sectionId: string): boolean =>
  Boolean(props.selectedSectionId) &&
  (sectionId === props.selectedSectionId || sectionId.startsWith(`${props.selectedSectionId}-`))

const sectionClass = (section: ResumeSection): string =>
  matchesSelection(section.id) ? 'resume-section is-selected' : ''

/**
 * 选中模块后把它滚到视野中间。
 *
 * 之前只在预览里加一圈虚线，用户点了模块列表「没有反应」——因为选中的那段
 * 常常在第 2/3 页，或高亮太淡。滚动是唯一能让人确认「点到了」的反馈。
 */
watch(
  () => props.selectedSectionId,
  async (id) => {
    if (!id) return
    await nextTick()
    // 模块 id 只含字母数字和连字符，这里仍做最小转义，避免属性选择器被注入打断
    const safeId = id.replace(/["\\]/g, '\\$&')
    const target =
      stageRef.value?.querySelector<HTMLElement>(`[data-section-id="${safeId}"]`) ??
      stageRef.value?.querySelector<HTMLElement>(`[data-section-id^="${safeId}-"]`)
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  },
)
</script>

<template>
  <div ref="stageRef" class="preview-stage" data-testid="resume-preview">
    <!--
      离屏测量层：与真实页面同宽同字体，只是移出视口。
      它只负责「高度」，不参与展示，也不接受点击。
    -->
    <div ref="measureRef" class="layout-measure" aria-hidden="true">
      <article
        class="resume-page"
        :class="[
          `template-${document.theme.templateId}`,
          `page-mode-${document.theme.pageMode ?? 'standard'}`,
        ]"
        :style="pageStyle"
      >
        <ResumeHeaderBlock :document="document" data-measure-header />
        <ResumeSectionBlock
          v-for="section in sections"
          :key="section.id"
          :section="section"
          measure
        />
      </article>
    </div>

    <div class="preview-stage__meta">
      <span>A4 预览</span>
      <span>{{ pages.length }} 页{{ zoomLabel ? ` · ${zoomLabel}` : '' }}</span>
    </div>
    <div v-if="overflowPages.length" class="preview-stage__warning" role="status">
      第 {{ overflowPages.join('、') }} 页超出 A4 高度（预览已完整显示），导出时会自动分页。
    </div>
    <div v-if="fitNotice" class="preview-stage__warning preview-stage__warning--info" role="status">
      {{ fitNotice }}
    </div>
    <div class="paper-stack" :style="{ zoom: paperZoom }">
      <article
        v-for="(page, pageIndex) in pages"
        :key="pageIndex"
        class="resume-page"
        :class="[
          `template-${document.theme.templateId}`,
          `page-mode-${document.theme.pageMode ?? 'standard'}`,
        ]"
        :style="pageStyleOf(page)"
        :data-page="pageIndex + 1"
      >
        <ResumeHeaderBlock v-if="pageIndex === 0" :document="document" />
        <ResumeSectionBlock
          v-for="fragment in page.fragments"
          :key="`${fragment.section.id}-${fragment.start}`"
          :section="fragment.section"
          :slice="{ start: fragment.start, end: fragment.end }"
          :class="sectionClass(fragment.section)"
          :data-section-id="fragment.section.id"
          @click="emit('select', fragment.section.id)"
        />
        <footer v-if="document.theme.showPageNumber" class="resume-page__number">
          {{ pageIndex + 1 }}
        </footer>
      </article>
    </div>
  </div>
</template>
