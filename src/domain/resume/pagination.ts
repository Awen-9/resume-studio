import type { SectionMetrics } from './layout.js'
import type { PageMode, ResumeItem, ResumeSection, ResumeTheme } from './model.js'
import { itemTextLength, stripHtml } from './validation.js'

/**
 * 归一化页面模式，兼容历史遗留值。
 *
 * 早期版本使用 `'one-page'` 表示「强制一页」，后统一为 `'one-page-strict'`。
 * 旧数据若仍携带 `'one-page'`，在此处归一化为 `'one-page-strict'`，避免渲染与检查失效。
 * 输入类型放宽为 `string | undefined`，以兼容从 IndexedDB/JSON 反序列化出的历史数据。
 */
export const normalizePageMode = (mode: ResumeTheme['pageMode'] | string | undefined): PageMode => {
  if (mode === 'one-page-preferred') return 'one-page-preferred'
  if (mode === 'one-page-strict' || mode === 'one-page') return 'one-page-strict'
  return 'standard'
}

export const getEffectiveTheme = (theme: ResumeTheme): ResumeTheme => {
  const pageMode = normalizePageMode(theme.pageMode)
  if (pageMode !== 'one-page-preferred' && pageMode !== 'one-page-strict') return theme
  return {
    ...theme,
    pageMode,
    fontSize: Math.max(10, theme.fontSize - 1.5),
    lineHeight: Math.min(1.38, theme.lineHeight),
    pageMargin: Math.min(12, theme.pageMargin),
    sectionGap: Math.min(10, theme.sectionGap),
  }
}

const PAGE_CAPACITY = 3_600

/**
 * 单个内容块（一条经历）能容纳的文本量上限。超过此上限说明这一条
 * 内容块自身就占满甚至超过一页，需要按段落拆分，否则会被硬切在页面边界。
 */
const ITEM_CAPACITY = 2_600

const estimateSectionHeight = (section: ResumeSection, theme: ResumeTheme): number => {
  if (!section.visible) return 0
  const textWeight = section.items.reduce((total, item) => total + itemTextLength(item), 0)
  const lineHeight = Math.max(1, theme.lineHeight)
  return Math.round(310 + textWeight * lineHeight * 0.48 + section.items.length * 90)
}

/**
 * 把一条超长内容块的正文拆成多段。标题、副标题、时间等头部信息只在
 * 第一段保留，后续段用「（续）」标识，避免重复展示头部造成版面浪费。
 */
const splitLongItem = (item: ResumeItem): ResumeItem[] => {
  const pieces: string[] = []
  // 先按 bullets 的每个要点拆，再对 content 的纯文本按句子边界均分。
  const contentText = stripHtml(item.content)
  for (const bullet of item.bullets) pieces.push(bullet)
  if (contentText) pieces.push(contentText)

  // 单段仍过长时，按约 600 字为一段切分（以句号、分号等标点优先断句）。
  const segments: string[] = []
  const TARGET = 600
  for (const piece of pieces) {
    if (piece.length <= TARGET) {
      segments.push(piece)
      continue
    }
    let rest = piece
    while (rest.length > TARGET) {
      const cutIndex = Math.max(
        rest.lastIndexOf('。', TARGET),
        rest.lastIndexOf('；', TARGET),
        rest.lastIndexOf('，', TARGET),
        rest.lastIndexOf('.', TARGET),
        rest.lastIndexOf(' ', TARGET),
        TARGET,
      )
      segments.push(rest.slice(0, cutIndex + 1).trim())
      rest = rest.slice(cutIndex + 1).trim()
    }
    if (rest) segments.push(rest)
  }

  // 按内容量重新打包成 item，头部只在第一段保留，续段以要点形式呈现。
  const result: ResumeItem[] = []
  let buffer: string[] = []
  let bufferLength = 0
  const flush = (): void => {
    if (buffer.length === 0) return
    if (result.length === 0) {
      // 第一段：保留原始富文本 content，续段文本折叠进 bullets。
      result.push({ ...item, id: item.id, content: item.content, bullets: buffer })
    } else {
      result.push({
        ...item,
        id: `${item.id}-cont-${result.length + 1}`,
        title: `${item.title}（续）`,
        content: '',
        bullets: buffer,
      })
    }
    buffer = []
    bufferLength = 0
  }

  for (const segment of segments) {
    if (buffer.length > 0 && bufferLength + segment.length > 700) flush()
    buffer.push(segment)
    bufferLength += segment.length
  }
  flush()

  return result.length > 0 ? result : [item]
}

