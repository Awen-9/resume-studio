import { DEFAULT_THEME, createId } from './defaults.js'
import { normalizePageMode } from './pagination.js'
import type {
  PageMode,
  ResumeDocument,
  ResumeItem,
  ResumeProfile,
  ResumeSection,
  ResumeTheme,
  SectionType,
  TemplateId,
} from './model.js'

/**
 * 备份文件的解析与归一化。
 *
 * 备份是用户唯一的「异地副本」，因此这里的目标不是「严格拒绝一切异常」，而是
 * **在任何情况下都不写坏数据**：
 * 1. 结构不可用的条目跳过并计数，其余照常恢复（一份坏记录不该毁掉整次恢复）；
 * 2. 字段能修的修（缺失的主题字段回落默认值，旧的 `one-page` 归一化）；
 * 3. 什么都不能用的文件在写入前就抛错——绝不能先清库再报错。
 *
 * 注意这里**不复用服务端的 zod schema**：服务端那份带长度上限（防止恶意大包），
 * 而备份必须能原样往返本应用自己产出的数据，两者约束不同，混用会导致「自己的备份
 * 恢复不回来」。字段缺失用默认值补齐，类型不对则丢弃该字段。
 */

export interface BackupParseResult {
  documents: ResumeDocument[]
  /** 结构化失败、被跳过的记录数量（不是字段被修正的数量）。 */
  skipped: number
}

const SECTION_TYPES: ReadonlySet<string> = new Set<SectionType>([
  'education',
  'experience',
  'project',
  'skills',
  'summary',
  'custom',
])

const TEMPLATE_IDS: ReadonlySet<string> = new Set<TemplateId>(['classic', 'compact', 'accent'])

const asText = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback

const asOptionalText = (value: unknown): string | undefined => {
  const text = asText(value)
  return text.length > 0 ? text : undefined
}

const asNumber = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

const asBool = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

/** 备份里的 id 只是标识，重复或缺失时补一个，避免同名 id 在同一库里互相覆盖。 */
const uniqueId = (value: unknown, prefix: string, seen: Set<string>): string => {
  const candidate = asText(value).trim()
  if (candidate && !seen.has(candidate)) {
    seen.add(candidate)
    return candidate
  }
  let generated = createId(prefix)
  while (seen.has(generated)) generated = createId(prefix)
  seen.add(generated)
  return generated
}

const normalizeTheme = (raw: unknown): ResumeTheme => {
  const theme = asRecord(raw) ?? {}
  const accent = asText(theme.accentColor)
  const pageMode = normalizePageMode(asText(theme.pageMode) || undefined) as PageMode
  // 固定页数：只接受 1–12 的整数，其他值当作「自动」
  const rawTarget = theme.targetPages === undefined ? NaN : Number(theme.targetPages)
  const targetPages =
    Number.isFinite(rawTarget) && rawTarget >= 1 && rawTarget <= 12
      ? Math.round(rawTarget)
      : undefined
  return {
    templateId: TEMPLATE_IDS.has(asText(theme.templateId))
      ? (asText(theme.templateId) as TemplateId)
      : DEFAULT_THEME.templateId,
    pageMode,
    targetPages,
    fontFamily: asText(theme.fontFamily) || DEFAULT_THEME.fontFamily,
    fontSize: asNumber(theme.fontSize, DEFAULT_THEME.fontSize, 6, 40),
    lineHeight: asNumber(theme.lineHeight, DEFAULT_THEME.lineHeight, 1, 3),
    pageMargin: asNumber(theme.pageMargin, DEFAULT_THEME.pageMargin, 0, 80),
    sectionGap: asNumber(theme.sectionGap, DEFAULT_THEME.sectionGap, 0, 80),
    accentColor: /^#[0-9a-f]{6}$/i.test(accent) ? accent : DEFAULT_THEME.accentColor,
    showPageNumber: asBool(theme.showPageNumber, DEFAULT_THEME.showPageNumber),
  }
}

const normalizeProfile = (raw: unknown): ResumeProfile => {
  const profile = asRecord(raw) ?? {}
  const headerLayout = asText(profile.headerLayout)
  return {
    name: asText(profile.name),
    headline: asText(profile.headline),
    displayTitle: asOptionalText(profile.displayTitle),
    detail: asOptionalText(profile.detail),
    headerLayout:
      headerLayout === 'compact' || headerLayout === 'stacked'
        ? (headerLayout as ResumeProfile['headerLayout'])
        : undefined,
    phone: asText(profile.phone),
    email: asText(profile.email),
    location: asText(profile.location),
    website: asText(profile.website),
  }
}

