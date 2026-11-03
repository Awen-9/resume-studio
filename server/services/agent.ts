import { z } from 'zod'
import { chatLlm, type ProviderId } from './llm.js'

/**
 * 极简 agent 编排层。
 *
 * 不做 OpenAI 原生 function-calling（那样绑定云端），而是用「JSON 动作」：
 * 每次循环让模型返回一个动作对象，本层执行对应工具、把结果塞回上下文，再进入下一轮。
 * 这样本地 Ollama、DeepSeek 都可用，也便于测试与审计每一步。
 */

export interface AgentTool {
  /** 唯一名，模型按这个名字选工具。 */
  name: string
  /** 一句话说明，会写进提示词，越具体模型越不容易选错。 */
  description: string
  /** JSON Schema 片段（字符串形式），告诉模型参数长什么样。 */
  parameters: string
  run: (args: Record<string, unknown>) => Promise<unknown>
}

const actionSchema = z.object({
  tool: z.string().nullable(),
  args: z.record(z.string(), z.unknown()).default({}),
  done: z.boolean().default(false),
  answer: z.string().max(2000).default(''),
})

export interface AgentStep {
  tool: string
  args: Record<string, unknown>
  result: unknown
}

export interface AgentResult {
  steps: AgentStep[]
  answer: string
}

const buildSystemPrompt = (tools: AgentTool[]): string => {
  const toolList = tools
    .map((tool) => `- ${tool.name}：${tool.description}。参数：${tool.parameters}`)
    .join('\n')
  return [
    '你是一个任务编排 agent。为了完成目标，你可以调用下面的工具，一次只调用一个。',
    '',
    '输出格式（严格遵守，只输出 JSON 对象）：',
    '继续调用工具：{"tool":"工具名","args":{...},"done":false,"answer":""}',
    '任务完成：{"tool":null,"args":{},"done":true,"answer":"对用户说的最终结果"}',
    '不要 markdown 代码块，不要解释。',
    '',
    '可用工具：',
    toolList,
  ].join('\n')
}

export const runAgent = async (input: {
  goal: string
  tools: AgentTool[]
  /** 可选材料：会直接放进上下文，让模型知道它已经「有」这些内容，不必反问用户。 */
  jd?: string
  resume?: string
  provider?: ProviderId
  apiKey?: string
  model?: string
  signal?: AbortSignal
  maxSteps?: number
  /** 每执行完一个工具就回调一次，用于 SSE 逐步骤推给前端。 */
  onStep?: (step: AgentStep) => void
  /** 可注入的模型调用，默认走 chatLlm；测试用假模型驱动循环。 */
  chat?: (messages: Array<{ role: string; content: string }>, json: boolean) => Promise<string>
}): Promise<AgentResult> => {
  const maxSteps = input.maxSteps ?? 8
  const steps: AgentStep[] = []
  const context: string[] = [`目标：${input.goal}`]
  if (input.jd?.trim()) context.push(`岗位描述（JD）：\n${input.jd.trim()}`)
  if (input.resume?.trim()) context.push(`候选人简历：\n${input.resume.trim()}`)
  context.push('上面的简历和 JD 已经提供，直接调用工具完成目标，不要再反问用户索要材料。')
  const ask = (messages: Array<{ role: string; content: string }>): Promise<string> => {
    if (input.chat) return input.chat(messages, true)
    return chatLlm({
      provider: input.provider ?? 'ollama',
      apiKey: input.apiKey,
      model: input.model,
      json: true,
      temperature: 0.2,
      maxTokens: 1200,
      signal: input.signal,
      messages: messages as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    })
  }

  for (let step = 0; step < maxSteps; step += 1) {
    const action = await ask([
      { role: 'system', content: buildSystemPrompt(input.tools) },
      { role: 'user', content: context.join('\n\n') },
    ])

    const parsed = actionSchema.safeParse(parseAction(action))
    if (!parsed.success) {
      context.push('上次输出不是合法动作 JSON，请只输出 {"tool":...} 或 {"done":true,...}。')
      continue
    }
    const { tool, args, done, answer } = parsed.data

    if (done || !tool) return { steps, answer }

    const found = input.tools.find((candidate) => candidate.name === tool)
    if (!found) {
      context.push(
        `没有名为「${tool}」的工具，可用工具：${input.tools.map((t) => t.name).join('、')}。`,
      )
      continue
    }

    let result: unknown
    try {
      result = await found.run(args)
    } catch (error) {
      result = { error: error instanceof Error ? error.message : String(error) }
    }
    steps.push({ tool, args, result })
    input.onStep?.({ tool, args, result })
    context.push(`工具 ${tool} 的执行结果：\n${JSON.stringify(result).slice(0, 4000)}`)
  }

  return { steps, answer: '达到最大步数仍未结束，已停止。' }
}

/** 容错解析：模型可能用代码块或前后多字，只取第一个 { 到最后一个 }。 */
const parseAction = (text: string): unknown => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return text
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return text
  }
}
