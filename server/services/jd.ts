import { chatLlm, type ProviderId } from './llm.js'
import { streamChat } from './ollama.js'
import { stripThinking } from './ollama.js'

/**
 * 根据「一句话岗位」生成 JD。
 *
 * 输出纯文本（不用 markdown 符号），因为生成结果会直接填进 JD 文本框，
 * 用户可以改、也可以立刻拿去出题。
 */
const SYSTEM_PROMPT = [
  '你是资深技术招聘经理，负责写中文岗位描述（JD）。',
  '',
  '要求：',
  '- 纯文本，不用 markdown 标题符号、不用加粗、不用代码块；',
  '- 结构固定为四段，每段用「岗位名称：」「岗位职责：」「任职要求：」「加分项：」开头；',
  '- 岗位职责 4-6 条，任职要求 5-8 条，加分项 2-4 条；',
  '- 每条以动词或名词短语开头，一条讲一件事；',
  '- 结合岗位方向写出具体技术栈，不要写「良好的沟通能力」这类空话堆砌；',
  '- 总长度 350-600 字。',
].join('\n')

const buildPrompt = (role: string): string =>
  ['目标岗位方向：', role, '', '请按上面的格式写一份完整 JD。'].join('\n')

export const buildJdMessages = (role: string) => [
  { role: 'system' as const, content: SYSTEM_PROMPT },
  { role: 'user' as const, content: buildPrompt(role) },
]

/** 流式产出 JD 文本。DeepSeek 一次性返回后整段吐出，事件形状保持一致。 */
export async function* streamJd(input: {
  role: string
  provider?: ProviderId
  apiKey?: string
  model?: string
  signal?: AbortSignal
}): AsyncGenerator<string> {
  const messages = buildJdMessages(input.role)

  if ((input.provider ?? 'ollama') === 'deepseek') {
    const text = await chatLlm({
      provider: 'deepseek',
      apiKey: input.apiKey,
      model: input.model,
      messages,
      temperature: 0.6,
      maxTokens: 1200,
      signal: input.signal,
    })
    yield stripThinking(text)
    return
  }

  for await (const delta of streamChat({
    messages,
    temperature: 0.6,
    numPredict: 1200,
    signal: input.signal,
    model: input.model,
  })) {
    const clean = stripThinking(delta)
    if (clean) yield clean
  }
}
