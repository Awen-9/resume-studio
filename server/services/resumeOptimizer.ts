import { z } from 'zod'
import { type ProviderId } from './llm.js'
import { askJsonStable } from './aiStable.js'

/**
 * AI 改简历：给定 JD + 结构化简历，产出一条条「可一键采用」的改写建议。
 *
 * 关键约束：绝不虚构经历/数字。模型只能改写既有表述（动词化、量化、命中 JD 关键词），
 * 不能新增简历里没有的东西——这是和「出题」最本质的区别，也是最容易翻车的地方。
 */

export interface ResumeEdit {
  /** 原文里要改的那句（尽量逐字复制，用于客户端定位）。 */
  before: string
  /** 改写后的版本。 */
  after: string
  /** 一句话说明为什么这么改。 */
  reason: string
}

export const editSchema = z.object({
  before: z.string().min(4).max(300),
  after: z.string().min(4).max(600),
  reason: z.string().min(4).max(200),
})

export const optimizeSchema = z.object({
  summary: z.string().min(10).max(400),
  edits: z.array(editSchema).min(1).max(12),
})

const SYSTEM_PROMPT = [
  '你是资深简历顾问，帮求职者把简历改得更匹配一份岗位描述（JD）。',
  '',
  '输出要求：只输出一个 JSON 对象：',
  '{"summary":"一句话总体建议","edits":[{"before":"...","after":"...","reason":"..."}]}',
  '不要 markdown 代码块，不要解释。',
  '',
  '改写规则（必须严格遵守）：',
  '1. before 必须逐字复制简历原文里的一句（短句，方便程序定位）；',
  '2. after 是改写后的版本：动词开头、量化结果、命中 JD 里的关键词；',
  '3. 只改写表述，绝不新增简历里没有的经历、数字、技术栈；',
  '4. reason 用一句话说明为什么改（例如「把弱动词换成可量化的动作」「补上 JD 要求的关键词」）；',
  '5. 优先改 JD 明确要求但简历缺失或写得含糊的地方；',
  '6. 最多 8 条，宁缺毋滥；没有值得改的地方就返回空 edits。',
].join('\n')

export const optimizeResume = async (input: {
  jd: string
  resume: string
  provider: ProviderId
  apiKey?: string
  model?: string
  signal?: AbortSignal
}): Promise<{ summary: string; edits: ResumeEdit[] }> => {
  const user = [
    '岗位描述：',
    input.jd.trim().slice(0, 3000),
    '',
    '候选人简历：',
    input.resume.slice(0, 8000),
    '',
    '请按上述 JSON 格式给出改写建议。',
  ].join('\n')

  const parse = (text: string): { summary: string; edits: ResumeEdit[] } | null => {
    try {
      const start = text.indexOf('{')
      const end = text.lastIndexOf('}')
      if (start < 0 || end <= start) return null
      const parsed = optimizeSchema.safeParse(JSON.parse(text.slice(start, end + 1)))
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  }

  const result = await askJsonStable(
    {
      provider: input.provider,
      apiKey: input.apiKey,
      model: input.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: user },
      ],
      json: true,
      temperature: 0.3,
      maxTokens: 6000,
      signal: input.signal,
    },
    (text) => parse(text),
  )
  return result
}
