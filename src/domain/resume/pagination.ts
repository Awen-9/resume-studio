import type { ResumeSection, ResumeTheme } from './model.js'
import { itemTextLength } from './validation.js'

export interface PrintablePage {
  index: number
  sections: ResumeSection[]
}

export const getEffectiveTheme = (theme: ResumeTheme): ResumeTheme => {
  if (
    theme.pageMode !== 'one-page-preferred' &&
    theme.pageMode !== 'one-page-strict' &&
    theme.pageMode !== 'one-page'
  )
    return theme
  return {
    ...theme,
    fontSize: Math.max(10, theme.fontSize - 1.5),
    lineHeight: Math.min(1.38, theme.lineHeight),
    pageMargin: Math.min(12, theme.pageMargin),
    sectionGap: Math.min(10, theme.sectionGap),
  }
}

const PAGE_CAPACITY = 3_600

const estimateSectionHeight = (section: ResumeSection, theme: ResumeTheme): number => {
  if (!section.visible) return 0
  const textWeight = section.items.reduce((total, item) => total + itemTextLength(item), 0)
  const lineHeight = Math.max(1, theme.lineHeight)
  return Math.round(310 + textWeight * lineHeight * 0.48 + section.items.length * 90)
}

const splitLargeSection = (section: ResumeSection, theme: ResumeTheme): ResumeSection[] => {
  const result: ResumeSection[] = []
  let currentItems: ResumeSection['items'] = []
  let currentHeight = 290

  for (const item of section.items) {
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
  if (theme.pageMode === 'one-page-strict' || theme.pageMode === 'one-page') {
    return [{ index: 1, sections: sections.filter((section) => section.visible) }]
  }
  const printableSections = sections
    .filter((section) => section.visible)
    .flatMap((section) =>
      estimateSectionHeight(section, theme) > PAGE_CAPACITY
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
