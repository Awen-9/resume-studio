import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { RewriteResult } from './state.js'

/** 简历里常见的模块标题，顺序也用于「按模块读」时的兜底遍历。 */
export const RESUME_SECTION_NAMES = [
  '基本信息',
  '教育经历',
  '工作经历',
  '项目经历',
  '专业技能',
  '个人总结',
] as const

export type ResumeSectionName = (typeof RESUME_SECTION_NAMES)[number]

export interface ResumeSectionSlice {
  name: string
  content: string
}

/**
 * 按标题把纯文本简历切成模块。
 *
 * 输入是 `resumeToPlainText` 的结果，标题独立成行或写成「教育经历：xxx」；
 * 找不到标题时归到「其他」，保证内容不丢。
 */
export const splitResumeSections = (resume: string): ResumeSectionSlice[] => {
  const slices: ResumeSectionSlice[] = []
  let current: ResumeSectionSlice | null = null

  for (const line of resume.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (current) current.content += '\n'
      continue
    }
    const heading = RESUME_SECTION_NAMES.find(
      (name) =>
        trimmed === name ||
        trimmed.startsWith(`${name}：`) ||
        trimmed.startsWith(`${name}:`) ||
        trimmed.startsWith(`${name} `),
    )
    if (heading) {
      current = { name: heading, content: trimmed }
      slices.push(current)
      continue
    }
    if (!current) {
      current = { name: '其他', content: trimmed }
      slices.push(current)
      continue
    }
    current.content += `${current.content ? '\n' : ''}${trimmed}`
  }

  return slices
}

export const findResumeSection = (resume: string, name: string): string | null => {
  const target = name.trim()
  const slices = splitResumeSections(resume)
  const exact = slices.find((slice) => slice.name === target)
  if (exact) return exact.content
  const fuzzy = slices.find((slice) => slice.name.includes(target) || target.includes(slice.name))
  return fuzzy?.content ?? null
}

export interface AgentToolContext {
  resume: string
  jd: string
  /** 生成改写稿：由调用方注入，工具本身不关心模型是 Ollama 还是 DeepSeek。 */
  draftRewrite: (target: string, instruction?: string) => Promise<RewriteResult>
}

/**
 * Agent 可调用的工具集。
 *
 * 简历和 JD 已经在上下文里，但模型仍可能想「读一下某个模块」；
 * 把读模块、读 JD、生成改写稿做成工具，既符合按需取用，也方便在日志里看到它到底读了什么。
 */
export const buildAgentTools = (context: AgentToolContext) => [
  tool(
    async ({ section }) => {
      const found = findResumeSection(context.resume, section)
      return found ?? `没有找到「${section}」模块，简历全文如下：\n${context.resume.slice(0, 4000)}`
    },
    {
      name: 'read_resume_section',
      description: '读取简历里的一个模块（教育经历/工作经历/项目经历/专业技能/个人总结/基本信息）',
      schema: z.object({
        section: z.enum(RESUME_SECTION_NAMES).describe('要读取的模块名'),
      }),
    },
  ),
  tool(async () => context.jd || '（用户这次没有提供 JD）', {
    name: 'read_jd',
    description: '读取用户提供的岗位描述（JD）原文',
    schema: z.object({}),
  }),
  tool(async ({ target, instruction }) => context.draftRewrite(target, instruction), {
    name: 'draft_rewrite',
    description: '把一段简历原文改写成更贴合岗位的要点，返回改写前后对照',
    schema: z.object({
      target: z.string().describe('要改写的简历原文'),
      instruction: z.string().optional().describe('额外的改写要求'),
    }),
  }),
]
