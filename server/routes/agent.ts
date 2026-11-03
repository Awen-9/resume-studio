import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { withAiSlot } from '../shared/aiLimiter.js'
import { friendlyAiError } from '../services/aiStable.js'
import { runAgent, type AgentTool } from '../services/agent.js'
import { summarizeResume } from '../services/resumeSummarizer.js'
import { optimizeResume } from '../services/resumeOptimizer.js'
import { generateInterviewQuestions, normalizeQuestionTypes } from '../services/interview.js'

const bodySchema = z.object({
  goal: z.string().trim().min(4).max(400),
  jd: z.string().max(6000).optional(),
  resume: z.string().trim().min(20).max(12000),
  provider: z.enum(['ollama', 'deepseek']).default('ollama'),
  apiKey: z.string().max(200).optional(),
  model: z.string().max(120).optional(),
})

/** 内置工具集：把已有的三个能力包成 agent 能调用的工具。 */
const buildTools = (ctx: {
  provider: 'ollama' | 'deepseek'
  apiKey?: string
  model?: string
  signal?: AbortSignal
  jd: string
  resume: string
}): AgentTool[] => [
  {
    name: 'summarize_resume',
    description: '把简历总结成技术栈/经历/亮点/可追问点四段摘要（简历已在上下文里，无需传参）',
    parameters: '{}',
    run: () =>
      summarizeResume({
        resume: ctx.resume,
        jd: ctx.jd || undefined,
        provider: ctx.provider,
        apiKey: ctx.apiKey,
        model: ctx.model,
        signal: ctx.signal,
      }),
  },
  {
    name: 'optimize_resume',
    description: '根据 JD 给出逐条改写建议 before/after/reason（JD 和简历已在上下文里）',
    parameters: '{}',
    run: () =>
      optimizeResume({
        jd: ctx.jd,
        resume: ctx.resume,
        provider: ctx.provider,
        apiKey: ctx.apiKey,
        model: ctx.model,
        signal: ctx.signal,
      }),
  },
  {
    name: 'generate_questions',
    description: '根据 JD 和简历出面试题（两者已在上下文里，只需给题数）',
    parameters: '{ count: number, types: string[] }',
    run: (args) =>
      generateInterviewQuestions({
        jd: ctx.jd,
        resume: ctx.resume,
        types: normalizeQuestionTypes(args.types),
        count: Number(args.count ?? 3),
        provider: ctx.provider,
        apiKey: ctx.apiKey,
        model: ctx.model,
        signal: ctx.signal,
      }),
  },
]

export const registerAgentRoute = (server: FastifyInstance): void => {
  /** 跑一个 agent 任务，SSE 逐步推送工具执行过程。 */
  server.post('/api/agent/run', async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body ?? {})
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

    const controller = new AbortController()
    raw.on('close', () => {
      if (!raw.writableEnded) controller.abort()
    })
    const timer = setTimeout(() => controller.abort(), 300_000)

    try {
      await withAiSlot(async () => {
        const result = await runAgent({
          goal: parsed.data.goal,
          jd: parsed.data.jd ?? '',
          resume: parsed.data.resume,
          tools: buildTools({
            provider: parsed.data.provider,
            apiKey: parsed.data.apiKey,
            model: parsed.data.model,
            signal: controller.signal,
            jd: parsed.data.jd ?? '',
            resume: parsed.data.resume,
          }),
          provider: parsed.data.provider,
          apiKey: parsed.data.apiKey,
          model: parsed.data.model,
          signal: controller.signal,
          onStep: (step) => send({ step }),
        })
        send({ done: true, answer: result.answer })
      })
    } catch (error) {
      if (!controller.signal.aborted) {
        send({ error: friendlyAiError(error) })
      }
    } finally {
      clearTimeout(timer)
      raw.end()
    }
  })
}
