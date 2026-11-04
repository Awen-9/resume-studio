/**
 * PDF 简历导入解析器。
 *
 * 负责把 `pdfTextExtractor` 提取出的纯文本，转换为结构化的 {@link ResumeDocument}：
 * 1. 归一化文本行：把 PDF 常见的「康熙部首」字符还原成汉字、合并汉字之间被插入的空格；
 * 2. 按「教育经历 / 工作经历 / 项目经历 / 核心技能 / 个人简介」等标题切分模块；
 * 3. 从顶部区域（preamble）识别姓名、手机号、邮箱、网站、城市与目标职位，兼容脱敏写法；
 * 4. 结构化模块按日期断句拆分条目，并把 PDF 折行造成的不完整句子重新拼接；
 * 5. 教育模块额外提取「相关课程」为要点列表。
 *
 * 解析结果是「尽力而为」的启发式处理，无法保证对所有简历版式完全准确，
 * 因此返回结果会携带 {@link ResumeImportResult.warnings}，由导入确认页兜底人工修订。
 */
import { escapeHtml } from './escapeHtml.js'
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
  /** PDF 页数（由提取层给出，用于判断是否导错文件）。 */
  pages?: number
  /** 模块 id → 它在归一化原文里的起始行下标与原始行内容。 */
  sectionSources: Record<string, { start: number; lines: string[] }>
}

interface SectionDraft {
  type: SectionType
  title: string
  lines: string[]
  /** 该模块第一行在归一化文本里的下标，供导入确认页高亮原文。 */
  start: number
}

