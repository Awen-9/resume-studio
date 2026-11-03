import { chatLlm, type ProviderId } from './llm.js'

/**
 * 用 AI 把简历压成一份「出题用的摘要」。
 *
 * 目的：出题的推理模型会逐字思考输入，直接喂长简历会让思考链爆炸、答案返回空。
 * 先总结成结构化摘要（技术栈、经历亮点、可追问的薄弱点），再拿摘要出题，
 * 输入短了、信息密度反而更高。
 */

const SUMMARY_SYSTEM = [
  '你是资深技术面试官。把候选人简历总结成一份用于出题的摘要。',
  '',
  '要求：',
  '1. 只输出摘要本身，不要标题、不要解释；',
  '2. 控制在 400-600 字，分四段：',
  '   - 技术栈：按熟练度分层列出核心技术；',
  '   - 核心经历：3-5 条，每条含项目背景、量化结果、用到的技术；',
  '   - 亮点：能让面试官眼前一亮的地方；',
  '   - 可追问点：简历里写得含糊、最值得面试时追问的 3-5 处（例如「性能优化没有给数据」「Agent 评测集怎么建的没写」）；',
  '3. 只基于简历里已有的信息，不虚构；简历没写的东西，写进「可追问点」而不是编出来。',
].join('\n')

export const summarizeResume = async (input: {
  resume: string
  jd?: string
  provider: ProviderId
  apiKey?: string
  model?: string
  signal?: AbortSignal
}): Promise<string> => {
  const user = [
    ...(input.jd?.trim() ? ['岗位描述：', input.jd.trim().slice(0, 600), ''] : []),
    '候选人简历：',
    input.resume.slice(0, 3000),
    '',
    '请按上述格式总结。',
  ].join('\n')

  const text = await chatLlm({
    provider: input.provider,
    apiKey: input.apiKey,
    model: input.model,
    messages: [
      { role: 'system', content: SUMMARY_SYSTEM },
      { role: 'user', content: user },
    ],
    temperature: 0.2,
    maxTokens: 4000,
    signal: input.signal,
  })
  const summary = text.trim()
  if (summary.length < 40) throw new Error('简历总结失败：模型返回内容太短')
  return summary
}
