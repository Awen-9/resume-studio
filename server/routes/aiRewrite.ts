import type { FastifyInstance } from 'fastify'
import { withAiSlot } from '../shared/aiLimiter.js'
import { aiRewriteRequestSchema } from '../shared/schemas.js'
import { chatLlm, ProviderError } from '../services/llm.js'
import {
  chatOnce,
  cleanRewrite,
  createRewriteStreamFilter,
  OllamaUnavailableError,
  ollamaBaseUrl,
  ollamaModel,
  streamChat,
} from '../services/ollama.js'

interface OllamaTagsResponse {
  models?: Array<{ name?: string }>
}

/** 状态探测要快：Ollama 没起来时不要在按钮上加一个 30 秒的加载态。 */
const STATUS_TIMEOUT_MS = 3000

/**
 * 系统提示词。
 *
 * 经验：8B 模型对小而具体的规则执行得比「你是资深顾问」这类角色设定好得多，
 * 所以这里把「输出格式」放在最前、给一个对比示例，并显式禁止几种常见跑偏
 * （加开场白、编数字、用序号）。
 */
const SYSTEM_PROMPT = [
  '你在改写中文简历里的一段描述，只做改写，不做扩写、不编造事实。',
  '',
  '输出格式（严格遵守）：',
  '1. 每行一条，以「- 」开头，不要用数字序号；',
  '2. 最多 3 条；原文只有一句话且信息量少时只输出 1 条；',
  '3. 只输出要点本身，不要标题、开场白、解释或总结。',
  '',
  '改写要求：',
  '- 以动词开头（负责 / 设计 / 推动 / 优化 / 落地），不写「我」「本人」；',
  '- 一条只讲一件事，不超过 35 个汉字；',
  '- 数字、公司名、项目名、时间必须和原文一致；原文没有的数字绝不添加；',
  '- 原文是「标签：内容」结构时保留标签；',
  '- 语言客观，不堆形容词。',
  '',
  '示例：',
  '原文：负责公司官网改版，页面加载速度变快，用户投诉减少',
  '输出：',
  '- 负责公司官网改版，首屏加载时间缩短',
  '- 优化页面资源加载，用户投诉下降',
].join('\n')

const buildMessages = (text: string, instruction?: string) => {
  const user = [`原文：`, text]
  if (instruction?.trim())
    user.push('', `额外要求：${instruction.trim()}（不能违反上面的输出格式）`)
  // qwen3 用这个标记关闭思考链；不支持的模型会把它当普通文字，无副作用
  user.push('', '/no_think')
  return [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: user.join('\n') },
  ]
}

