import type { ResumeDocument, ResumeItem, ResumeSection } from './model.js'

/** 邮箱格式：宽松匹配常见邮箱。 */
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i
/**
 * 手机号格式校验：先移除 `+86` 前缀、空格与连字符，再校验是否为 11 位国内号码。
 * 这样能兼容 `13800000000`、`138 0000 0000`、`138-0000-0000`、`+86 138 0000 0000` 等常见写法。
 */
const isValidPhone = (value: string): boolean => {
  const normalized = value.replace(/^\+?86/, '').replace(/[\s-]/g, '')
  return /^1[3-9]\d{9}$/.test(normalized)
}

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

  // 版本校验：未来的迁移逻辑依赖 schemaVersion，未知或缺失时提示。
  if (!Number.isInteger(document.schemaVersion) || document.schemaVersion < 1) {
    errors.push('简历数据版本不合法')
  }

  // 联系方式格式校验：仅在填写了内容时才检查格式，避免误报空值。
  const email = document.profile.email.trim()
  if (email && !EMAIL_PATTERN.test(email)) {
    errors.push('邮箱格式不正确')
  }
  const phone = document.profile.phone.trim()
  if (phone && !isValidPhone(phone)) {
    errors.push('手机号格式不正确')
  }

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
