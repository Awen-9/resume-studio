import { chatLlm, ProviderError, type LlmRequest } from './llm.js'
import { ollamaModel } from './ollama.js'

/**
 * AI 输出的稳定性层。
 *
 * 这几个月反复踩的坑（空 content、思考链泄漏、格式数组、中文枚举）本质是同一件事：
 * 模型输出不可控。这里集中解决三件：
 * 1. 友好错误文案：内部术语（content 为空）不再直接透给用户；
 * 2. 解析失败的自动修复：把错误喂回去让模型重写一次；
 * 3. 多模型降级：cloud 里 flash → v4-pro，最后回到本地。
 */

/** 把内部错误映射成用户能行动的话。 */
export const friendlyAiError = (error: unknown): string => {
  if (error instanceof ProviderError) {
    const message = error.message
    if (message.includes('401') || message.includes('403') || message.includes('拒绝')) {
      return 'API Key 无效或已过期，请在设置里重新填写'
    }
    if (message.includes('429') || message.includes('限流')) {
      return '请求太频繁，稍等几秒再试'
    }
    if (message.includes('连不上')) {
      return '连不上模型服务，请检查网络或模型地址'
    }
    if (message.includes('空内容') || message.includes('思考过程')) {
      return '模型没有给出结果，已自动重试，请再点一次或换个模型'
    }
    if (message.includes('400') || message.includes('404')) {
      return '模型名或参数不被支持，请在设置里换个模型'
    }
    return message
  }
  if (error instanceof Error) {
    if (error.message.includes('没有按格式')) {
      return '模型输出格式异常，已自动尝试修复；若仍失败请换一个模型'
    }
    if (error.message.includes('空')) {
      return '模型没有返回内容，请重试'
    }
    return error.message
  }
  return 'AI 调用失败，请重试'
}

/**
 * 模型降级链。
 *
 * DeepSeek：首选 flash（快），失败降级到 v4-pro（重、更稳）；
 * 本地：用用户选的模型，没有就默认 qwen3-8b。
 * 云端整链失败时，调用方可以再回退本地（见 askJsonStable）。
 */
export const cloudFallbackChain = (preferred?: string): string[] => {
  if (!preferred) return ['deepseek-flash', 'deepseek-v4-pro']
  if (preferred === 'deepseek-v4-pro') return ['deepseek-v4-pro']
  if (preferred === 'deepseek-flash') return ['deepseek-flash', 'deepseek-v4-pro']
  // 网关自带的模型名：只试这一个，再往下就本地
  return [preferred]
}

/**
 * 非流式 JSON 调用，带「解析失败修复重试 + 模型降级」。
 *
 * @param request  模型请求（provider 决定走哪条链）
 * @param parse    从模型输出文本里解析出结构化结果；返回 null 表示解析失败
 */
export const askJsonStable = async <T>(
  request: LlmRequest,
  parse: (text: string) => T | null,
): Promise<T> => {
  const providers: Array<{ provider: LlmRequest['provider']; model?: string }> =
    request.provider === 'deepseek'
      ? cloudFallbackChain(request.model).map((model) => ({ provider: 'deepseek' as const, model }))
      : [{ provider: 'ollama' as const, model: request.model || ollamaModel() }]

  let lastError: unknown
  for (const step of providers) {
    try {
      const base: LlmRequest = {
        ...request,
        provider: step.provider,
        model: step.model,
        apiKey: step.provider === 'deepseek' ? request.apiKey : undefined,
      }
      let text = await chatLlm(base)
      let parsed = parse(text)
      if (parsed) return parsed

      // 修复重试：把错误喂回去，要求只输出合法 JSON
      text = await chatLlm({
        ...base,
        temperature: 0.1,
        messages: [
          ...base.messages,
          { role: 'assistant', content: text.slice(0, 300) },
          { role: 'user', content: '上面的输出不符合要求，请只输出合法 JSON，不要代码块和说明。' },
        ],
      })
      parsed = parse(text)
      if (parsed) return parsed
    } catch (error) {
      lastError = error
      // 云端里 flash 失败继续 v4-pro；整链失败向上抛
    }
  }
  throw lastError ?? new Error('模型没有返回可用结果')
}
