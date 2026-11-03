import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { withAiSlot } from '../shared/aiLimiter.js'
import { formatIssues } from '../shared/schemas.js'
import { ollamaModel } from '../services/ollama.js'
import {
  generateInterviewQuestions,
  streamInterviewQuestions,
  QUESTION_TYPES,
} from '../services/interview.js'
import { ProviderError } from '../services/llm.js'
import { friendlyAiError } from '../services/aiStable.js'
import { summarizeResume } from '../services/resumeSummarizer.js'

const requestSchema = z.object({
  // JD 可选：不填就按简历出题
  jd: z.string().trim().max(6000).optional(),
  resume: z.string().trim().min(20, '简历内容至少 20 个字').max(12000),
  types: z.array(z.enum(QUESTION_TYPES)).min(1, '至少选择一种题型').max(5),
  count: z.coerce.number().int().min(1).max(12).default(5),
  model: z.string().trim().max(120).optional(),
  provider: z.enum(['ollama', 'deepseek']).default('ollama'),
  profile: z.enum(['compact', 'standard', 'deep']).default('standard'),
  apiKey: z.string().trim().max(200).optional(),
})

export const registerInterviewRoute = (server: FastifyInstance): void => {
  /**
   * 流式出题（SSE）：出一道推一道，界面不用等整批生成完。
   * 事件：{"question":{...}} / {"done":true,"model":"..."} / {"error":"..."}
   */
  server.post('/api/interview/questions/stream', async (request, reply) => {
    const parsed = requestSchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      return reply.code(400).send({ message: parsed.error.issues[0]?.message ?? '请求参数不正确' })
    }

    reply.hijack()
    const raw = reply.raw
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    const send = (payload: unknown): void => {
      raw.write(`data: ${JSON.stringify(payload)}\n\n`)
    }

    raw.write(': connected\n\n')
    const heartbeat = setInterval(() => raw.write(': ping\n\n'), 5_000)

    const controller = new AbortController()
    raw.on('close', () => {
      if (!raw.writableEnded) controller.abort()
    })
    const timer = setTimeout(() => controller.abort(), 240_000)

    try {
      await withAiSlot(async () => {
        // 先总结简历，再拿摘要出题：输入短、信息密度高，
        // 也避免推理模型对着长简历逐字思考把输出预算耗尽。
        const summary = await summarizeResume({
          resume: parsed.data.resume,
          jd: parsed.data.jd,
          provider: parsed.data.provider,
          apiKey: parsed.data.apiKey,
          model: parsed.data.model,
          signal: controller.signal,
        })
        send({ summary })

        let emitted = 0
        for await (const question of streamInterviewQuestions({
          jd: parsed.data.jd ?? '',
          resume: summary,
          types: parsed.data.types,
          count: parsed.data.count,
          signal: controller.signal,
          model: parsed.data.model,
          provider: parsed.data.provider,
          profile: parsed.data.profile,
          apiKey: parsed.data.apiKey,
        })) {
          emitted += 1
          send({ question })
        }
        if (emitted === 0) throw new Error('模型没有返回可用的题目')
        send({ done: true, model: parsed.data.model ?? ollamaModel() })
      })
    } catch (error) {
      if (controller.signal.aborted && !raw.writableEnded) {
        send({ error: '已暂停本次出题' })
      } else if (error instanceof ProviderError) {
        send({ error: friendlyAiError(error) })
      } else {
        request.log.error(error)
        send({
          error: friendlyAiError(error),
          detail: error instanceof Error ? error.message : String(error),
        })
      }
    } finally {
      clearInterval(heartbeat)
      clearTimeout(timer)
      raw.end()
    }
  })

  /**
   * 出题接口。
   *
   * 与 JD 体检共用一条模型队列：单卡并发只会让两边都变慢。
   * 取消沿用同一套「响应关闭即 abort」的做法。
   */
  server.post('/api/interview/questions', async (request, reply) => {
    const parsed = requestSchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      return reply.code(400).send({
        message: parsed.error.issues[0]?.message ?? '请求参数不正确',
        details: formatIssues(parsed.error.issues),
      })
    }

    const controller = new AbortController()
    const abortOnClose = (): void => {
      if (!reply.raw.writableEnded) controller.abort()
    }
    reply.raw.on('close', abortOnClose)
    // 出 12 道题在 CPU 上可能跑几分钟，给一个硬上限防止槽位被永久占住
    const timeout = setTimeout(() => controller.abort(), 240_000)

    try {
      return await withAiSlot(async () => {
        const result = await generateInterviewQuestions({
          jd: parsed.data.jd ?? '',
          resume: parsed.data.resume,
          types: parsed.data.types,
          count: parsed.data.count,
          signal: controller.signal,
          model: parsed.data.model,
          provider: parsed.data.provider,
          apiKey: parsed.data.apiKey,
        })
        return {
          model:
            parsed.data.model ?? (parsed.data.provider === 'ollama' ? ollamaModel() : 'deepseek'),
          provider: parsed.data.provider,
          questions: result.questions,
        }
      })
    } catch (error) {
      if (controller.signal.aborted) {
        return reply.code(499).send({ message: '已取消出题' })
      }
      if (error instanceof ProviderError) {
        return reply.code(error.status).send({ message: error.message })
      }
      request.log.error(error)
      return reply.code(502).send({
        message:
          parsed.data.provider === 'ollama'
            ? '出题失败：请确认本机 Ollama 正在运行，且已导入可用的模型'
            : '出题失败：请检查 DeepSeek 的 API Key 与网络',
      })
    } finally {
      clearTimeout(timeout)
      reply.raw.off('close', abortOnClose)
    }
  })
}
