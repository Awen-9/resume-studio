import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { withAiSlot } from '../shared/aiLimiter.js'
import { ProviderError } from '../services/llm.js'
import { expandAnswer } from '../services/interviewExpand.js'
import { QUESTION_TYPES } from '../services/interview.js'

const bodySchema = z.object({
  question: z.string().trim().min(4).max(600),
  answer: z.string().trim().min(1).max(4000),
  type: z.enum(QUESTION_TYPES).default('scenario'),
  jd: z.string().max(6000).optional(),
  resume: z.string().max(12000).optional(),
  provider: z.enum(['ollama', 'deepseek']).default('ollama'),
  profile: z.enum(['compact', 'standard', 'deep']).default('standard'),
  apiKey: z.string().max(200).optional(),
  model: z.string().max(120).optional(),
})

export const registerInterviewExpandRoute = (server: FastifyInstance): void => {
  /** 把一条简略答案扩写成详细版（面试官要的是能照读的口径）。 */
  server.post('/api/interview/expand', async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      return reply.code(400).send({ message: parsed.error.issues[0]?.message ?? '参数不正确' })
    }

    const controller = new AbortController()
    reply.raw.on('close', () => {
      if (!reply.raw.writableEnded) controller.abort()
    })
    const timer = setTimeout(() => controller.abort(), 180_000)

    try {
      const answer = await withAiSlot(() =>
        expandAnswer({ ...parsed.data, signal: controller.signal }),
      )
      return { answer }
    } catch (error) {
      if (error instanceof ProviderError)
        return reply.code(error.status).send({ message: error.message })
      if (controller.signal.aborted) return reply.code(499).send({ message: '已取消' })
      request.log.error(error)
      return reply.code(502).send({ message: '展开失败，请稍后重试' })
    } finally {
      clearTimeout(timer)
      reply.raw.off('close', () => {})
    }
  })
}
