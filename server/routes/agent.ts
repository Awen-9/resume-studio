import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { Command } from '@langchain/langgraph'
import { z } from 'zod'
import { withAiSlot } from '../shared/aiLimiter.js'
import { friendlyAiError } from '../services/aiStable.js'
import {
  agentCheckpointer,
  buildAgentGraph,
  trackAgentSession,
} from '../services/agentGraph/graph.js'

const providerSchema = z.enum(['ollama', 'deepseek'])

const runSchema = z.object({
  goal: z.string().trim().min(2).max(2000),
  jd: z.string().max(12000).optional(),
  resume: z.string().trim().min(10).max(20000),
  provider: providerSchema.default('ollama'),
  apiKey: z.string().max(300).optional(),
  model: z.string().max(120).optional(),
  /** 会话 id：带上它就能继续上一轮对话；不带则新建一个。 */
  threadId: z.string().uuid().optional(),
})

const resumeSchema = z.object({
  threadId: z.string().uuid(),
  decision: z.enum(['accept', 'reject']),
  accepted: z.array(z.number().int().min(0)).max(20).optional(),
  provider: providerSchema.default('ollama'),
  apiKey: z.string().max(300).optional(),
  model: z.string().max(120).optional(),
})

type StreamChunk = [mode: string, data: unknown]

/**
 * 把图的执行过程转成 SSE。
 *
 * `streamMode: ['updates','custom']` 同时拿两路事件：
 * - custom：节点里用 writer() 推的工具步骤，前端画时间线
 * - updates：用来发现 `__interrupt__`（图在人工确认处暂停）
 */
const streamGraph = async (
  reply: FastifyReply,
  graph: ReturnType<typeof buildAgentGraph>,
  input: unknown,
  threadId: string,
): Promise<void> => {
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

  send({ threadId })

  const config = { configurable: { thread_id: threadId } }
  let interrupted = false

  try {
    await withAiSlot(async () => {
      const stream = await graph.stream(input as never, {
        ...config,
        streamMode: ['updates', 'custom'],
      })
      for await (const chunk of stream as AsyncIterable<StreamChunk>) {
        const [mode, data] = chunk
        if (mode === 'custom') {
          const payload = data as { type?: string; step?: unknown }
          if (payload.type === 'step' && payload.step) send({ step: payload.step })
          continue
        }
        if (mode === 'updates') {
          const update = data as { __interrupt__?: Array<{ value?: unknown }> }
          if (Array.isArray(update.__interrupt__) && update.__interrupt__.length > 0) {
            interrupted = true
            send({ interrupt: update.__interrupt__[0]?.value, threadId })
          }
        }
      }

      const snapshot = await graph.getState(config)
      const values = snapshot.values as { answer?: string }
      if (!interrupted) send({ done: true, answer: values.answer ?? '', threadId })
    })
  } catch (error) {
    if (!reply.raw.destroyed) send({ error: friendlyAiError(error) })
  } finally {
    raw.end()
  }
}

export const registerAgentRoute = (server: FastifyInstance): void => {
  server.post('/api/agent/run', async (request, reply) => {
    const parsed = runSchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      return reply.code(400).send({ message: parsed.error.issues[0]?.message ?? '请求参数不正确' })
    }

    let graph: ReturnType<typeof buildAgentGraph>
    try {
      graph = buildAgentGraph({
        provider: parsed.data.provider,
        apiKey: parsed.data.apiKey,
        model: parsed.data.model,
      })
    } catch (error) {
      return reply.code(400).send({ message: friendlyAiError(error) })
    }

    const threadId = parsed.data.threadId ?? randomUUID()
    await trackAgentSession(threadId)
    await streamGraph(
      reply,
      graph,
      {
        goal: parsed.data.goal,
        jd: parsed.data.jd ?? '',
        resume: parsed.data.resume,
      },
      threadId,
    )
  })

  server.post('/api/agent/resume', async (request, reply) => {
    const parsed = resumeSchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      return reply.code(400).send({ message: parsed.error.issues[0]?.message ?? '请求参数不正确' })
    }

    let graph: ReturnType<typeof buildAgentGraph>
    try {
      graph = buildAgentGraph({
        provider: parsed.data.provider,
        apiKey: parsed.data.apiKey,
        model: parsed.data.model,
      })
    } catch (error) {
      return reply.code(400).send({ message: friendlyAiError(error) })
    }

    await streamGraph(
      reply,
      graph,
      new Command({
        resume: { decision: parsed.data.decision, accepted: parsed.data.accepted },
      }),
      parsed.data.threadId,
    )
  })

  /** 会话状态：服务没有重启时，前端刷新后可以据此恢复多轮对话。 */
  server.get('/api/agent/session/:threadId', async (request, reply) => {
    const params = z.object({ threadId: z.string().uuid() }).safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: '会话 id 不正确' })
    const snapshot = await agentCheckpointer.getTuple({
      configurable: { thread_id: params.data.threadId },
    })
    if (!snapshot) return reply.code(404).send({ message: '没有这个会话' })
    const values = snapshot.checkpoint.channel_values as {
      messages?: Array<{ content?: unknown }>
      answer?: string
      intent?: string
    }
    const messages = (values.messages ?? []).map((message) => ({
      role: (message as { type?: string }).type ?? 'unknown',
      content:
        typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
    }))
    return { threadId: params.data.threadId, intent: values.intent ?? null, messages }
  })
}
