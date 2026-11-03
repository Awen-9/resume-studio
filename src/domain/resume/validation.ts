import {
  PAGE_MODES,
  SECTION_TYPES,
  TEMPLATE_IDS,
  type ResumeDocument,
  type ResumeItem,
  type ResumeProfile,
  type ResumeSection,
  type ResumeTheme,
} from './model.js'

/**
 * 运行时类型守卫：判断未知值是不是结构完整、可安全交给渲染器的 `ResumeDocument`。
 *
 * 导出接口（PDF/DOCX）在把请求体交给渲染器之前用它做一次边界校验，失败直接 400，
 * 避免畸形数据（比如 `fontSize` 里塞 `"12\" onload=…"`）一路流进 Chromium 或无头渲染。
 * 这里刻意手写、不用 schema 库，是因为它要和 {@link ResumeDocument} 的类型保持同一份定义：
 * 模板/页面模式/模块类型都从 `model.ts` 的常量数组推导，校验与类型共用一份白名单。
 */

/** 排版数值上下限，与属性面板滑块保持一致（`src/features/editor/inspector/PageStyleSection.vue`）。 */
const THEME_RANGES = {
  fontSize: { min: 10, max: 18 },
  lineHeight: { min: 1.2, max: 2.4 },
  pageMargin: { min: 10, max: 30 },
  sectionGap: { min: 8, max: 40 },
} as const

/** 强调色：3~8 位十六进制（#RGB / #RGBA / #RRGGBB / #RRGGBBAA），大小写不敏感。 */
const ACCENT_COLOR_PATTERN = /^#[0-9a-f]{3,8}$/i

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isString = (value: unknown): value is string => typeof value === 'string'

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isString)

/** 有限数字且在闭区间 [min, max] 内。 */
const isFiniteNumberInRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max

/** 值必须是字符串且落在给定白名单里。 */
const isOneOf = <T extends string>(value: unknown, allowed: readonly T[]): value is T =>
  isString(value) && (allowed as readonly string[]).includes(value)

export const isResumeProfile = (value: unknown): value is ResumeProfile => {
  if (!isRecord(value)) return false
  return (
    isString(value.name) &&
    isString(value.headline) &&
    (value.displayTitle === undefined || isString(value.displayTitle)) &&
    (value.detail === undefined || isString(value.detail)) &&
    (value.headerLayout === undefined ||
      value.headerLayout === 'stacked' ||
      value.headerLayout === 'compact') &&
    isString(value.phone) &&
    isString(value.email) &&
    isString(value.location) &&
    isString(value.website)
  )
}

export const isResumeTheme = (value: unknown): value is ResumeTheme => {
  if (!isRecord(value)) return false
  return (
    isOneOf(value.templateId, TEMPLATE_IDS) &&
    (value.pageMode === undefined || isOneOf(value.pageMode, PAGE_MODES)) &&
    (value.targetPages === undefined ||
      (typeof value.targetPages === 'number' &&
        Number.isInteger(value.targetPages) &&
        value.targetPages >= 1 &&
        value.targetPages <= 12)) &&
    isString(value.fontFamily) &&
    isFiniteNumberInRange(value.fontSize, THEME_RANGES.fontSize.min, THEME_RANGES.fontSize.max) &&
    isFiniteNumberInRange(
      value.lineHeight,
      THEME_RANGES.lineHeight.min,
      THEME_RANGES.lineHeight.max,
    ) &&
    isFiniteNumberInRange(
      value.pageMargin,
      THEME_RANGES.pageMargin.min,
      THEME_RANGES.pageMargin.max,
    ) &&
    isFiniteNumberInRange(
      value.sectionGap,
      THEME_RANGES.sectionGap.min,
      THEME_RANGES.sectionGap.max,
    ) &&
    isString(value.accentColor) &&
    ACCENT_COLOR_PATTERN.test(value.accentColor) &&
    isBoolean(value.showPageNumber)
  )
}

export const isResumeItem = (value: unknown): value is ResumeItem => {
  if (!isRecord(value)) return false
  return (
    isString(value.id) &&
    isString(value.title) &&
    isString(value.subtitle) &&
    isString(value.period) &&
    isString(value.location) &&
    isString(value.content) &&
    isStringArray(value.bullets)
  )
}

export const isResumeSection = (value: unknown): value is ResumeSection => {
  if (!isRecord(value)) return false
  return (
    isString(value.id) &&
    isOneOf(value.type, SECTION_TYPES) &&
    isString(value.title) &&
    isBoolean(value.visible) &&
    Array.isArray(value.items) &&
    value.items.every(isResumeItem)
  )
}

export const isResumeDocument = (value: unknown): value is ResumeDocument => {
  if (!isRecord(value)) return false
  return (
    isString(value.id) &&
    isString(value.title) &&
    typeof value.schemaVersion === 'number' &&
    Number.isInteger(value.schemaVersion) &&
    value.schemaVersion >= 1 &&
    isString(value.updatedAt) &&
    (value.targetRole === undefined || isString(value.targetRole)) &&
    isResumeProfile(value.profile) &&
    isResumeTheme(value.theme) &&
    Array.isArray(value.sections) &&
    value.sections.every(isResumeSection)
  )
}

/**
 * 汇总顶层字段的校验问题，供导出接口 400 响应里的 `details` 使用。
 * 只报顶层字段（id/profile/theme/sections/…），子字段的具体问题由前端展示时自行定位。
 */
export const resumeDocumentIssues = (value: unknown): string[] => {
  if (isResumeDocument(value)) return []
  if (!isRecord(value)) return ['(root)']
  const issues: string[] = []
  if (!isString(value.id)) issues.push('id')
  if (!isString(value.title)) issues.push('title')
  if (
    typeof value.schemaVersion !== 'number' ||
    !Number.isInteger(value.schemaVersion) ||
    value.schemaVersion < 1
  )
    issues.push('schemaVersion')
  if (!isString(value.updatedAt)) issues.push('updatedAt')
  if (!isResumeProfile(value.profile)) issues.push('profile')
  if (!isResumeTheme(value.theme)) issues.push('theme')
  if (!Array.isArray(value.sections) || !value.sections.every(isResumeSection))
    issues.push('sections')
  return issues
}

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