const splitLargeSection = (section: ResumeSection, theme: ResumeTheme): ResumeSection[] => {
  const result: ResumeSection[] = []
  let currentItems: ResumeSection['items'] = []
  let currentHeight = 290

  // 先展开：超长内容块按段落拆成多条，保证单条不再超页。
  const expandedItems = section.items.flatMap((item) =>
    itemTextLength(item) > ITEM_CAPACITY ? splitLongItem(item) : [item],
  )

  for (const item of expandedItems) {
    const itemHeight = Math.round(120 + itemTextLength(item) * theme.lineHeight * 0.48)
    if (currentItems.length > 0 && currentHeight + itemHeight > PAGE_CAPACITY) {
      result.push({ ...section, id: `${section.id}-${result.length + 1}`, items: currentItems })
      currentItems = []
      currentHeight = 290
    }
    currentItems.push(item)
    currentHeight += itemHeight
  }

  if (currentItems.length > 0) {
    result.push({ ...section, id: `${section.id}-${result.length + 1}`, items: currentItems })
  }
  return result
}

/** 缩放的绝对边界：再小就没法读了，再大就不像简历了。 */
export const MIN_FIT_FACTOR = 0.25
export const MAX_FIT_FACTOR = 1.25

/**
 * 按比例缩放排版参数，用于「固定页数」时把内容压到 / 撑到目标页数。
 *
 * 内容多就压（factor < 1），内容少就放大（factor > 1）。只动字号/行距/模块间距，
 * 不动页边距——页边距同时决定可用高度，一起变会让「一页能放多少」跟着变，搜索无法收敛。
 */
export const scaleTheme = (theme: ResumeTheme, factor: number): ResumeTheme => {
  const ratio = Math.min(MAX_FIT_FACTOR, Math.max(MIN_FIT_FACTOR, factor))
  if (Math.abs(ratio - 1) < 0.005) return theme
  return {
    ...theme,
    fontSize: Math.round(theme.fontSize * ratio * 10) / 10,
    // 行距变化缓一些：只放大字号会让行与行挤在一起
    lineHeight: Math.round(theme.lineHeight * (0.6 + ratio * 0.4) * 100) / 100,
    sectionGap: Math.round(theme.sectionGap * ratio),
  }
}

/**
 * 「固定页数」下一轮该用多大缩放系数；返回 null 表示到此为止。
 *
 * 页数多了就继续缩（没有人工下限，只受 {@link MIN_FIT_FACTOR} 约束），
 * 页数少了就放大（上限 {@link MAX_FIT_FACTOR}）。两者都留一点余量，
 * 避免在临界点上反复横跳。
 */
export const nextFitFactor = (
  current: number,
  pageCount: number,
  targetPages: number,
  totalHeight: number,
  availableHeight: number,
): number | null => {
  if (pageCount === targetPages) return null
  if (totalHeight <= 0 || availableHeight <= 0) return null
  const needed = availableHeight / totalHeight
  if (pageCount > targetPages) {
    // 超页：按高度比例压，留 4% 余量
    const next = Math.min(MAX_FIT_FACTOR, Math.max(MIN_FIT_FACTOR, current * needed * 0.96))
    return next < current - 0.01 ? next : null
  }
  // 页数不足：放大到刚好填满
  const next = Math.min(MAX_FIT_FACTOR, Math.max(MIN_FIT_FACTOR, current * needed))
  return next > current + 0.01 ? next : null
}

/**
 * 分页前的**内容整形**（不决定哪块放第几页）。
 *
 * 只做两件与文字量有关的事：过滤隐藏模块、把单条超长内容按句子拆成「（续）」条目，
 * 并在模块条目过多时先粗分块，避免一个模块整体高过一页后完全无法参与排版。
 * 真正的页归属交给 `layout.ts` 的 {@link planFragments}（按实测高度装箱）。
 *
 * 之所以保留字符量估算：它只影响「切不切」，不影响「放哪页」，
 * 即使估得不准，最多是多切一刀，不会让预览和导出的页数分叉。
 */
