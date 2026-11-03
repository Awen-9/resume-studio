import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { withAiSlot } from '../shared/aiLimiter.js'
import { ProviderError } from '../services/llm.js'
import { friendlyAiError } from '../services/aiStable.js'
import { optimizeResume } from '../services/resumeOptimizer.js'

const bodySchema = z.object({
  jd: z.string().trim().min(10, '岗位描述至少 10 个字').max(6000),
  resume: z.string().trim().min(20, '简历内容至少 20 个字').max(12000),
  provider: z.enum(['ollama', 'deepseek']).default('ollama'),
  apiKey: z.string().max(200).optional(),
  model: z.string().max(120).optional(),
})

export const registerResumeOptimizeRoute = (server: FastifyInstance): void => {
  /** AI 改简历：返回可一键采用的逐条改写建议。 */
  server.post('/api/ai/optimize', async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      return reply.code(400).send({ message: parsed.error.issues[0]?.message ?? '请求参数不正确' })
    }

    const controller = new AbortController()
    reply.raw.on('close', () => {
      if (!reply.raw.writableEnded) controller.abort()
    })
    const timer = setTimeout(() => controller.abort(), 180_000)

    try {
      const result = await withAiSlot(() =>
        optimizeResume({ ...parsed.data, signal: controller.signal }),
      )
      return { model: parsed.data.model ?? 'local', ...result }
    } catch (error) {
      if (error instanceof ProviderError) {
        return reply.code(error.status).send({ message: friendlyAiError(error) })
      }
      if (controller.signal.aborted) return reply.code(499).send({ message: '已取消' })
      request.log.error(error)
      return reply.code(502).send({
        message: friendlyAiError(error),
        detail: process.env.NODE_ENV === 'production' ? undefined : String(error),
      })
    } finally {
      clearTimeout(timer)
      reply.raw.off('close', () => {})
    }
  })
}
