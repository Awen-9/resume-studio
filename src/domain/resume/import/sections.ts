import { escapeHtml } from '../escapeHtml.js'
import type { ResumeItem, ResumeSection, SectionType } from '../model.js'
import { createId } from './ids.js'
import { DATE_PATTERN, LABEL_LINE_PATTERN } from './patterns.js'

export interface SectionDraft {
  type: SectionType
  title: string
  lines: string[]
  /** 该模块第一行在归一化文本里的下标，供导入确认页高亮原文。 */
  start: number
}

export const SECTION_DEFINITIONS: Array<{ type: SectionType; names: string[] }> = [
  {
    type: 'education',
    names: ['教育经历', '教育背景', '学历背景', 'education'],
  },
  {
    type: 'skills',
    names: ['核心技能', '专业技能', '技能特长', '技术能力', '技能清单', '技能', 'skills'],
  },
  {
    type: 'experience',
    names: ['工作经历', '工作经验', '职业经历', '工作履历', '实习经历', 'experience'],
  },
  {
    type: 'project',
    names: ['项目经历', '项目经验', '项目实践', '开源项目', '项目', 'projects'],
  },
  {
    type: 'summary',
    names: [
      '个人简介',
      '个人总结',
      '自我评价',
      '个人评价',
      '自我介绍',
      '关于我',
      'summary',
      'profile',
    ],
  },
]

/**
 * 判断是否为模块标题行。
 *
 * 两个约束缺一不可：标题必须短（≤12 字），且不能是句子——
 * 否则正文里出现的「5 年工作经历」会被误当成模块标题，导致整篇被切碎。
 */
export const getSectionDefinition = (line: string): { type: SectionType; title: string } | null => {
  const cleaned = line
    .replace(/[：:]\s*$/, '')
    .replace(/\s+/g, '')
    .trim()
  if (cleaned.length === 0 || cleaned.length > 12) return null
  if (/[，。；！？,;!?]/.test(cleaned)) return null

  const normalized = cleaned.toLowerCase()
  const definition = SECTION_DEFINITIONS.find(({ names }) =>
    names.some((name) => normalized === name || normalized.startsWith(name)),
  )
  return definition ? { type: definition.type, title: cleaned } : null
}

export const splitSections = (lines: string[]): { preamble: string[]; drafts: SectionDraft[] } => {
  const preamble: string[] = []
  const drafts: SectionDraft[] = []
  let current: SectionDraft | null = null
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const definition = getSectionDefinition(line)
    if (definition) {
      current = { ...definition, lines: [], start: index + 1 }
      drafts.push(current)
    } else if (current) {
      current.lines.push(line)
    } else {
      preamble.push(line)
    }
  }
  return { preamble, drafts }
}

/** 私有区占位符，避免「至今」里的「至」被当成区间分隔符替换掉。 */
const PRESENT_TOKEN = '\uE000'

const normalizePeriod = (value: string): string =>
  value
    .replace(/\s+/g, '')
    .replace(/至今|现在|目前/g, PRESENT_TOKEN)
    .replace(/至|到|~|–|—/g, '-')
    .replace(/-+/g, '-')
    .replaceAll(PRESENT_TOKEN, '至今')

