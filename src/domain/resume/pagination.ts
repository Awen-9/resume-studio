import type { ResumeItem, ResumeSection, ResumeTheme } from './model.js'
import { itemTextLength, stripHtml } from './validation.js'

export interface PrintablePage {
  index: number
  sections: ResumeSection[]
}

/**
 * 归一化页面模式，兼容历史遗留值。
 *
 * 早期版本使用 `'one-page'` 表示「强制一页」，后统一为 `'one-page-strict'`。
 * 旧数据若仍携带 `'one-page'`，在此处归一化为 `'one-page-strict'`，避免渲染与检查失效。
 * 输入类型放宽为 `string | undefined`，以兼容从 IndexedDB/JSON 反序列化出的历史数据。
 */
export const normalizePageMode = (
  mode: ResumeTheme['pageMode'] | string | undefined,
): 'standard' | 'one-page-preferred' | 'one-page-strict' => {
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

export const paginateSections = (
  sections: ResumeSection[],
  theme: ResumeTheme,
): PrintablePage[] => {
  const pageMode = normalizePageMode(theme.pageMode)
  if (pageMode === 'one-page-strict') {
    return [{ index: 1, sections: sections.filter((section) => section.visible) }]
  }
  const printableSections = sections
    .filter((section) => section.visible)
    .flatMap((section) =>
      estimateSectionHeight(section, theme) > PAGE_CAPACITY ||
      section.items.some((item) => itemTextLength(item) > ITEM_CAPACITY)
        ? splitLargeSection(section, theme)
        : [section],
    )
  const pages: PrintablePage[] = []
  let current: ResumeSection[] = []
  let currentHeight = 0

  for (const section of printableSections) {
    const sectionHeight = estimateSectionHeight(section, theme)
    if (current.length > 0 && currentHeight + sectionHeight > PAGE_CAPACITY) {
      pages.push({ index: pages.length + 1, sections: current })
      current = []
      currentHeight = 0
    }
    current.push(section)
    currentHeight += sectionHeight
  }

  if (current.length > 0 || pages.length === 0) {
    pages.push({ index: pages.length + 1, sections: current })
  }
  return pages
}
