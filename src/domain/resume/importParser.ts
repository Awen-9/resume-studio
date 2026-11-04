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
 *
 * 具体实现按阶段拆在 `./import/` 下：patterns（正则）、normalize（行归一化）、
 * sections（切模块与条目）、header（顶部个人信息）。本文件只做组装。
 */
import type { ResumeDocument, ResumeSection, SectionType } from './model.js'
import { parseProfile } from './import/header.js'
import { createId } from './import/ids.js'
import { normalizeResumeLines } from './import/normalize.js'
import {
  createEmptyItem,
  parseEducationSection,
  parseSimpleSection,
  parseStructuredSection,
  splitSections,
  toParagraphHtml,
  type SectionDraft,
} from './import/sections.js'

export { normalizeResumeLines }

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
