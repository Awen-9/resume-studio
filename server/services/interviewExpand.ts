import { z } from 'zod'
import { chatLlm, type ProviderId } from './llm.js'
import { TYPE_RUBRICS, type PromptType } from './interviewPrompts.js'
import { resolveProfile, type PromptProfileId } from './interviewProfiles.js'

const buildSystemPrompt = (profileId?: PromptProfileId): string => {
  const profile = resolveProfile(profileId)
  return [
    '你是资深技术面试官。用户会给你一道面试题和一份简略答案，请把它扩写成可以直接照读的详细答案。',
    '',
    '要求：',
    '1. 只输出 JSON：{"answer":"..."}，不要代码块、不要解释；',
    `2. 长度 ${profile.answerLength}，用「1) 2) 3)」分点，每点至少两句；`,
    '3. 必须出现具体组件名、命令或配置项、数据结构，以及至少两个量化指标；',
    '4. 必须写清失败时的现象，便于排查；',
    profile.richText
      ? '5. 关键术语用 **加粗**，命令/参数用 `反引号`；'
      : '5. 纯文本输出，不要使用加粗和反引号；',
    '6. 不许编造简历里没有的项目数据，只补通用技术细节。',
    '',
    '段落结构：',
    profile.sections.join('\n'),
  ].join('\n')
}

const schema = z.object({ answer: z.string().min(50).max(4000) })

export const expandAnswer = async (input: {
  question: string
  answer: string
  type: PromptType
  jd?: string
  resume?: string
  provider?: ProviderId
  apiKey?: string
  model?: string
  profile?: PromptProfileId
  signal?: AbortSignal
}): Promise<string> => {
  const prompt = [
    `题型：${input.type}（答题结构：${TYPE_RUBRICS[input.type] ?? '结论先行，再给细节'}）`,
    '',
    `题目：${input.question}`,
    '',
    `现有答案（太简略）：${input.answer}`,
    '',
    input.jd?.trim() ? `岗位描述：${input.jd}` : '',
    input.resume?.trim() ? `候选人简历：${input.resume.slice(0, 3000)}` : '',
    '',
    '请扩写这份答案。',
  ]
    .filter(Boolean)
    .join('\n')

  const text = await chatLlm({
    provider: input.provider ?? 'ollama',
    apiKey: input.apiKey,
    model: input.model,
    messages: [
      { role: 'system', content: buildSystemPrompt(input.profile) },
      { role: 'user', content: prompt },
    ],
    json: true,
    temperature: 0.4,
    maxTokens: 2400,
    signal: input.signal,
  })

  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const parsed = schema.safeParse(JSON.parse(text.slice(start, end + 1)))
      if (parsed.success) return parsed.data.answer
    } catch {
      // 落到下面的兜底
    }
  }
  const fallback = text.trim()
  if (fallback.length < 50) throw new Error('模型没有返回可用的答案')
  return fallback
}
