// @vitest-environment node

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../../server/app'

interface RecordedRequest {
  path: string
  body: {
    model?: string
    stream?: boolean
    think?: boolean
    format?: string
    keep_alive?: string
    messages?: Array<{ role: string; content: string }>
    options?: Record<string, number>
  }
}

/** 假的 Ollama：按队列依次回放响应，同时记录收到的请求体。 */
const startFakeOllama = async (
  replies: Array<{ content: string }>,
): Promise<{ url: string; requests: RecordedRequest[]; close: () => Promise<void> }> => {
  const requests: RecordedRequest[] = []
  let index = 0
  const server: Server = createServer((request, response) => {
    if (request.url === '/api/tags') {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ models: [{ name: 'qwen3-8b' }] }))
      return
    }
    let raw = ''
    request.on('data', (chunk) => (raw += chunk))
    request.on('end', () => {
      const body = JSON.parse(raw) as RecordedRequest['body']
      requests.push({ path: request.url ?? '', body })
      const reply = replies[Math.min(index, replies.length - 1)]
      index += 1
      const content = reply?.content ?? ''

      if (body.stream) {
        response.writeHead(200, { 'content-type': 'application/x-ndjson' })
        // 故意切成小块，覆盖「前缀闸门」跨块的场景
        for (const part of content.match(/[\s\S]{1,6}/g) ?? []) {
          response.write(`${JSON.stringify({ message: { content: part }, done: false })}\n`)
        }
        response.end(`${JSON.stringify({ done: true })}\n`)
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ message: { content } }))
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

