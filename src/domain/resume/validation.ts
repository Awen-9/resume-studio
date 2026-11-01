import { stripHtml } from './html.js'
import type { ResumeDocument, ResumeItem, ResumeSection } from './model.js'

/** 邮箱格式：宽松匹配常见邮箱。 */
const EMAIL_PATTERN = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i

export const isValidEmail = (value: string): boolean => EMAIL_PATTERN.test(value)

/**
 * 手机号格式校验：先移除 `+86` 前缀、空格与连字符，再校验是否为 11 位国内号码。
 * 这样能兼容 `13800000000`、`138 0000 0000`、`138-0000-0000`、`+86 138 0000 0000` 等常见写法。
 */
export const isValidPhone = (value: string): boolean => {
  const normalized = value.replace(/^\+?86/, '').replace(/[\s-]/g, '')
  return /^1[3-9]\d{9}$/.test(normalized)
}

export const cloneResume = (document: ResumeDocument): ResumeDocument => {
  return JSON.parse(JSON.stringify(document)) as ResumeDocument
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

const SECTION_TYPES = new Set(['education', 'experience', 'project', 'skills', 'summary', 'custom'])
const TEMPLATE_IDS = new Set(['classic', 'compact', 'accent'])
const PAGE_MODES = new Set(['standard', 'one-page-preferred', 'one-page-strict', 'one-page'])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const isString = (value: unknown): value is string => typeof value === 'string'

const isOptionalString = (value: unknown): boolean => value === undefined || isString(value)

const isNumberIn = (value: unknown, min: number, max: number): boolean =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max

const isResumeItem = (value: unknown): boolean =>
  isRecord(value) &&
  ['id', 'title', 'subtitle', 'period', 'location', 'content'].every((key) =>
    isString(value[key]),
  ) &&
  Array.isArray(value.bullets) &&
  value.bullets.every(isString)

const isResumeSection = (value: unknown): boolean =>
  isRecord(value) &&
  isString(value.id) &&
  isString(value.title) &&
  SECTION_TYPES.has(value.type as string) &&
  typeof value.visible === 'boolean' &&
  Array.isArray(value.items) &&
  value.items.every(isResumeItem)

/**
 * 主题字段会写进内联 `style`，因此颜色只接受十六进制、数值限定在合理范围，
 * 字体名不允许出现 `;`、`{`、`}`、`<` 等可能结束声明的字符。
 */
const isResumeTheme = (value: unknown): boolean =>
  isRecord(value) &&
  TEMPLATE_IDS.has(value.templateId as string) &&
  (value.pageMode === undefined || PAGE_MODES.has(value.pageMode as string)) &&
  isString(value.fontFamily) &&
  !/[;{}<>\\]/.test(value.fontFamily) &&
  isNumberIn(value.fontSize, 6, 32) &&
  isNumberIn(value.lineHeight, 0.8, 3) &&
  isNumberIn(value.pageMargin, 0, 50) &&
  isNumberIn(value.sectionGap, 0, 80) &&
  isString(value.accentColor) &&
  /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(value.accentColor) &&
  typeof value.showPageNumber === 'boolean'

const isResumeProfile = (value: unknown): boolean =>
  isRecord(value) &&
  ['name', 'headline', 'phone', 'email', 'location', 'website'].every((key) =>
    isString(value[key]),
  ) &&
  isOptionalString(value.displayTitle) &&
  isOptionalString(value.detail) &&
  (value.headerLayout === undefined ||
    value.headerLayout === 'stacked' ||
    value.headerLayout === 'compact')

/**
 * 结构校验：判断一个来自外部（HTTP 请求、备份文件）的值是否符合 {@link ResumeDocument} 的形状。
 *
 * 与 {@link validateResumeDocument} 的分工：这里只回答「数据能不能安全地渲染和存储」，
 * 不检查姓名是否为空、邮箱格式等业务规则。
 */
export const isResumeDocument = (value: unknown): value is ResumeDocument =>
  isRecord(value) &&
  isString(value.id) &&
  value.id.length > 0 &&
  isString(value.title) &&
  isOptionalString(value.updatedAt) &&
  (value.schemaVersion === undefined || typeof value.schemaVersion === 'number') &&
  isResumeProfile(value.profile) &&
  isResumeTheme(value.theme) &&
  Array.isArray(value.sections) &&
  value.sections.every(isResumeSection)

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
  if (email && !isValidEmail(email)) {
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
