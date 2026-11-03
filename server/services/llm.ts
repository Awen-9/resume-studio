import { chatOnce, OllamaUnavailableError, ollamaModel } from './ollama.js'

/**
 * 统一的大模型调用层。
 *
 * 两种后端：
 * - 本地 Ollama（默认，不需要密钥）；
 * - DeepSeek（OpenAI 兼容的 Chat Completions，按请求携带用户的 API Key）。
 *
 * 密钥只存在用户的浏览器里、每次请求带过来，服务端不落盘也不写日志。
 */
export type ProviderId = 'ollama' | 'deepseek'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LlmRequest {
  provider: ProviderId
  /** DeepSeek 必填；Ollama 忽略。 */
  apiKey?: string
  model?: string
  messages: ChatMessage[]
  json?: boolean
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}

const DEFAULT_DEEPSEEK_BASE = 'https://api.deepseek.com/v1'

const deepseekBase = (): string =>
  (process.env.DEEPSEEK_BASE_URL ?? DEFAULT_DEEPSEEK_BASE).replace(/\/+$/, '')

/** DeepSeek 目前可用的对话模型（用于没有密钥时的提示文案）。 */
// DeepSeek 新一代模型名（V4）；老的 deepseek-chat / deepseek-reasoner 已被替换
export const DEEPSEEK_DEFAULT_MODELS = ['deepseek-flash', 'deepseek-v4-pro']

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

const deepseekRequest = async (
  path: string,
  apiKey: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<Response> => {
  const key = apiKey.trim()
  if (!key) throw new ProviderError('没有配置 DeepSeek API Key', 400)
  try {
    return await fetch(`${deepseekBase()}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${key}`,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    })
  } catch (error) {
    throw new ProviderError(
      `连不上 DeepSeek：${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

const deepseekChat = async (request: LlmRequest): Promise<string> => {
  const once = async (): Promise<string> => {
    const response = await deepseekRequest('/chat/completions', request.apiKey ?? '', {
      method: 'POST',
      signal: request.signal,
      body: {
        model: request.model || DEEPSEEK_DEFAULT_MODELS[0],
        messages: request.messages,
        temperature: request.temperature ?? 0.3,
        max_tokens: request.maxTokens ?? 2000,
        stream: false,
        // DeepSeek V4 系列是推理模型，默认 effort=high 会把输出预算全花在内部推理上、
        // 导致 content 返回空。low 档推理短、答案出得快，符合出题/改写这类任务。
        effort: 'low',
        // 兼容不同代际的参数名：V4 用 effort，V3.2 用 reasoning_effort；多余的会被网关忽略
        reasoning_effort: 'low',
        ...(request.json ? { response_format: { type: 'json_object' } } : {}),
      },
    })

    if (response.status === 401 || response.status === 403) {
      throw new ProviderError('DeepSeek 拒绝了这个 API Key，请检查是否填错或已过期', 401)
    }
    if (response.status === 429) {
      throw new ProviderError('DeepSeek 返回限流，稍等几秒再试', 429)
    }
    if (!response.ok) {
      throw new ProviderError(`DeepSeek 返回 ${response.status}`)
    }
    const rawText = await response.text()
    let payload: unknown
    try {
      payload = JSON.parse(rawText)
    } catch {
      throw new ProviderError(`DeepSeek 返回了非 JSON：${rawText.slice(0, 200)}`)
    }
    const message = (
      payload as {
        choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>
      }
    ).choices?.[0]?.message
    // reasoning_content 是思考过程，content 才是正式答案。绝不能把思考过程当答案。
    const content = message?.content ?? ''
    if (!content.trim()) {
      const hasReasoning = Boolean(message?.reasoning_content)
      const error = new ProviderError(
        hasReasoning
          ? '模型只输出了思考过程、没有正式答案（content 为空）。这是推理模型把输出预算全花在内部推理上了。'
          : `模型返回了空内容：${rawText.replace(/\s+/g, ' ').slice(0, 240)}`,
      )
      // 标记为「可重试」，让上层退避后再试一次
      ;(error as Error & { retryable?: boolean }).retryable = true
      throw error
    }
    return content
  }

  try {
    return await once()
  } catch (error) {
    const retryable = (error as Error & { retryable?: boolean }).retryable
    if (retryable && !request.signal?.aborted) {
      // 推理模型的空 content 有随机性，重试一次通常就能出答案
      return await once()
    }
    throw error
  }
}

/** 列出某个后端当前可用的模型。 */
export const listModels = async (
  provider: ProviderId,
  apiKey?: string,
): Promise<{ models: string[]; error?: string }> => {
  if (provider === 'ollama') {
    try {
      const response = await fetch(`${process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434'}/api/tags`)
      if (!response.ok) return { models: [], error: 'Ollama 没有响应' }
      const payload = (await response.json()) as { models?: Array<{ name?: string }> }
      const models = (payload.models ?? []).map((item) => item.name ?? '').filter(Boolean)
      return { models }
    } catch {
      return { models: [], error: '连不上本机 Ollama' }
    }
  }

  if (!apiKey?.trim()) return { models: [], error: '还没有填写 API Key' }
  try {
    const response = await deepseekRequest('/models', apiKey)
    if (!response.ok) return { models: [], error: `DeepSeek 返回 ${response.status}` }
    const payload = (await response.json()) as { data?: Array<{ id?: string }> }
    const models = (payload.data ?? []).map((item) => item.id ?? '').filter(Boolean)
    return { models: models.length > 0 ? models : DEEPSEEK_DEFAULT_MODELS }
  } catch (error) {
    return { models: [], error: error instanceof Error ? error.message : '读取模型列表失败' }
  }
}

/** 统一入口：按后端分发。Ollama 复用已有的 chatOnce（含 json/think/num_ctx 处理）。 */
export const chatLlm = async (request: LlmRequest): Promise<string> => {
  if (request.provider === 'ollama') {
    return chatOnce({
      messages: request.messages,
      json: request.json,
      temperature: request.temperature,
      numPredict: request.maxTokens,
      signal: request.signal,
      model: request.model || ollamaModel(),
    })
  }
  return deepseekChat(request)
}

export { OllamaUnavailableError }
