import type { ResumeDocument, ResumeItem, ResumeSection } from './model.js'

export const cloneResume = (document: ResumeDocument): ResumeDocument => {
  return JSON.parse(JSON.stringify(document)) as ResumeDocument
}

export const stripHtml = (html: string): string => {
  if (typeof document === 'undefined')
    return html
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  const element = document.createElement('div')
  element.innerHTML = html
  return element.textContent?.replace(/\s+/g, ' ').trim() ?? ''
}

export const itemTextLength = (item: ResumeItem): number => {
  const text = [
    item.title,
    item.subtitle,
    item.period,
    item.location,
    stripHtml(item.content),
    ...item.bullets,
  ]
  return text.join(' ').trim().length
}

export const sectionTextLength = (section: ResumeSection): number => {
  return section.items.reduce((total, item) => total + itemTextLength(item), 0)
}

export const validateResumeDocument = (document: ResumeDocument): string[] => {
  const errors: string[] = []
  if (!document.id) errors.push('简历缺少 id')
  if (!document.title.trim()) errors.push('简历名称不能为空')
  if (!document.profile.name.trim()) errors.push('姓名不能为空')
  if (document.sections.length === 0) errors.push('至少需要一个内容模块')
  const ids = new Set<string>()
  for (const section of document.sections) {
    if (ids.has(section.id)) errors.push(`模块 id 重复：${section.id}`)
    ids.add(section.id)
    for (const item of section.items) {
      if (ids.has(item.id)) errors.push(`内容 id 重复：${item.id}`)
      ids.add(item.id)
    }
  }
  return errors
}
