import type { ResumeDocument, ResumeItem, ResumeSection, SectionType } from './model.js'

const DEFAULT_IMPORT_THEME = {
  templateId: 'classic' as const,
  pageMode: 'standard' as const,
  fontFamily: 'Noto Sans SC, PingFang SC, Microsoft YaHei, sans-serif',
  fontSize: 12.5,
  lineHeight: 1.65,
  pageMargin: 18,
  sectionGap: 18,
  accentColor: '#315D8C',
  showPageNumber: false,
}

const createId = (prefix: string): string => {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export interface ResumeImportResult {
  document: ResumeDocument
  warnings: string[]
  extractedLines: number
  sourceText?: string
}

interface SectionDraft {
  type: SectionType
  title: string
  lines: string[]
}

const SECTION_DEFINITIONS: Array<{ type: SectionType; names: string[] }> = [
  { type: 'education', names: ['教育经历', '教育背景', 'education'] },
  { type: 'skills', names: ['专业技能', '技能特长', '技术能力', 'skills'] },
  { type: 'experience', names: ['工作经历', '工作经验', '职业经历', 'experience'] },
  { type: 'project', names: ['项目经历', '项目经验', '项目实践', 'projects'] },
  { type: 'summary', names: ['个人总结', '自我评价', '个人评价', 'summary'] },
]

const DATE_PATTERN =
  /((?:19|20)\d{2}\s*[年./-]\s*\d{1,2}\s*(?:月|[/.-])?\s*(?:-|至|到)\s*(?:(?:19|20)\d{2}\s*[年./-]\s*\d{1,2}\s*(?:月|[/.-])?|至今))/i
const PHONE_PATTERN = /(?:\+?86[-\s]?)?1[3-9]\d{9}/
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
const URL_PATTERN = /https?:\/\/[^\s|丨]+/i

const escapeHtml = (value: string): string => {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

const normalizeLine = (line: string): string => {
  return line
    .replace(/\u200B|\u200C|\u200D|\uFEFF/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*([丨|])\s*/g, ' | ')
    .trim()
}

const isNoiseLine = (line: string): boolean => {
  return (
    (line.length > 16 && /^[A-Za-z0-9_-]+$/.test(line)) ||
    (line.length > 24 && !/[\u4e00-\u9fa5]/.test(line) && !/[.@]/.test(line))
  )
}

export const normalizeResumeLines = (text: string): string[] => {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(normalizeLine)
    .filter((line) => line.length > 0 && !isNoiseLine(line))
}

const getSectionDefinition = (line: string): { type: SectionType; title: string } | null => {
  const normalized = line
    .replace(/[：:]$/, '')
    .trim()
    .toLowerCase()
  const definition = SECTION_DEFINITIONS.find(({ names }) =>
    names.some((name) => normalized === name || normalized.startsWith(`${name} `)),
  )
  return definition ? { type: definition.type, title: line.replace(/[：:]$/, '').trim() } : null
}

const splitSections = (lines: string[]): { preamble: string[]; drafts: SectionDraft[] } => {
  const preamble: string[] = []
  const drafts: SectionDraft[] = []
  let current: SectionDraft | null = null
  for (const line of lines) {
    const definition = getSectionDefinition(line)
    if (definition) {
      current = { ...definition, lines: [] }
      drafts.push(current)
    } else if (current) {
      current.lines.push(line)
    } else {
      preamble.push(line)
    }
  }
  return { preamble, drafts }
}

const periodFromLine = (line: string): { period: string; title: string } | null => {
  const match = line.match(DATE_PATTERN)
  if (!match) return null
  return {
    period: match[1].replace(/\s+/g, '').replace(/至/g, ' - '),
    title: line.replace(match[1], '').replaceAll('|', ' ').replaceAll('丨', ' ').trim(),
  }
}

const isBulletLine = (line: string): boolean => {
  return /^(?:[•·●▪◦*-]|\d+[.、)])\s*/.test(line)
}

const removeBulletMarker = (line: string): string => {
  return line.replace(/^(?:[•·●▪◦*-]|\d+[.、)])\s*/, '').trim()
}

const toParagraphHtml = (lines: string[]): string => {
  return lines
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('')
}

const createEmptyItem = (): ResumeItem => ({
  id: createId('import-item'),
  title: '',
  subtitle: '',
  period: '',
  location: '',
  content: '',
  bullets: [],
})

const parseSimpleSection = (draft: SectionDraft): ResumeSection => {
  const item = createEmptyItem()
  const content: string[] = []
  for (const line of draft.lines) {
    if (isBulletLine(line)) item.bullets.push(removeBulletMarker(line))
    else content.push(line)
  }
  item.content = toParagraphHtml(content)
  return {
    id: createId('import-section'),
    type: draft.type,
    title: draft.title,
    visible: true,
    items: [item],
  }
}

const parseEducationSection = (draft: SectionDraft): ResumeSection => {
  const section = parseStructuredSection(draft)
  const item = section.items[0]
  if (!item) return section
  const paragraphs = item.content.match(/<p>(.*?)<\/p>/g) ?? []
  const courseParagraphs = paragraphs.filter((paragraph) => /相关课程|课程/i.test(paragraph))
  if (courseParagraphs.length > 0) {
    item.bullets.push(...courseParagraphs.map((paragraph) => paragraph.replace(/<\/?p>/g, '')))
    item.content = paragraphs.filter((paragraph) => !/相关课程|课程/i.test(paragraph)).join('')
  }
  return section
}