const SECTION_DEFINITIONS: Array<{ type: SectionType; names: string[] }> = [
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
 * 日期区间：`2018.09 - 2022.06`、`2018 年 9 月 至 2022 年 6 月`、`2020.1-至今`、`2024 - 至今`。
 * 最后一种（只有年份）在真实简历里很常见，必须支持，否则条目切不开。
 */
const DATE_PATTERN =
  /((?:19|20)\d{2}\s*(?:[年./-]\s*\d{1,2}\s*月?)?\s*(?:-|–|—|~|至|到)\s*(?:(?:19|20)\d{2}\s*(?:[年./-]\s*\d{1,2}\s*月?)?|至今|现在))/i

/**
 * 手机号：允许 `+86` 前缀、`-`/空格分隔，**也允许脱敏写法**（如 `177****8476`）。
 * 原始实现只认 11 位纯数字，脱敏简历会直接漏掉。
 */
const PHONE_PATTERN = /(?:\+?86[-\s]?)?1[3-9]\d[\d\s*-]{7,9}\d/
/** 邮箱：本地部分允许 `*`，兼容 `****@163.com` 这类脱敏地址。 */
const EMAIL_PATTERN = /[A-Za-z0-9._%*+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/
/** 带协议的网址。 */
const URL_PATTERN = /https?:\/\/[^\s|丨｜]+/i
/** 不带协议但在简历里常见的站点（`awen-9.github.io`、`github.com/Awen-9`）。 */
const BARE_DOMAIN_PATTERN =
  /(?:[a-z0-9-]+\.)+(?:github\.io|com|cn|net|dev|me|io)(?:\/[^\s|丨｜]*)?/i
/** 姓名：2-4 个汉字，允许尾部脱敏星号（`吴**`、`张*`）。 */
const NAME_PATTERN = /^[\u4e00-\u9fa5]{1,4}\*{0,4}$/
/** 联系方式/个人属性行的标签，识别姓名时用于排除。 */
const CONTACT_LABEL_PATTERN =
  /(电话|手机|联系方式|邮箱|e-?mail|微信|现居|所在|地址|年龄|性别|生日)/i
/** 短标签行（`技术栈：`、`多 Agent 架构：`）——这类行不应与上一行拼接。 */
const LABEL_LINE_PATTERN = /^[\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9/ ]{0,10}[：:]/

const CJK = '\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF'
const CJK_CHAR_PATTERN = new RegExp(`[${CJK}]`)
const CJK_GAP_PATTERN = new RegExp(`([${CJK}])[ \\t]+(?=[${CJK}])`, 'g')
const CJK_END_GAP_PATTERN = new RegExp(`([${CJK}])[ \\t]+(?=[，。、；：！？）】」])`, 'g')

/**
 * 部分 PDF（尤其是子集化字体）会把汉字映射到「康熙部首」区（U+2E80–U+2FDF），
 * 例如 `人` 变成 `⼈`(U+2F08)、`心` 变成 `⼼`(U+2F3C)。
 *
 * U+2F00–U+2FD5（Kangxi Radicals）有 NFKC 映射，直接归一化即可；
 * 但 U+2E80–U+2EFF（CJK Radicals Supplement）里有相当一部分**没有**映射，
 * 例如 `⻄`(U+2EC4)、`⻋`(U+2ECB)，NFKC 后原样返回，必须自己补表。
 * 只对这两个区做替换，避免整段 NFKC 把中文全角标点改成半角。
 */
const RADICAL_FALLBACK: Record<number, string> = {
  0x2ea0: '民',
  0x2ec4: '西',
  0x2ec5: '见',
  0x2ec6: '角',
  0x2ecb: '车',
  0x2ed3: '长',
  0x2ed4: '门',
  0x2eda: '页',
  0x2edb: '风',
  0x2edd: '食',
}

const normalizeCjkRadicals = (value: string): string =>
  value.replace(/[\u2E80-\u2EFF\u2F00-\u2FDF]/g, (char) => {
    const fallback = RADICAL_FALLBACK[char.codePointAt(0) ?? 0]
    if (fallback) return fallback
    const normalized = char.normalize('NFKC')
    return normalized === char ? char : normalized
  })

/**
 * 汉字之间空格兜底清理：`个 ⼈ 简介` → `个人简介`。
 *
 * 根因已在 `pdfTextExtractor` 修掉（按字间距判断是否补空格、中文之间不补），
 * 这里保留一遍作为保险，兼容旧提取器产出的文本或源文件自带多余空格的 PDF。
 * 单遍足够，不再反复压缩。
 */
const collapseCjkSpaces = (value: string): string =>
  value.replace(CJK_GAP_PATTERN, '$1').replace(CJK_END_GAP_PATTERN, '$1')

const normalizeLine = (line: string): string => {
  return collapseCjkSpaces(
    normalizeCjkRadicals(
      line
        .replace(/\u200B|\u200C|\u200D|\uFEFF/g, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\s*([丨|｜])\s*/g, ' | '),
    ),
  ).trim()
}

const isNoiseLine = (line: string): boolean => {
  return (
    (line.length > 16 && /^[A-Za-z0-9_-]+$/.test(line)) ||
    (line.length > 24 && !CJK_CHAR_PATTERN.test(line) && !/[.@]/.test(line))
  )
}

export const normalizeResumeLines = (text: string): string[] => {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(normalizeLine)
    .filter((line) => line.length > 0 && !isNoiseLine(line))
}

/**
 * 判断是否为模块标题行。
 *
 * 两个约束缺一不可：标题必须短（≤12 字），且不能是句子——
 * 否则正文里出现的「5 年工作经历」会被误当成模块标题，导致整篇被切碎。
 */
const getSectionDefinition = (line: string): { type: SectionType; title: string } | null => {
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

const splitSections = (lines: string[]): { preamble: string[]; drafts: SectionDraft[] } => {
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

const periodFromLine = (line: string): { period: string; title: string; rest: string } | null => {
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

const isBulletLine = (line: string): boolean => {
  return new RegExp(String.raw`^\s*${BULLET_MARKER}\s*`).test(line)
}

const removeBulletMarker = (line: string): string => {
  return line.replace(new RegExp(String.raw`^\s*${BULLET_MARKER}\s*`), '').trim()
}

const toParagraphHtml = (lines: string[]): string => {
  return lines
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('')
}

/**
 * 把 PDF 折行造成的断句拼回去。
 *
 * 判定为「同一句」要同时满足：上一行不以句末标点结尾、当前行不是要点/标签/新条目。
 * 例如 `问答优秀率从` + `68.0% 提升到 89.3%。` 必须合并，否则会被拆成两个段落。
 */
/**
 * 判断某行是否是「一条新经历/项目」的开头。
 *
 * 绝大多数简历用「公司 ｜ 职位 2023.07 - 至今」这种带日期的行开头；
 * 但个人项目常常没有日期（`个人技术博客 ｜ 个人项目 · awen-9.github.io`），
 * 只靠日期会把这些条目并进上一条，导致最后一个项目"消失"。
 */
const looksLikeEntryHeader = (line: string, next?: string): boolean => {
  if (periodFromLine(line)) return true
  if (/[。；]$/.test(line)) return false
  if (next && /^技术栈\s*[:：]/.test(next)) return true
  return /[｜|]/.test(line) && line.length <= 60
}

const mergeWrappedLines = (lines: string[], options: { skillList?: boolean } = {}): string[] => {
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

const parseEducationSection = (draft: SectionDraft): ResumeSection => {
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

const parseStructuredSection = (draft: SectionDraft): ResumeSection => {
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

/** 把一条联系方式从正文里摘掉，避免它被当成姓名或职位。 */
const stripContactFragments = (line: string): string =>
  line
    .replace(PHONE_PATTERN, ' ')
    .replace(EMAIL_PATTERN, ' ')
    .replace(/\s*[|丨｜]\s*(?=[|丨｜]|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const pickName = (preamble: string[]): { name: string; line: string } => {
  for (const line of preamble) {
    const candidate = stripContactFragments(line)
    if (!candidate || CONTACT_LABEL_PATTERN.test(candidate)) continue
    if (/\d/.test(candidate)) continue
    if (NAME_PATTERN.test(candidate)) return { name: candidate, line }
  }
  const fallback = preamble
    .map(stripContactFragments)
    .find((line) => CJK_CHAR_PATTERN.test(line) && !CONTACT_LABEL_PATTERN.test(line))
  if (!fallback) return { name: '未填写姓名', line: '' }
  // 姓名通常写在行尾（`Java后端开发 测试用户`），所以从后往前找匹配的片段
  const token = fallback
    .split(/\s+/)
    .reverse()
    .find((part) => NAME_PATTERN.test(part))
  const runs = [...fallback.matchAll(/[\u4e00-\u9fa5]{2,4}\*{0,4}/g)].map((match) => match[0])
  return { name: token ?? runs.at(-1) ?? '未填写姓名', line: fallback }
}

const pickHeadline = (preamble: string[], nameLine: string, detailLine: string): string => {
  const roleLine = preamble.find(
    (line) =>
      line !== nameLine &&
      line !== detailLine &&
      !PHONE_PATTERN.test(line) &&
      !EMAIL_PATTERN.test(line) &&
      /(工程师|开发|架构|经理|产品|运营|设计|分析师|专家|负责人|程序员)/.test(line),
  )
  if (!roleLine) return '目标职位'
  // 去掉行尾的「博客：xxx」「GitHub：xxx」等附带信息，只留职位本身。
  return roleLine
    .split(/[丨|｜]/)
    .map((part) => part.replace(/(博客|blog|github|主页|网站)\s*[:：].*$/i, '').trim())
    .filter((part) => part.length > 0)
    .join(' / ')
    .slice(0, 60)
}

const parseProfile = (
  preamble: string[],
): { profile: ResumeDocument['profile']; used: Set<string> } => {
  const allText = preamble.join(' | ')
  const phone = allText.match(PHONE_PATTERN)?.[0]?.trim() ?? ''
  const email = allText.match(EMAIL_PATTERN)?.[0]?.trim() ?? ''
  // 域名要从「去掉邮箱之后」的文本里找，否则会把 `****@163.com` 的 `163.com` 当成个人网站
  const withoutEmails = allText.replace(EMAIL_PATTERN, ' ')
  const website =
    withoutEmails.match(URL_PATTERN)?.[0] ?? withoutEmails.match(BARE_DOMAIN_PATTERN)?.[0] ?? ''

  const { name, line: nameLine } = pickName(preamble)
  const detailLine =
    preamble.find(
      (line) => /[岁年男女性]/.test(line) && !PHONE_PATTERN.test(line) && !EMAIL_PATTERN.test(line),
    ) ?? ''
  const headline = pickHeadline(preamble, nameLine, detailLine)
  // 姓名与职位写在同一行时（`Java后端开发 测试用户`），姓名前面那段就是展示职位
  const nameIndex = nameLine.indexOf(name)
  const displayTitle =
    nameIndex > 0
      ? nameLine
          .slice(0, nameIndex)
          .replace(/[|丨｜]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      : ''
  const location = collapseCjkSpaces(allText.match(/现居\s*[:：]\s*([^|丨｜]+)/)?.[1]?.trim() ?? '')

  const used = new Set<string>([nameLine, detailLine])
  const headlineLine = preamble.find((line) => line.includes(headline.split(' / ')[0] ?? ''))
  if (headlineLine) used.add(headlineLine)
  for (const value of [phone, email, website]) {
    if (!value) continue
    const sourceLine = preamble.find((line) => line.includes(value))
    if (sourceLine) used.add(sourceLine)
  }

  return {
    profile: {
      name,
      headline,
      displayTitle: displayTitle || undefined,
      detail: detailLine || undefined,
      headerLayout: displayTitle || detailLine ? 'compact' : 'stacked',
      phone,
      email,
      location,
      website,
    },
    used,
  }
}

const buildSection = (draft: SectionDraft): ResumeSection => {
  if (draft.type === 'education') return parseEducationSection(draft)
  return ['skills', 'summary', 'custom'].includes(draft.type)
    ? parseSimpleSection(draft)
    : parseStructuredSection(draft)
}

/**
 * 单模块重新解析。
 *
 * 导入确认页里用户可以纠正模块类型（比如把误判成「教育经历」的实习经历改成「工作经历」），
 * 改完点「重新解析」把该模块的原文重跑一遍，不用整份重导。
 */
export const parseSectionFromLines = (input: {
  id: string
  type: SectionType
  title: string
  lines: string[]
}): ResumeSection => {
  const section = buildSection({
    type: input.type,
    title: input.title,
    lines: input.lines,
    start: 0,
  })
  return { ...section, id: input.id, title: input.title }
}

const buildDocumentTitle = (profile: ResumeDocument['profile'], fileName: string): string => {
  const fileBase = fileName.replace(/\.pdf$/i, '').trim()
  if (!profile.name || profile.name === '未填写姓名') return fileBase || '导入简历'
  const role = profile.headline && profile.headline !== '目标职位' ? profile.headline : ''
  return role ? `${profile.name} - ${role}` : profile.name
}

export const parseResumeText = (text: string, fileName = '导入简历.pdf'): ResumeImportResult => {
  const lines = normalizeResumeLines(text)
  const { preamble, drafts } = splitSections(lines)
  const { profile, used } = parseProfile(preamble)
  const parsedSections = drafts.map((draft) => buildSection(draft))
  // 记录每个模块对应的原文行，导入确认页据此高亮、并支持单模块重解析
  const sectionSources: ResumeImportResult['sectionSources'] = {}
  drafts.forEach((draft, index) => {
    const section = parsedSections[index]
    if (section) sectionSources[section.id] = { start: draft.start, lines: [...draft.lines] }
  })
  const remainingPreamble = drafts.length > 0 ? preamble.filter((line) => !used.has(line)) : []
  const warnings: string[] = []

  if (profile.name === '未填写姓名') warnings.push('没有识别到姓名，请在右侧属性面板确认。')
  if (!profile.phone) warnings.push('没有识别到手机号。')
  else if (profile.phone.includes('*')) warnings.push('手机号是脱敏格式，使用前请补全。')
  if (!profile.email) warnings.push('没有识别到邮箱。')
  else if (profile.email.includes('*')) warnings.push('邮箱是脱敏格式，使用前请补全。')
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
    // 文件名常是一串无意义的导出名，用「姓名 - 目标职位」更好认；都没识别到再退回文件名
    title: buildDocumentTitle(profile, fileName),
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    // 识别到的目标职位顺带写进「投递岗位」，首页卡片和 JD 匹配才有起点；
    // 识别失败时保持为空，避免把占位文案当成真实岗位。
    targetRole: profile.headline && profile.headline !== '目标职位' ? profile.headline : undefined,
    profile,
    theme: { ...DEFAULT_IMPORT_THEME },
    sections: parsedSections,
  }
  return {
    document,
    warnings,
    extractedLines: lines.length,
    sourceText: text,
    sectionSources,
  }
}
