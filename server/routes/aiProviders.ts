import type { FastifyInstance } from 'fastify'
import { listModels } from '../services/llm.js'

/**
 * 模型可用性：前端据此只显示「当前真的能用」的模型。
 *
 * DeepSeek 的 Key 存在用户浏览器里，这里通过 `x-ai-key` 头临时带过来，
 * 服务端只用于这次探测，不保存、不写日志。
 */
export const registerAiProvidersRoute = (server: FastifyInstance): void => {
  server.get('/api/ai/providers', async (request) => {
    const apiKey =
      typeof request.headers['x-ai-key'] === 'string' ? (request.headers['x-ai-key'] as string) : ''

    const [ollama, deepseek] = await Promise.all([
      listModels('ollama'),
      apiKey ? listModels('deepseek', apiKey) : Promise.resolve({ models: [], error: undefined }),
    ])

    return {
      ollama: { available: ollama.models.length > 0, models: ollama.models, error: ollama.error },
      deepseek: {
        configured: Boolean(apiKey),
        models: deepseek.models,
        error: deepseek.error,
      },
    }
  })
}