const parseStructuredSection = (draft: SectionDraft): ResumeSection => {
  const blocks: string[][] = []
  let current: string[] = []
  for (const line of draft.lines) {
    if (periodFromLine(line) && current.length > 0) {
      blocks.push(current)
      current = []
    }
    current.push(line)
  }
  if (current.length > 0) blocks.push(current)
  if (blocks.length === 0) blocks.push([])

  const items = blocks.map((block) => {
    const item = createEmptyItem()
    const firstLine = block[0] ?? ''
    const dateInfo = periodFromLine(firstLine)
    if (dateInfo) {
      item.title = dateInfo.title
      item.period = dateInfo.period
    } else {
      item.title = firstLine
    }

    const body = dateInfo ? block.slice(1) : block.slice(1)
    if (body.length > 0 && !isBulletLine(body[0])) item.subtitle = body.shift() ?? ''
    for (const line of body) {
      if (isBulletLine(line)) item.bullets.push(removeBulletMarker(line))
      else if (line) item.content += `<p>${escapeHtml(line)}</p>`
    }
    return item
  })

  return {
    id: createId('import-section'),
    type: draft.type,
    title: draft.title,
    visible: true,
    items,
  }
}

const parseProfile = (
  preamble: string[],
): { profile: ResumeDocument['profile']; used: Set<string> } => {
  const allText = preamble.join(' | ')
  const phone = allText.match(PHONE_PATTERN)?.[0] ?? ''
  const email = allText.match(EMAIL_PATTERN)?.[0] ?? ''
  const website = allText.match(URL_PATTERN)?.[0] ?? ''
  const header =
    preamble.find(
      (line) =>
        /[\u4e00-\u9fa5]/.test(line) && !PHONE_PATTERN.test(line) && !EMAIL_PATTERN.test(line),
    ) ?? ''
  const tokens = header.split(/\s+/).filter(Boolean)
  const lastToken = tokens.at(-1) ?? ''
  const chineseName = /^[\u4e00-\u9fa5]{2,4}$/.test(lastToken) ? lastToken : ''
  const name = chineseName || (header.match(/[\u4e00-\u9fa5]{2,4}/)?.[0] ?? '未填写姓名')
  const displayTitle = chineseName ? tokens.slice(0, -1).join(' ') : ''
  const detail =
    preamble.find(
      (line) =>
        /[岁岁年男女性]/.test(line) && !PHONE_PATTERN.test(line) && !EMAIL_PATTERN.test(line),
    ) ?? ''
  const role =
    preamble.find(
      (line) =>
        line !== header &&
        line !== detail &&
        !PHONE_PATTERN.test(line) &&
        !EMAIL_PATTERN.test(line) &&
        !/[大学学院本科]/.test(line),
    ) ?? ''
  const headline = role || '目标职位'
  const used = new Set([header, detail, role])
  if (phone) used.add(preamble.find((line) => line.includes(phone)) ?? '')
  if (email) used.add(preamble.find((line) => line.includes(email)) ?? '')
  return {
    profile: {
      name,
      headline,
      displayTitle: displayTitle || undefined,
      detail: detail || undefined,
      headerLayout: displayTitle || detail ? 'compact' : 'stacked',
      phone,
      email,
      location: '',
      website,
    },
    used,
  }
}

export const parseResumeText = (text: string, fileName = '导入简历.pdf'): ResumeImportResult => {
  const lines = normalizeResumeLines(text)
  const { preamble, drafts } = splitSections(lines)
  const { profile, used } = parseProfile(preamble)
  const parsedSections = drafts.map((draft) => {
    if (draft.type === 'education') return parseEducationSection(draft)
    return ['skills', 'summary', 'custom'].includes(draft.type)
      ? parseSimpleSection(draft)
      : parseStructuredSection(draft)
  })
  const remainingPreamble = drafts.length > 0 ? preamble.filter((line) => !used.has(line)) : []
  const warnings: string[] = []

  if (profile.name === '未填写姓名') warnings.push('没有识别到姓名，请在右侧属性面板确认。')
  if (!profile.phone) warnings.push('没有识别到手机号。')
  if (!profile.email) warnings.push('没有识别到邮箱。')
  if (drafts.length === 0) {
    warnings.push('没有识别到标准模块标题，已将全文放入“导入内容”。')
    parsedSections.push({
      id: createId('import-section'),
      type: 'custom',
      title: '导入内容',
      visible: true,
      items: [{ ...createEmptyItem(), content: toParagraphHtml(lines) }],
    })
  }
  if (remainingPreamble.length > 0) {
    parsedSections.unshift({
      id: createId('import-section'),
      type: 'custom',
      title: '补充信息',
      visible: true,
      items: [{ ...createEmptyItem(), content: toParagraphHtml(remainingPreamble) }],
    })
    warnings.push('有少量顶部信息未能归类，已放入“补充信息”。')
  }

  const document: ResumeDocument = {
    id: createId('resume-import'),
    title: fileName.replace(/\.pdf$/i, '') || '导入简历',
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    profile,
    theme: { ...DEFAULT_IMPORT_THEME },
    sections: parsedSections,
  }
  return { document, warnings, extractedLines: lines.length, sourceText: text }
}