describe('local model calls', () => {
  let server: FastifyInstance
  let fake: Awaited<ReturnType<typeof startFakeOllama>>
  const open = '<' + 'think>'
  const close = '<' + '/think>'

  beforeAll(async () => {
    server = await buildServer({
      host: '127.0.0.1',
      port: 0,
      projectRoot: '/tmp/resume-studio-test',
      distPath: '/tmp/resume-studio-test/dist',
      chromePath: '',
    })
  })

  afterAll(async () => {
    await server.close()
    await fake?.close()
  })

  const useFake = async (replies: Array<{ content: string }>): Promise<void> => {
    if (fake) await fake.close()
    fake = await startFakeOllama(replies)
    process.env.OLLAMA_URL = fake.url
  }

  /** 从 SSE 文本里取出事件负载。 */
  const parseEvents = (body: string): Array<Record<string, unknown>> =>
    body
      .split('\n\n')
      .map((block) => block.trim())
      .filter((block) => block.startsWith('data: '))
      .map((block) => JSON.parse(block.slice(6)) as Record<string, unknown>)

  it('sends chat messages with thinking off and a real context window', async () => {
    await useFake([{ content: '- 负责官网改版，首屏加载时间缩短' }])

    const response = await server.inject({
      method: 'POST',
      url: '/api/ai/rewrite/stream',
      payload: { text: '负责公司官网改版，加载速度变快' },
    })

    expect(response.statusCode).toBe(200)
    const recorded = fake.requests[0]
    expect(recorded?.path).toBe('/api/chat')
    expect(recorded?.body.model).toBe('qwen3-8b')
    // 关键参数：关思考、放大上下文、温度别太高
    expect(recorded?.body.think).toBe(false)
    expect(recorded?.body.options?.num_ctx).toBe(8192)
    expect(recorded?.body.options?.temperature).toBeLessThanOrEqual(0.35)
    expect(recorded?.body.keep_alive).toBe('5m')
    // 系统提示词必须真的下发，而不是全塞在用户消息里
    expect(recorded?.body.messages?.[0]?.role).toBe('system')
    expect(recorded?.body.messages?.[0]?.content).toContain('- ')
  })

  it('strips thinking blocks and pleasantries from the streamed result', async () => {
    await useFake([
      {
        content: `${open}用户想要更专业的说法${close}\n好的，以下是改写结果：\n1. 负责公司官网改版，首屏加载时间缩短\n2. 优化页面资源加载，用户投诉下降`,
      },
    ])

    const response = await server.inject({
      method: 'POST',
      url: '/api/ai/rewrite/stream',
      payload: { text: '负责公司官网改版，加载速度变快，投诉减少' },
    })

    const events = parseEvents(response.body)
    const streamed = events.map((event) => String(event.chunk ?? '')).join('')
    expect(streamed).not.toContain('think')
    expect(streamed).not.toContain('以下是')
    expect(streamed).not.toContain('用户想要更专业的说法')

    const done = events.find((event) => event.done === true)
    expect(done?.final).toBe(
      '- 负责公司官网改版，首屏加载时间缩短\n- 优化页面资源加载，用户投诉下降',
    )
  })

  it('retries once when the model only produced chatter', async () => {
    await useFake([
      { content: '好的，我可以帮你改写这段内容。' },
      { content: '- 负责订单系统稳定性建设' },
    ])

    const response = await server.inject({
      method: 'POST',
      url: '/api/ai/rewrite/stream',
      payload: { text: '负责订单系统稳定性' },
    })

    const events = parseEvents(response.body)
    expect(fake.requests.length).toBe(2)
    const done = events.find((event) => event.done === true)
    expect(done?.final).toBe('- 负责订单系统稳定性建设')
  })

  it('asks the model to redo malformed JSON instead of failing the whole check', async () => {
    await useFake([
      { content: '这不是 JSON' },
      {
        content:
          '{"score": 72, "summary": "整体匹配", "matched": ["Redis"], "missing": ["Kafka"], "suggestions": []}',
      },
    ])

    const response = await server.inject({
      method: 'POST',
      url: '/api/ai/match',
      payload: { jd: '需要熟悉 Redis 和 Kafka 的后端工程师', resume: '熟悉 Redis 缓存设计' },
    })

    expect(response.statusCode).toBe(200)
    expect(fake.requests.length).toBe(2)
    const payload = response.json() as { score: number; matched: string[] }
    expect(payload.score).toBe(72)
    expect(payload.matched).toContain('Redis')
  }, 30_000)

  it('generates interview questions as JSON and keeps only the requested types', async () => {
    await useFake([
      {
        content: JSON.stringify({
          questions: [
            {
              type: 'scenario',
              question: '订单量突增十倍，你会先查什么？',
              answer: '先看入口 QPS 与数据库连接数，再定位慢查询。',
              difficulty: 'medium',
            },
            {
              type: 'algorithm',
              question: '实现一个限流器',
              answer: '令牌桶，O(1) 取令牌，桶容量决定突发。',
              difficulty: 'hard',
            },
            {
              type: 'basic',
              question: 'TCP 三次握手为什么不是两次？',
              answer: '两次无法确认客户端接收能力，也无法防历史连接。',
              difficulty: 'easy',
            },
          ],
        }),
      },
    ])

    const response = await server.inject({
      method: 'POST',
      url: '/api/interview/questions',
      payload: {
        jd: '负责订单系统的后端开发，熟悉 Redis 与高并发',
        resume: '五年 Java 后端，做过订单系统与稳定性建设',
        types: ['scenario', 'algorithm'],
        count: 2,
      },
    })

    expect(response.statusCode).toBe(200)
    const payload = response.json() as { questions: Array<{ type: string; question: string }> }
    // 模型多给了一道基础题：按勾选题型过滤掉
    expect(payload.questions.map((item) => item.type)).toEqual(['scenario', 'algorithm'])
    expect(payload.questions[0]?.question).toContain('订单量')

    const body = fake.requests[0]?.body
    expect(body.format).toBe('json')
    expect(body.think).toBe(false)
    expect(body.options?.num_ctx).toBe(8192)
  }, 30_000)

  it('routes to DeepSeek when the user supplies an API key', async () => {
    const seen: Array<{ url?: string; auth?: string }> = []
    const fakeDeepSeek: Server = createServer((request, response) => {
      seen.push({ url: request.url, auth: request.headers.authorization })
      if (request.url === '/v1/models') {
        response.setHeader('content-type', 'application/json')
        response.end(
          JSON.stringify({ data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] }),
        )
        return
      }
      let raw = ''
      request.on('data', (chunk) => (raw += chunk))
      request.on('end', () => {
        const body = JSON.parse(raw) as { response_format?: { type?: string } }
        expect(body.response_format?.type).toBe('json_object')
        response.setHeader('content-type', 'application/json')
        response.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    questions: [
                      {
                        type: 'scenario',
                        question: '大促压测你会怎么设计？',
                        answer: '先定容量模型，再做全链路压测与限流演练。',
                        difficulty: 'medium',
                      },
                    ],
                  }),
                },
              },
            ],
          }),
        )
      })
    })
    await new Promise<void>((resolve) => fakeDeepSeek.listen(0, '127.0.0.1', () => resolve()))
    const { port: dsPort } = fakeDeepSeek.address() as AddressInfo
    process.env.DEEPSEEK_BASE_URL = `http://127.0.0.1:${dsPort}/v1`

    try {
      const providers = await server.inject({
        method: 'GET',
        url: '/api/ai/providers',
        headers: { 'x-ai-key': 'sk-test' },
      })
      expect(providers.statusCode).toBe(200)
      expect((providers.json() as { deepseek: { models: string[] } }).deepseek.models).toContain(
        'deepseek-chat',
      )

      const generate = await server.inject({
        method: 'POST',
        url: '/api/interview/questions',
        payload: {
          jd: '负责订单系统后端开发，熟悉高并发与压测',
          resume: '五年 Java 后端，做过大促保障与压测',
          types: ['scenario'],
          count: 1,
          provider: 'deepseek',
          apiKey: 'sk-test',
          model: 'deepseek-chat',
        },
      })
      expect(generate.statusCode).toBe(200)
      const payload = generate.json() as {
        questions: Array<{ question: string }>
        provider: string
      }
      expect(payload.provider).toBe('deepseek')
      expect(payload.questions[0]?.question).toContain('压测')
      // 密钥通过 Authorization 头下发，没有落进请求体
      expect(seen.some((item) => item.auth === 'Bearer sk-test')).toBe(true)
    } finally {
      delete process.env.DEEPSEEK_BASE_URL
      await new Promise<void>((resolve) => fakeDeepSeek.close(() => resolve()))
    }
  }, 30_000)

  it('writes a JD from a one-line role description', async () => {
    await useFake([
      {
        content:
          '岗位名称：Agent 工程师\n岗位职责：\n- 负责多 Agent 编排与工具调用链路设计\n任职要求：\n- 熟悉 Python 与主流大模型 API\n加分项：\n- 有 RAG 落地经验',
      },
    ])

    const response = await server.inject({
      method: 'POST',
      url: '/api/ai/jd/stream',
      payload: { role: 'Agent 工程师' },
    })

    expect(response.statusCode).toBe(200)
    const text = response.body
      .split('\n\n')
      .filter((block) => block.startsWith('data: '))
      .map((block) => JSON.parse(block.slice(6)) as { chunk?: string; done?: boolean })
      .map((event) => event.chunk ?? '')
      .join('')
    expect(text).toContain('岗位职责')
    expect(text).toContain('Agent')
    expect(response.body).toContain('"done":true')
  }, 30_000)

  it('returns resume rewrite suggestions for a JD', async () => {
    await useFake([
      {
        content: JSON.stringify({
          summary: '整体匹配度一般，重点补强「高并发」与「量化结果」。',
          edits: [
            {
              before: '负责订单系统的稳定性建设',
              after: '主导订单系统高并发改造，支撑大促峰值 10 万 QPS',
              reason: '命中 JD 的高并发要求，补上量化结果',
            },
            {
              before: '熟悉 Redis、MySQL',
              after: '熟练使用 Redis 缓存与 MySQL 索引优化',
              reason: '把「熟悉」换成能体现能力的动作',
            },
          ],
        }),
      },
    ])

    const response = await server.inject({
      method: 'POST',
      url: '/api/ai/optimize',
      payload: {
        jd: '负责高并发订单系统的后端开发，熟悉 Redis 与 MySQL',
        resume: '负责订单系统的稳定性建设。熟悉 Redis、MySQL。',
        provider: 'ollama',
      },
    })

    expect(response.statusCode).toBe(200)
    const payload = response.json() as {
      summary: string
      edits: Array<{ before: string; after: string; reason: string }>
    }
    expect(payload.summary).toContain('匹配度')
    expect(payload.edits).toHaveLength(2)
    expect(payload.edits[0]?.after).toContain('QPS')
  }, 30_000)

  it('streams one question per line as they are generated', async () => {
    await useFake([
      {
        content: [
          '{"type":"scenario","question":"大促流量突增你怎么排查？","answer":"先看入口 QPS 与连接数，再看慢查询。","difficulty":"medium"}',
          '{"type":"algorithm","question":"实现一个滑动窗口限流","answer":"按时间分桶计数，O(1) 判断。","difficulty":"hard"}',
        ].join('\n'),
      },
    ])

    const response = await server.inject({
      method: 'POST',
      url: '/api/interview/questions/stream',
      payload: {
        resume: '五年 Java 后端，做过订单系统与大促保障',
        types: ['scenario', 'algorithm'],
        count: 2,
      },
    })

    expect(response.statusCode).toBe(200)
    const events = response.body
      .split('\n\n')
      .filter((block) => block.startsWith('data: '))
      .map((block) => JSON.parse(block.slice(6)) as Record<string, unknown>)
    const questions = events.filter((event) => event.question)
    expect(questions).toHaveLength(2)
    expect((questions[0]?.question as { question: string }).question).toContain('大促')
    expect(events.some((event) => event.done === true)).toBe(true)
  }, 30_000)

  it('rewrite and JD match also run over DeepSeek', async () => {
    const fake: Server = createServer((request, response) => {
      let raw = ''
      request.on('data', (chunk) => (raw += chunk))
      request.on('end', () => {
        const body = JSON.parse(raw || '{}') as { response_format?: { type?: string } }
        const content = body.response_format
          ? JSON.stringify({
              score: 66,
              summary: '基本匹配',
              matched: ['Redis'],
              missing: [],
              suggestions: [],
            })
          : '- 负责订单系统稳定性建设'
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ choices: [{ message: { content } }] }))
      })
    })
    await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', () => resolve()))
    const { port } = fake.address() as AddressInfo
    process.env.DEEPSEEK_BASE_URL = `http://127.0.0.1:${port}/v1`

    try {
      const rewrite = await server.inject({
        method: 'POST',
        url: '/api/ai/rewrite/stream',
        payload: { text: '负责订单系统稳定性', provider: 'deepseek', apiKey: 'sk-test' },
      })
      expect(rewrite.statusCode).toBe(200)
      expect(rewrite.body).toContain('- 负责订单系统稳定性建设')

      const match = await server.inject({
        method: 'POST',
        url: '/api/ai/match',
        payload: {
          jd: '需要熟悉 Redis 的后端',
          resume: '熟悉 Redis',
          provider: 'deepseek',
          apiKey: 'sk-test',
        },
      })
      expect(match.statusCode).toBe(200)
      expect((match.json() as { score: number }).score).toBe(66)
    } finally {
      delete process.env.DEEPSEEK_BASE_URL
      await new Promise<void>((resolve) => fake.close(() => resolve()))
    }
  }, 30_000)

  it('retries once when DeepSeek returns empty content with reasoning', async () => {
    let chatCalls = 0
    const fake: Server = createServer((request, response) => {
      if (request.url === '/v1/models') {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ data: [{ id: 'deepseek-flash' }] }))
        return
      }
      let raw = ''
      request.on('data', (chunk) => (raw += chunk))
      request.on('end', () => {
        chatCalls += 1
        response.setHeader('content-type', 'application/json')
        if (chatCalls === 1) {
          // 第一次：content 为空，只有思考过程 → 应触发重试
          response.end(
            JSON.stringify({
              choices: [
                { message: { content: null, reasoning_content: 'thinking about the JD...' } },
              ],
            }),
          )
          return
        }
        response.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary: '整体匹配度一般，重点补强高并发与量化结果。',
                    edits: [
                      {
                        before: '负责订单系统',
                        after: '主导高并发改造，支撑 10 万 QPS',
                        reason: '量化结果',
                      },
                    ],
                  }),
                },
              },
            ],
          }),
        )
      })
    })
    await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', () => resolve()))
    const { port } = fake.address() as AddressInfo
    process.env.DEEPSEEK_BASE_URL = `http://127.0.0.1:${port}/v1`

    try {
      const response = await server.inject({
        method: 'POST',
        url: '/api/ai/optimize',
        payload: {
          jd: '负责高并发订单系统的后端开发，熟悉 Redis 与 MySQL',
          resume: '负责订单系统的稳定性建设与性能优化，支撑过大促保障。',
          provider: 'deepseek',
          apiKey: 'sk-test',
        },
      })
      expect(response.statusCode).toBe(200)
      const payload = response.json() as { edits: Array<{ after: string }> }
      expect(payload.edits[0]?.after).toContain('QPS')
      expect(chatCalls).toBe(2) // 空 content 自动重试一次
    } finally {
      delete process.env.DEEPSEEK_BASE_URL
      await new Promise<void>((resolve) => fake.close(() => resolve()))
    }
  }, 30_000)

  it('gives up on a stuck model instead of holding the queue forever', async () => {
    // 模型卡住（连接建立但永不返回）：必须有硬超时，否则队列槽位会被永久占住
    const hanging: Server = createServer((request, response) => {
      if (request.url === '/api/tags') {
        response.end(JSON.stringify({ models: [{ name: 'qwen3-8b' }] }))
      }
      // 其余请求故意不响应
    })
    await new Promise<void>((resolve) => hanging.listen(0, '127.0.0.1', () => resolve()))
    const { port } = hanging.address() as AddressInfo
    process.env.OLLAMA_URL = `http://127.0.0.1:${port}`
    process.env.OLLAMA_TIMEOUT_MS = '300'

    try {
      const response = await server.inject({
        method: 'POST',
        url: '/api/ai/rewrite/stream',
        payload: { text: '负责订单系统稳定性建设' },
      })
      expect(response.body).toContain('超时')
    } finally {
      delete process.env.OLLAMA_TIMEOUT_MS
      await new Promise<void>((resolve) => hanging.close(() => resolve()))
    }
  }, 30_000)
})