export const prepareSections = (sections: ResumeSection[], theme: ResumeTheme): ResumeSection[] => {
  const pageMode = normalizePageMode(theme.pageMode)
  const visible = sections.filter((section) => section.visible)
  // 强制一页不做预切分：此时分页本来就是「全部塞进一页，溢出照实提示」
  if (pageMode === 'one-page-strict') return visible
  return visible.flatMap((section) =>
    estimateSectionHeight(section, theme) > PAGE_CAPACITY ||
    section.items.some((item) => itemTextLength(item) > ITEM_CAPACITY)
      ? splitLargeSection(section, theme)
      : [section],
  )
}

/** 需要按测量结果再切一次的条目：一条内容本身比一页还高。 */
export interface ItemSplit {
  sectionId: string
  itemIndex: number
  parts: number
}

const escapeText = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * 把一条内容切成 `parts` 段。
 *
 * 触发条件是「这一条实测比一整页还高」——字符量估算管不到字体大小、模板间距带来的
 * 高度差异，只有量过才知道。切分按句子边界，续段标题加「（续）」、只带正文；
 * 内容不足以切开（比如全靠要点列表撑高）时改为均分要点。
 */
export const splitItemInto = (item: ResumeItem, parts: number): ResumeItem[] => {
  if (parts < 2) return [item]

  const text = stripHtml(item.content).trim()
  const sentences = text
    .split(/(?<=[。！？；.!?;])/)
    .filter((sentence) => sentence.trim().length > 0)
  let chunks: string[] = []

  if (sentences.length > 1) {
    const target = Math.max(1, Math.ceil(text.length / parts))
    let buffer = ''
    for (const sentence of sentences) {
      buffer += sentence
      if (buffer.length >= target && chunks.length < parts - 1) {
        chunks.push(buffer.trim())
        buffer = ''
      }
    }
    if (buffer.trim()) chunks.push(buffer.trim())
  }

  // 正文切不开但要点很多：按要点均分，保证仍然能分页
  if (chunks.length < 2 && item.bullets.length > 2) {
    const perChunk = Math.ceil(item.bullets.length / parts)
    chunks = Array.from({ length: parts }, (_, index) =>
      item.bullets.slice(index * perChunk, (index + 1) * perChunk).join('\n'),
    ).filter((chunk) => chunk.length > 0)
    const bulletChunks = chunks
    chunks = []
    return bulletChunks.map((chunk, index) => ({
      id: index === 0 ? item.id : `${item.id}~${index}`,
      title: index === 0 ? item.title : `${item.title}（续）`,
      subtitle: index === 0 ? item.subtitle : '',
      period: index === 0 ? item.period : '',
      location: index === 0 ? item.location : '',
      content: '',
      bullets: chunk.split('\n').filter(Boolean),
    }))
  }

  if (chunks.length < 2) return [item]

  return chunks.map((chunk, index) => ({
    id: index === 0 ? item.id : `${item.id}~${index}`,
    title: index === 0 ? item.title : `${item.title}（续）`,
    subtitle: index === 0 ? item.subtitle : '',
    period: index === 0 ? item.period : '',
    location: index === 0 ? item.location : '',
    content: `<p>${escapeText(chunk)}</p>`,
    bullets: index === 0 ? item.bullets : [],
  }))
}

/**
 * 从实测高度算出哪些条目需要切开、切成几段。
 * 留 12% 余量，避免「刚好等于一页」时因为续页的标题占位又溢出。
 */
export const computeItemSplits = (metrics: SectionMetrics[], capacity: number): ItemSplit[] =>
  metrics.flatMap((section) =>
    section.itemHeights.flatMap((height, itemIndex) =>
      height > capacity
        ? [
            {
              sectionId: section.sectionId,
              itemIndex,
              parts: Math.min(12, Math.ceil(height / Math.max(1, capacity * 0.88))),
            },
          ]
        : [],
    ),
  )

/** 按切分计划重建模块列表；id 保持不变，续段用 `~n` 后缀。 */
export const applyItemSplits = (
  sections: ResumeSection[],
  splits: ItemSplit[],
): ResumeSection[] => {
  if (splits.length === 0) return sections
  const bySection = new Map<string, Map<number, number>>()
  for (const split of splits) {
    const map = bySection.get(split.sectionId) ?? new Map<number, number>()
    map.set(split.itemIndex, split.parts)
    bySection.set(split.sectionId, map)
  }
  return sections.map((section) => {
    const map = bySection.get(section.id)
    if (!map) return section
    return {
      ...section,
      items: section.items.flatMap((item, index) => {
        const parts = map.get(index)
        return parts ? splitItemInto(item, parts) : [item]
      }),
    }
  })
}
