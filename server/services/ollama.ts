/**
 * 本机 Ollama 的调用层。
 *
 * 之前两个 AI 路由各写一份 fetch，参数不一致：改写用 `/api/generate` + 温度 0.5 + 没设
 * `num_ctx`，JD 用 `/api/generate` + `format: 'json'`。结果就是同一台模型在两条链路上
 * 表现差很多。这里统一成 chat 端点（指令遵循更好），参数集中一份。
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  messages: ChatMessage[]
  /** 要求模型输出严格 JSON（Ollama 的 constrained decoding）。 */
  json?: boolean
  temperature?: number
  numPredict?: number
  numCtx?: number
  signal?: AbortSignal
  /** 单次调用指定模型（出题页的模型选择器用它覆盖默认模型）。 */
  model?: string
}

/** 本机 Ollama 服务的默认地址，可用 OLLAMA_URL 覆盖。 */
const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434'
/** 默认模型：按本机 12 GB 显存选的 8B 量化模型，可用 OLLAMA_MODEL 覆盖。 */
const DEFAULT_MODEL = 'qwen3-8b'

/** 上下文窗口：简历 + 岗位描述一次放得下，默认 2048 会把长简历悄悄截断。 */
export const DEFAULT_NUM_CTX = 8192
/** 生成上限：改写最多 3 条要点，1200 足够，也给 JSON 模式留余量。 */
export const DEFAULT_NUM_PREDICT = 1200

export const ollamaBaseUrl = (): string =>
  (process.env.OLLAMA_URL ?? DEFAULT_OLLAMA_URL).replace(/\/+$/, '')

export const ollamaModel = (): string => process.env.OLLAMA_MODEL ?? DEFAULT_MODEL

/** 模型不可用（没启动 / 没导入 / 显存不够）——调用方据此给不同的提示。 */
export class OllamaUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OllamaUnavailableError'
  }
}

const buildBody = (options: ChatOptions, stream: boolean) => ({
  model: options.model ?? ollamaModel(),
  messages: options.messages,
  stream,
  // qwen3 会先输出思考过程；关掉，否则改写结果里会混进一大段推理
  think: false,
  ...(options.json ? { format: 'json' } : {}),
  // 避免每次调用都重新加载模型（首字延迟从 3-5 秒降到 1 秒内）
  keep_alive: '5m',
  options: {
    temperature: options.temperature ?? 0.3,
    top_p: 0.9,
    repeat_penalty: 1.05,
    num_ctx: options.numCtx ?? DEFAULT_NUM_CTX,
    num_predict: options.numPredict ?? DEFAULT_NUM_PREDICT,
  },
})

const postChat = async (options: ChatOptions, stream: boolean): Promise<Response> => {
  try {
    return await fetch(`${ollamaBaseUrl()}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildBody(options, stream)),
      signal: options.signal,
    })
  } catch (error) {
    // 连接被拒 / DNS 失败都归到这里：和「模型返回了空内容」要给不同的提示
    throw new OllamaUnavailableError(
      `连不上本机 Ollama（${ollamaBaseUrl()}）：${error instanceof Error ? error.message : error}`,
    )
  }
}

/** 一次性调用，返回模型输出的文本。 */
export const chatOnce = async (options: ChatOptions): Promise<string> => {
  const response = await postChat(options, false)
  if (!response.ok) throw new Error(`ollama responded ${response.status}`)
  const payload = (await response.json()) as { message?: { content?: string } }
  return payload.message?.content ?? ''
}

/** 流式调用：逐段吐出增量文本。 */
export async function* streamChat(options: ChatOptions): AsyncGenerator<string> {
  const response = await postChat(options, true)
  if (!response.ok || !response.body) throw new Error(`ollama responded ${response.status}`)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf('\n')
      if (!line) continue
      try {
        const chunk = JSON.parse(line) as { message?: { content?: string } }
        const delta = chunk.message?.content
        if (delta) yield delta
      } catch {
        // Ollama 偶发半行 JSON，跳过，下次 read 会补齐
      }
    }
  }
}

/**
 * 去掉模型可能漏出来的思考块。
 *
 * 即使请求了 `think: false`，老版本 Ollama 不认识这个字段，qwen3 仍会输出
 * ` thinking…`；不同版本的结束标记也不一样（`</think>`、`<｜end▁of▁thinking｜>`），
 * 所以按「找开标记 → 找最近的闭标记」逐段剥，未闭合时把整段尾巴丢掉。
 */
const THINK_OPEN = /<think(?:ing)?\b[^>]*>/i
const THINK_CLOSE = /<\/think(?:ing)?>|<｜end[▁_]of[▁_]thinking｜>/i

export const stripThinking = (text: string): string => {
  let out = text
  for (let guard = 0; guard < 5; guard += 1) {
    const open = out.search(THINK_OPEN)
    if (open < 0) break
    const rest = out.slice(open)
    const close = rest.match(THINK_CLOSE)
    if (!close || close.index === undefined) {
      out = out.slice(0, open)
      break
    }
    out = out.slice(0, open) + rest.slice(close.index + close[0].length)
  }
  return out
}

const PREAMBLE = /^(好的|当然|以下是|下面是|这是|改写结果|改写如下|结果如下|根据|已按照|为您)/

/** 把 `1.` `1、` `•` `*` 统一成简历常用的 `- `。 */
const normalizeBullet = (line: string): string =>
  line.replace(/^\s*(?:[-–—*•]|\d+[.、)）])\s*/, '').trim()

const isMeta = (line: string): boolean =>
  /^(（?共|总计|说明|注[:：]|以上)/.test(line) || /希望(对你)?有帮助|如需|可以再告诉我/.test(line)

/**
 * 清洗改写结果：去思考块、去开场白/结尾客套、统一要点符号、限制条数。
 *
 * 8B 模型会稳定地违反「只输出结果」这条规则，纯靠提示词压不住，
 * 所以必须有一层确定性的后处理。
 */
export const cleanRewrite = (raw: string, maxBullets = 3): string => {
  const text = stripThinking(raw)
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  while (lines.length > 0 && PREAMBLE.test(lines[0] ?? '') && !/^[-–—*•]/.test(lines[0] ?? '')) {
    lines.shift()
  }

  const bullets = lines
    .filter((line) => !isMeta(line))
    .map(normalizeBullet)
    .filter((line) => line.length > 0)
    .slice(0, maxBullets)

  return bullets.map((line) => `- ${line}`).join('\n')
}

/**
 * 流式改写的前缀闸门。
 *
 * 模型可能先吐「好的，以下是改写结果：」再吐正文；如果直接转发，用户会看到这段废话。
 * 所以先攒一小段（见到换行或攒够 200 字），清洗后一次性放行，之后按原样转发。
 * 结尾再用 {@link cleanRewrite} 对全文做一次纠正。
 */
export const createRewriteStreamFilter = (): {
  push: (delta: string) => string
  peek: () => string
} => {
  let buffer = ''
  let released = false
  return {
    push(delta: string): string {
      if (released) {
        buffer += delta
        return delta
      }
      buffer += delta
      if (buffer.length < 200 && !buffer.includes('\n')) return ''
      released = true
      const cleaned = cleanRewrite(buffer)
      return cleaned ? `${cleaned}\n` : ''
    },
    peek: (): string => buffer,
  }
}