export const periodFromLine = (
  line: string,
): { period: string; title: string; rest: string } | null => {
  const match = line.match(DATE_PATTERN)
  if (!match) return null
  const index = line.indexOf(match[1])
  return {
    period: normalizePeriod(match[1]),
    title: line
      .slice(0, index)
      .replace(/[|丨｜]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
    rest: line.slice(index + match[1].length).trim(),
  }
}

/**
 * 有序列表编号：只认 1-2 位数字 + `.`/`、`/`)`，且**编号后面不能紧跟数字**。
 *
 * 少了 `(?!\d)` 这条会把百分比和小数误判成编号：
 * `68.0% 提升到 89.3%。` 曾被当成「第 68 条」，剥掉标记后只剩 `0% 提升到 89.3%。`。
 */
const ORDERED_BULLET = String.raw`\d{1,2}[.、)](?!\d)`
const BULLET_MARKER = String.raw`(?:[•·●▪◦*-]|${ORDERED_BULLET})`

export const isBulletLine = (line: string): boolean => {
  return new RegExp(String.raw`^\s*${BULLET_MARKER}\s*`).test(line)
}

const removeBulletMarker = (line: string): string => {
  return line.replace(new RegExp(String.raw`^\s*${BULLET_MARKER}\s*`), '').trim()
}

export const toParagraphHtml = (lines: string[]): string => {
  return lines
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('')
}

/**
 * 判断某行是否是「一条新经历/项目」的开头。
 *
 * 绝大多数简历用「公司 ｜ 职位 2023.07 - 至今」这种带日期的行开头；
 * 但个人项目常常没有日期（`个人技术博客 ｜ 个人项目 · awen-9.github.io`），
 * 只靠日期会把这些条目并进上一条，导致最后一个项目"消失"。
 */
export const looksLikeEntryHeader = (line: string, next?: string): boolean => {
  if (periodFromLine(line)) return true
  if (/[。；]$/.test(line)) return false
  if (next && /^技术栈\s*[:：]/.test(next)) return true
  return /[｜|]/.test(line) && line.length <= 60
}

export const mergeWrappedLines = (
  lines: string[],
  options: { skillList?: boolean } = {},
): string[] => {
  const merged: string[] = []
  for (const line of lines) {
    const previous = merged.at(-1)
    // 标签行的内容很短说明它只是引子（`多 Agent 架构：设计…`），可以接着拼；
    // 内容已经很长（`技术栈：Java 21、…`）则视为独立一行，避免把下一段正文吞进副标题。
    const previousIsLabel = previous ? LABEL_LINE_PATTERN.test(previous) : false
    const previousLabelBody =
      previousIsLabel && previous ? previous.slice(previous.search(/[：:]/) + 1) : ''
    // 「技术栈：A、B、C」这类枚举型标签行已经写完了，不该再把下一段正文拼进来；
    // 而「多 Agent 架构：设计…」是被折行截断的句子（无顿号），必须继续拼。
    const labelBlocksMerge =
      previousIsLabel && previousLabelBody.length >= 20 && /、/.test(previousLabelBody)
    const currentIsLabel = LABEL_LINE_PATTERN.test(line)
    const currentLabelBody = currentIsLabel ? line.slice(line.search(/[：:]/) + 1).trim() : ''
    const startsNewBlock =
      isBulletLine(line) ||
      // `相关课程：Java程序设计` 这类「标签+内容」是独立一行，不能并进上一条
      (currentIsLabel && currentLabelBody.length > 0) ||
      // 技能列表的「领域 + 英文关键词」行（`工具与协议 Java Tool`）只在技能/简介里当作新行
      (options.skillList === true && /^[\u4e00-\u9fa5]{2,8}\s+[A-Za-z]/.test(line)) ||
      periodFromLine(line) !== null ||
      // 无日期的条目头（`个人技术博客 ｜ 个人项目`）也不能被上一条吞掉
      (/[｜|]/.test(line) && line.length <= 60 && !/[。；]$/.test(line))
    const previousEndsSentence = previous ? /[。！？；：.!?;:]$/.test(previous) : false
    // 条目头（带日期的那行）必须独立成行，否则标题会把下面整段正文吸进来
    const previousIsHeader = previous ? periodFromLine(previous) !== null : false
    if (
      previous &&
      !previousEndsSentence &&
      !previousIsHeader &&
      !labelBlocksMerge &&
      !startsNewBlock &&
      previous.length >= 12
    ) {
      const glue = /[A-Za-z0-9]$/.test(previous) && /^[A-Za-z0-9]/.test(line) ? ' ' : ''
      merged[merged.length - 1] = `${previous}${glue}${line}`
    } else {
      merged.push(line)
    }
  }
  return merged
}

export const createEmptyItem = (): ResumeItem => ({
  id: createId('import-item'),
  title: '',
  subtitle: '',
  period: '',
  location: '',
  content: '',
  bullets: [],
})

export const parseSimpleSection = (draft: SectionDraft): ResumeSection => {
  const item = createEmptyItem()
  const content: string[] = []
  for (const line of mergeWrappedLines(draft.lines, { skillList: true })) {
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

/**
 * 取副标题：正文首行通常是职位/技术栈这类补充信息。
 * 但它也可能是被折行的一段话（`技术栈：...` 接正文），所以过长时在句号处切开，
 * 剩下的仍归正文，避免整段正文被塞进副标题。
 */
const takeSubtitle = (body: string[]): { subtitle: string; rest: string[] } => {
  if (body.length === 0) return { subtitle: '', rest: [] }
  const first = body[0]
  if (isBulletLine(first) || /相关课程|主修课程/i.test(first)) return { subtitle: '', rest: body }
  if (first.length <= 80) return { subtitle: first, rest: body.slice(1) }
  const cut = first.search(/[。；]/)
  if (cut > 0 && cut <= 80) {
    return {
      subtitle: first.slice(0, cut + 1),
      rest: [first.slice(cut + 1).trim(), ...body.slice(1)].filter((line) => line.length > 0),
    }
  }
  return { subtitle: first, rest: body.slice(1) }
}

export const parseStructuredSection = (draft: SectionDraft): ResumeSection => {
  const lines = mergeWrappedLines(draft.lines)
  const blocks: string[][] = []
  let current: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    // 新条目通常以日期行开头；但个人项目经常不写日期（「Resume Studio ｜ 个人项目」），
    // 这类行如果有竖线分隔且下一行是技术栈，也要当成新条目，否则会被上一条吞掉。
    if (looksLikeEntryHeader(line, lines[index + 1]) && current.length > 0) {
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
    let body: string[]
    if (dateInfo) {
      // 日期行形如「公司 ｜ 职位 2023.07 - 至今」，日期前面是标题，日期后面可能还有正文
      item.title = dateInfo.title || firstLine
      item.period = dateInfo.period
      body = [dateInfo.rest, ...block.slice(1)].filter((line) => line.trim().length > 0)
    } else {
      item.title = firstLine
      body = block.slice(1)
    }

    const { subtitle, rest } = takeSubtitle(body)
    item.subtitle = subtitle
    for (const line of rest) {
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

export const parseEducationSection = (draft: SectionDraft): ResumeSection => {
  const section = parseStructuredSection(draft)
  const item = section.items[0]
  if (!item) return section
  const paragraphs = item.content.match(/<p>(.*?)<\/p>/g) ?? []
  const courseParagraphs = paragraphs.filter((paragraph) =>
    /相关课程|主修课程|课程/i.test(paragraph),
  )
  if (courseParagraphs.length > 0) {
    item.bullets.push(...courseParagraphs.map((paragraph) => paragraph.replace(/<\/?p>/g, '')))
    item.content = paragraphs
      .filter((paragraph) => !/相关课程|主修课程|课程/i.test(paragraph))
      .join('')
  }
  return section
}
