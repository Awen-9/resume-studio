import { ChatDeepSeek } from '@langchain/deepseek'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { HumanMessage, type BaseMessage } from '@langchain/core/messages'
import { ChatOllama } from '@langchain/ollama'
import type { z } from 'zod'
import { ProviderError } from '../llm.js'
import { ollamaBaseUrl, ollamaModel } from '../ollama.js'

export type AiProviderId = 'ollama' | 'deepseek'

export interface ModelRequest {
  provider: AiProviderId
  apiKey?: string
  model?: string
}

/**
 * 把请求里的 provider/model 变成一个 LangChain ChatModel。
 *
 * 本地 Ollama 和 DeepSeek 走同一套接口，图里的节点不需要知道自己接的是哪个后端。
 */
export const createChatModel = (request: ModelRequest): BaseChatModel => {
  if (request.provider === 'deepseek') {
    const apiKey = request.apiKey?.trim()
    if (!apiKey) throw new ProviderError('DeepSeek 需要先在设置页填写 API Key')
    return new ChatDeepSeek({
      apiKey,
      model: request.model?.trim() || 'deepseek-chat',
      temperature: 0.2,
    })
  }

  return new ChatOllama({
    baseUrl: ollamaBaseUrl(),
    model: request.model?.trim() || ollamaModel(),
    temperature: 0.2,
    numCtx: 8192,
    numPredict: 1200,
    keepAlive: '5m',
    think: false,
  })
}

/**
 * withStructuredOutput + Zod 校验，失败时带着错误信息重试。
 *
 * 8B 本地模型经常第一轮就漏字段或把枚举写成近义词；把校验错误原样喂回去，
 * 通常第二轮就能按 schema 输出，比在前端猜要稳。
 */
export const invokeStructured = async <T extends Record<string, unknown>>(
  model: BaseChatModel,
  schema: z.ZodType<T>,
  messages: BaseMessage[],
  retries = 1,
): Promise<T> => {
  const structured = model.withStructuredOutput<T>(schema as never, { method: 'jsonMode' })
  let conversation = [...messages]
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await structured.invoke(conversation)
    } catch (error) {
      lastError = error
      const reason = error instanceof Error ? error.message : String(error)
      conversation = [
        ...conversation,
        new HumanMessage(
          `上次输出没有通过校验：${reason}。请严格按约定字段和枚举值重新输出一个 JSON 对象，不要加解释。`,
        ),
      ]
    }
  }

  throw lastError instanceof Error ? lastError : new Error('模型没有返回可解析的结构化结果')
}

/** 去掉 qwen3 可能漏出来的思考块（think: false 在旧版本 Ollama 上不生效）。 */
export const stripThinkingBlocks = (text: string): string => {
  let output = text
  const open = /<think(?:ing)?\b[^>]*>/i
  const close = /<\/think(?:ing)?>|<｜end[▁_]of[▁_]thinking｜>/i
  for (let guard = 0; guard < 5; guard += 1) {
    const start = output.search(open)
    if (start < 0) break
    const rest = output.slice(start)
    const end = rest.match(close)
    if (!end || end.index === undefined) {
      output = output.slice(0, start)
      break
    }
    output = output.slice(0, start) + rest.slice(end.index + end[0].length)
  }
  return output.trim()
}