export const registerAiRewriteRoute = (server: FastifyInstance): void => {
  // 前端用它决定是否启用按钮：Ollama 没起来时不要把报错留到点击之后。
  server.get('/api/ai/status', async () => {
    const model = ollamaModel()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS)
    try {
      const response = await fetch(`${ollamaBaseUrl()}/api/tags`, { signal: controller.signal })
      if (!response.ok) throw new Error(`ollama status ${response.status}`)
      const payload = (await response.json()) as OllamaTagsResponse
      const models = (payload.models ?? [])
        .map((item) => item.name ?? '')
        .filter((name) => name.length > 0)
      const available = models.some((name) => name === model || name.startsWith(`${model}:`))
      return { available, model, models }
    } catch {
      return { available: false, model, models: [] as string[] }
    } finally {
      clearTimeout(timer)
    }
  })

  /**
   * 流式改写（SSE）。
   *
   * 8B 模型首字延迟 1-4 秒、整段 10 秒以上，非流式会让界面停在「改写中…」。
   * 事件：
   *   data: {"chunk":"..."}  → 增量文本（已过滤掉思考块和开场白）
   *   data: {"done":true,"final":"..."} → 结束，final 是清洗后的完整结果，前端以它为准
   *   data: {"error":"..."}  → 失败
   */
  server.post('/api/ai/rewrite/stream', async (request, reply) => {
    const parsed = aiRewriteRequestSchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      return reply.code(400).send({ message: '没有可改写的内容' })
    }
    const text = parsed.data.text.trim()
    if (!text) return reply.code(400).send({ message: '没有可改写的内容' })

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

    const controller = new AbortController()
    // 硬超时：模型卡死时客户端不一定断开（标签页还开着），队列槽位不能被一直占着
    let timedOut = false
    const configuredTimeout = Number(process.env.OLLAMA_TIMEOUT_MS ?? 120_000)
    const timeoutMs =
      Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 120_000
    const timeoutTimer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    // 注意要监听响应对象的 close：请求体解析完成后请求流就会关闭，
    // 绑在 request 上会立刻把上游生成掐断（表现为 9ms 就返回「模型不可用」）。
    raw.on('close', () => {
      if (!raw.writableEnded) controller.abort()
    })

    const messages = buildMessages(text, parsed.data.instruction)

    // DeepSeek 走非流式：整段返回后再一次性推给前端。
    // 少一点打字机效果，但换来一套后端，不必再维护第二条 SSE 解析链路。
    const deepseekKey = parsed.data.apiKey?.trim()
    if (parsed.data.provider === 'deepseek' && deepseekKey) {
      try {
        await withAiSlot(async () => {
          const raw = await chatLlm({
            provider: 'deepseek',
            apiKey: deepseekKey,
            model: parsed.data.model,
            messages,
            temperature: 0.3,
            maxTokens: 600,
            signal: controller.signal,
          })
          const final = cleanRewrite(raw)
          if (!final) throw new Error('模型返回了空内容')
          send({ chunk: final })
          send({ done: true, final, model: parsed.data.model ?? 'deepseek-chat' })
        })
      } catch (error) {
        if (!controller.signal.aborted) {
          send({
            error: error instanceof ProviderError ? error.message : 'DeepSeek 改写失败，请稍后重试',
          })
        }
      } finally {
        clearTimeout(timeoutTimer)
        raw.end()
      }
      return
    }

    try {
      // 与 JD 体检共用一条模型队列：单卡同时跑两个请求只会一起变慢
      await withAiSlot(async () => {
        const filter = createRewriteStreamFilter()
        let collected = ''
        let emitted = false

        for await (const delta of streamChat({
          messages,
          temperature: 0.3,
          numPredict: 600,
          signal: controller.signal,
        })) {
          collected += delta
          const safe = filter.push(delta)
          if (safe.trim()) emitted = true
          if (safe) send({ chunk: safe })
        }

        let final = cleanRewrite(collected)
        // 流里一个字都没吐出来（例如模型只回了思考/客套）：补一次非流式调用，
        // 把「重来」说清楚，通常第二次就正常。
        if (!final) {
          const retry = await chatOnce({
            messages: [
              ...messages,
              { role: 'assistant', content: collected || '（空）' },
              {
                role: 'user',
                content:
                  '上面的输出不合格：没有可用的要点。请严格按格式只输出以「- 」开头的 1-3 行。',
              },
            ],
            temperature: 0.2,
            numPredict: 400,
            signal: controller.signal,
          })
          final = cleanRewrite(retry)
          if (final && !emitted) send({ chunk: `${final}\n` })
        }

        if (!final) throw new Error('模型返回了空内容')
        send({ done: true, final, model: ollamaModel() })
      })
    } catch (error) {
      // 客户端主动断开：没人接了，不用回包
      if (controller.signal.aborted && !timedOut) return
      request.log.error(error)
      send({
        error: timedOut
          ? '模型响应超时，已中断本次改写，请重试'
          : error instanceof OllamaUnavailableError
            ? '连不上本机 Ollama，请确认它正在运行（默认 127.0.0.1:11434）'
            : error instanceof Error && error.message === '模型返回了空内容'
              ? '模型没有给出可用的改写结果，请重试或换一段更完整的内容'
              : '本地模型调用失败，请稍后重试',
      })
    } finally {
      clearTimeout(timeoutTimer)
      raw.end()
    }
  })
}