const normalizeItem = (raw: unknown, seenIds: Set<string>): ResumeItem | null => {
  const item = asRecord(raw)
  if (!item) return null
  const bullets = Array.isArray(item.bullets)
    ? item.bullets.filter((bullet): bullet is string => typeof bullet === 'string')
    : []
  return {
    id: uniqueId(item.id, 'item', seenIds),
    title: asText(item.title),
    subtitle: asText(item.subtitle),
    period: asText(item.period),
    location: asText(item.location),
    content: asText(item.content),
    bullets,
  }
}

const emptyItem = (seenIds: Set<string>): ResumeItem => ({
  id: uniqueId(undefined, 'item', seenIds),
  title: '',
  subtitle: '',
  period: '',
  location: '',
  content: '',
  bullets: [],
})

const normalizeSection = (raw: unknown, seenIds: Set<string>): ResumeSection => {
  const section = asRecord(raw) ?? {}
  const type = asText(section.type)
  const items = Array.isArray(section.items)
    ? section.items
        .map((item) => normalizeItem(item, seenIds))
        .filter((item): item is ResumeItem => item !== null)
    : []
  return {
    id: uniqueId(section.id, 'section', seenIds),
    type: SECTION_TYPES.has(type) ? (type as SectionType) : 'custom',
    title: asText(section.title, '未命名模块'),
    visible: asBool(section.visible, true),
    items: items.length > 0 ? items : [emptyItem(seenIds)],
  }
}

const normalizeDocument = (raw: unknown, seenIds: Set<string>): ResumeDocument | null => {
  const document = asRecord(raw)
  if (!document) return null
  const rawSections = Array.isArray(document.sections) ? document.sections : []
  // 没有任何模块的简历在编辑器里等于不可编辑的空壳，直接跳过比写进库更安全
  if (rawSections.length === 0) return null

  const schemaVersion = Math.trunc(asNumber(document.schemaVersion, 1, 1, 99))
  return {
    id: uniqueId(document.id, 'resume', seenIds),
    title: asText(document.title, '未命名简历'),
    schemaVersion,
    updatedAt: asText(document.updatedAt) || new Date().toISOString(),
    targetRole: asOptionalText(document.targetRole),
    profile: normalizeProfile(document.profile),
    theme: normalizeTheme(document.theme),
    sections: rawSections.map((section) => normalizeSection(section, seenIds)),
  }
}

/** 当前数据结构版本。升级结构时 +1，并在 `normalizeDocument` 里补迁移。 */
export const CURRENT_SCHEMA_VERSION = 1

/** 从备份 JSON 里读出可直接写入本地库的文档；结构不可用的条目计入 `skipped`。 */
export const parseBackup = (raw: string): BackupParseResult => {
  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    throw new Error('备份文件不是合法的 JSON，请确认选择的是「导出备份」生成的文件')
  }

  // 兼容两种形态：`{ documents: [...] }`（当前导出格式）与裸数组（早期手工备份）
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(asRecord(payload)?.documents)
      ? (asRecord(payload)?.documents as unknown[])
      : null
  if (!list) {
    throw new Error('备份文件格式不正确：缺少 documents 数组')
  }

  // 前向兼容：更新版本写出的数据，本版不认识新增字段，硬导入会静默丢内容。
  // 宁可明确拒绝，也不要「导入成功但数据缺了一块」。
  const futureVersion = list.reduce((max, entry) => {
    const version = Number(asRecord(entry)?.schemaVersion ?? 1)
    return Number.isFinite(version) && version > max ? version : max
  }, CURRENT_SCHEMA_VERSION)
  if (futureVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `这份备份来自更新版本的应用（数据版本 v${futureVersion}，当前支持 v${CURRENT_SCHEMA_VERSION}），请先升级应用再导入`,
    )
  }

  const seenIds = new Set<string>()
  const documents: ResumeDocument[] = []
  let skipped = 0
  for (const entry of list) {
    const document = normalizeDocument(entry, seenIds)
    if (document) documents.push(document)
    else skipped += 1
  }

  if (documents.length === 0) {
    throw new Error(
      skipped > 0
        ? `备份文件里的 ${skipped} 条记录都无法识别，已取消恢复（现有简历未受影响）`
        : '备份文件里没有简历数据，已取消恢复（现有简历未受影响）',
    )
  }
  return { documents, skipped }
}
