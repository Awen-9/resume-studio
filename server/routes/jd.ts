import type { FastifyInstance } from 'fastify'
import { withAiSlot } from '../shared/aiLimiter.js'
import { ProviderError } from '../services/llm.js'
import { friendlyAiError } from '../services/aiStable.js'
import { streamJd } from '../services/jd.js'

const bodySchema = {
  type: 'object',
  required: ['role'],
  properties: {
    role: { type: 'string', minLength: 1, maxLength: 120 },
    provider: { type: 'string', enum: ['ollama', 'deepseek'] },
    apiKey: { type: 'string' },
    model: { type: 'string' },
  },
} as const

export const registerJdRoute = (server: FastifyInstance): void => {
  /** 一句话生成 JD（SSE）：{"chunk":"..."} / {"done":true} / {"error":"..."} */
  server.post('/api/ai/jd/stream', { schema: { body: bodySchema } }, async (request, reply) => {
    const body = request.body as {
      role: string
      provider?: 'ollama' | 'deepseek'
      apiKey?: string
      model?: string
    }
    const role = body.role.trim()
    if (!role) return reply.code(400).send({ message: '先写一句岗位方向，例如「Agent 工程师」' })

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

    // 立刻回一行注释：模型冷启动可能要 30 秒才吐第一个 token，
    // 这段时间里连接不能"看起来像没响应"，否则代理/浏览器会判定失败。
    raw.write(': connected\n\n')
    const heartbeat = setInterval(() => raw.write(': ping\n\n'), 5_000)

    const controller = new AbortController()
    raw.on('close', () => {
      if (!raw.writableEnded) controller.abort()
    })
    const timer = setTimeout(() => controller.abort(), 180_000)

    try {
      await withAiSlot(async () => {
        let emitted = ''
        for await (const chunk of streamJd({
          role,
          provider: body.provider,
          apiKey: body.apiKey,
          model: body.model,
          signal: controller.signal,
        })) {
          emitted += chunk
          send({ chunk })
        }
        if (!emitted.trim()) throw new Error('模型没有输出内容')
        send({ done: true })
      })
    } catch (error) {
      if (error instanceof ProviderError) send({ error: friendlyAiError(error) })
      else if (!controller.signal.aborted) {
        request.log.error(error)
        send({
          error: '生成 JD 失败，请稍后重试',
          // 开发环境把真实原因带出来，方便定位是模型没加载还是格式问题
          detail: process.env.NODE_ENV === 'production' ? undefined : String(error),
        })
      }
    } finally {
      clearInterval(heartbeat)
      clearTimeout(timer)
      raw.end()
    }
  })
}
