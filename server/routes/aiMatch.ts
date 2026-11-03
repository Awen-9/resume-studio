import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { withAiSlot } from '../shared/aiLimiter.js'
import { formatIssues } from '../shared/schemas.js'
import { chatLlm, ProviderError } from '../services/llm.js'
import { friendlyAiError } from '../services/aiStable.js'
import { ollamaBaseUrl, ollamaModel } from '../services/ollama.js'

const resolveOllamaUrl = ollamaBaseUrl
const resolveModel = ollamaModel

/**
 * 体检的系统提示词：只讲输出契约，具体任务在用户消息里。
 * 之前所有规则都塞在一条 prompt 里，模型经常把「分析」写进 JSON 的字符串字段。
 */
const MATCH_SYSTEM_PROMPT = [
  '你是招聘方的简历筛选助手，只输出 JSON，不输出任何解释性文字。',
  '所有中文文本字段只写结论，不要写「根据分析」「综上所述」这类过程话术。',
  '不确定的信息宁可留空，不要编造简历里没有的经历或数字。',
].join('\n')

/**
 * 岗位匹配体检。
 *
 * 简历的说服力依赖具体岗位，而此前的「导出前检查」只覆盖空值和分页这类合格线问题。
 * 这里把 JD 和简历正文一起交给本机模型，要求它按严格 JSON 返回匹配度、命中的关键词、
 * 缺失的能力与可执行建议。
 *
 * 之所以让模型直接出 JSON（Ollama 的 `format: 'json'`）而不是流式文本：
 * 结果要做成结构化面板，解析失败的兜底比“边流边渲染”更重要。
 */

const MATCH_TIMEOUT_MS = 120_000
/** 深度模式要逐词核对，8B 模型在 CPU 上可能跑到 3-4 分钟。 */
const DEEP_TIMEOUT_MS = 240_000
/**
 * 上下文窗口。留出余量是因为 JD 可能很长（上限 6000 字），而简历最多 9000 字；
 * 实测一份完整简历 + 标准 JD 只用到约 3900 token，8192 其实够用，但这里给足余量，
 * 避免用户贴长 JD 时被动截断。
 */

/** 上游被取消时 fetch 抛 AbortError，按「用户取消」处理而不是「模型坏了」。 */
const controllerAborted = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError'
/** 单次送进去的简历正文上限；超过就截断，并在结果里说明。 */
const RESUME_CHAR_LIMIT = 9_000

const requestSchema = z.object({
  jd: z.string().min(10).max(6_000),
  resume: z.string().min(1).max(12_000),
  /** fast：一次生成，约 10 秒；deep：逐词核对原文并给依据，约 30-60 秒。 */
  mode: z.enum(['fast', 'deep']).default('fast'),
  provider: z.enum(['ollama', 'deepseek']).default('ollama'),
  apiKey: z.string().max(200).optional(),
  model: z.string().max(120).optional(),
})

const resultSchema = z.object({
  score: z.coerce.number().min(0).max(100),
  summary: z.string().max(400).default(''),
  matched: z.array(z.string().max(40)).max(20).default([]),
  missing: z.array(z.string().max(40)).max(20).default([]),
  suggestions: z
    .array(
      z.object({
        title: z.string().max(80),
        detail: z.string().max(400),
      }),
    )
    .max(10)
    .default([]),
})

const buildPrompt = (jd: string, resume: string): string =>
  [
    '你是资深技术招聘官，正在评估一份简历与岗位描述的匹配度。',
    '只输出一个 JSON 对象，不要 markdown、不要解释，字段如下：',
    '{',
    '  "score": 0-100 的整数,',
    '  "summary": "一句话总体判断，40 字以内",',
    '  "matched": ["简历里已经命中的岗位关键词或能力，最多 8 个"],',
    '  "missing": ["岗位要求但简历里没体现的关键词或能力，最多 8 个"],',
    '  "suggestions": [{ "title": "建议标题，20 字内", "detail": "具体怎么改，80 字内" }]',
    '}',
    '规则：',
    '1) 逐个核对岗位描述里的技术名词（框架、协议、中间件、方法论、协作模式），',
    '   简历中出现同名或同义表述即算命中；例如简历写「多 Agent 架构」、岗位写「多 Agent 协作」，应算命中；',
    '2) missing 只列简历确实没有体现的能力，不要把「表述不同」当成缺失；',
    '3) matched / missing 里的词尽量沿用岗位描述的原词，便于用户对照；',
    '4) 只依据给出的简历内容判断，不要臆造经历；score 要克制，缺少关键要求时不要给高分。',
    '',
    '【岗位描述】',
    jd,
    '',
    '【简历正文】',
    resume,
  ].join('\n')

/**
 * 关键词的确定性校验。
 *
 * 实测 8B 模型会漏看简历里明明写着的词（MCP、Kafka、多 Agent 协作都被判成"缺失"），
 * 而且同一输入多次运行结果不稳定。这里对模型给出的 missing 逐条回查原文：
 * 原文能搜到的词改判为命中，模型只负责它擅长的部分（打分、总结、建议）。
 */
const normalizeTerm = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[\s\-_·/、，,。;；:：（）()【】[\]"'“”]/g, '')

/**
 * 判断一个词是否真的出现在简历里。
 *
 * - 含中文的词（「多 Agent 协作」）：去掉空格和标点后做子串匹配；
 * - 纯英文/数字的词（Go、MCP、Redis）：必须按词边界匹配，
 *   否则 `Go` 会命中 `github`、`RAG` 会命中 `storage`，造成"已具备"的假阳性。
 */
const termAppearsIn = (term: string, rawLower: string, compact: string): boolean => {
  const hasCjk = /[\u4e00-\u9fa5]/.test(term)
  if (hasCjk) {
    const needle = normalizeTerm(term)
    return needle.length >= 2 && compact.includes(needle)
  }
  const escaped = term
    .toLowerCase()
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/[\s-]+/g, '[\\s-]?')
  if (!escaped) return false
  try {
    return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(rawLower)
  } catch {
    return rawLower.includes(escaped)
  }
}

export const reconcileTerms = <T extends { matched: string[]; missing: string[] }>(
  result: T,
  resume: string,
): T => {
  const rawLower = resume.toLowerCase()
  const compact = normalizeTerm(resume)
  const matched = [...result.matched]
  const seen = new Set(matched.map(normalizeTerm))
  const missing: string[] = []

  for (const term of result.missing) {
    const needle = normalizeTerm(term)
    // 太短的词容易误命中，交给模型判断
    if (needle.length >= 2 && termAppearsIn(term, rawLower, compact)) {
      if (!seen.has(needle)) {
        matched.push(term)
        seen.add(needle)
      }
      continue
    }
    missing.push(term)
  }

  return { ...result, matched, missing }
}

/**
 * 建议不能和"已具备"打架。
 *
 * 实测会输出「提及参与的开源项目或技术博客」这种建议，而「开源项目」「技术博客」
 * 同时被列在已具备里——用户看到只会觉得系统没读自己的简历。
 * 这里把建议文本里提到已命中的词条过滤掉；全被过滤时给一条不矛盾的通用建议。
 */
export const dropContradictingSuggestions = <
  T extends {
    matched: string[]
    missing?: string[]
    suggestions: { title: string; detail: string }[]
  },
>(
  result: T,
  resume = '',
  jd = '',
): T => {
  const matchedTerms = result.matched.map(normalizeTerm).filter((term) => term.length >= 2)
  const askToAdd = /补充|增加|添加|缺少|缺失|提及|展示|体现|强调/

  // 建议里提到的技术词，只要「JD 要求」且「简历里确实有」，这条建议就是无效的
  const resumeLower = resume.toLowerCase()
  const resumeCompact = normalizeTerm(resume)
  const jdLower = jd.toLowerCase()

  const kept = result.suggestions.filter((suggestion) => {
    const raw = `${suggestion.title} ${suggestion.detail}`
    if (!askToAdd.test(raw)) return true

    const text = normalizeTerm(raw)
    if (matchedTerms.some((term) => text.includes(term))) return false

    const tokens = raw.match(/[A-Za-z][A-Za-z0-9+#.]*(?:[-\s][A-Za-z][A-Za-z0-9+#.]*)*/g) ?? []
    return !tokens.some((token) => {
      const cleaned = token.trim()
      if (cleaned.length < 3 || STOP_WORDS.has(cleaned.toLowerCase())) return false
      const inJd = jdLower.includes(cleaned.toLowerCase())
      const inResume = termAppearsIn(cleaned, resumeLower, resumeCompact)
      return inJd && inResume
    })
  })
  if (kept.length > 0) return { ...result, suggestions: kept }

  // 建议全被过滤时，用已经确定的事实拼出可执行的建议，而不是一句套话：
  // 缺什么就补什么；什么都不缺就按命中项给出排序建议。
  const missingTerms = (result.missing ?? []).filter((term) => term.trim().length > 0)
  const fallback: { title: string; detail: string }[] = []
  for (const term of missingTerms.slice(0, 2)) {
    fallback.push({
      title: `补上 ${term}`,
      detail: `简历里没有体现「${term}」，可以在最相关的项目里补一两句具体做法。`,
    })
  }
  if (fallback.length < 2 && result.matched.length > 0) {
    // 优先挑具体的技术词作为"摆放建议"的抓手，`A4`、`Agent` 这种太宽泛的不算
    const specific = result.matched.filter((term) => term.length >= 5).slice(0, 3)
    const focus = (specific.length > 0 ? specific : result.matched.slice(0, 3)).join('、')
    fallback.push({
      title: '把最匹配的经历往前排',
      detail: `涉及 ${focus} 的项目建议放在项目经历第一条，招聘方先看到的应该是它。`,
    })
  }
  return {
    ...result,
    suggestions:
      fallback.length > 0
        ? fallback
        : [
            {
              title: '岗位要求已基本覆盖',
              detail: '关键能力在简历里都有体现，可以针对岗位再收紧措辞。',
            },
          ],
  }
}

/** 从简历里找出包含某个词的那一行，作为「依据」展示。 */
const findEvidence = (term: string, resume: string): string => {
  const normTerm = normalizeTerm(term)
  if (normTerm.length < 2) return ''
  // 按行 + 句号切分后取包含该词的最短片段：整段正文当「依据」没有说服力
  const hits = resume
    .split(/[\r\n]|(?<=[。；;])/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && normalizeTerm(line).includes(normTerm))
    .sort((left, right) => left.length - right.length)
  const best = hits[0]
  if (!best) return ''
  return best.length > 80 ? `${best.slice(0, 80)}…` : best
}

/** 模型给的 evidence 必须真的包含这个词，否则视为编造，改用本地检索到的行。 */
const sanitizeEvidence = (term: string, quoted: string, resume: string): string => {
  const needle = normalizeTerm(term)
  if (quoted && needle.length >= 2 && normalizeTerm(quoted).includes(needle)) {
    return quoted.length > 120 ? `${quoted.slice(0, 120)}…` : quoted
  }
  return findEvidence(term, resume)
}

/** JD 里不该被当成技术要求的高频词。 */
const STOP_WORDS = new Set([
  'and',
  'the',
  'for',
  'with',
  'you',
  'are',
  'our',
  'will',
  'team',
  'java',
  'ai',
])

/**
 * 从 JD 里抽出需要逐条核对的技术名词。
 *
 * 深度模式不再让模型"凭记忆列清单"，而是先确定性地列出候选词，再让它逐个判断
 * 是否具备并给出原文依据——这样每一条结论都可核对，也更容易发现漏判。
 */
export const extractKeywords = (jd: string): string[] => {
  // 连字符复合词要整体保留（Plan-and-Execute、Human-in-the-Loop），否则会被拆成碎片
  const latin = jd.match(/[A-Za-z][A-Za-z0-9+#.]*(?:[-\s][A-Za-z][A-Za-z0-9+#.]*)*/g) ?? []
  // 小标题不是技术要求（「任职要求：」「加分项」），抽出来只会污染核对列表
  const headingPattern = /^(岗位职责|任职要求|岗位描述|加分项|工作职责|职位要求|我们希望|优先条件)/
  const cjkSegments = jd
    .split(/[、，,；;。\n]/)
    .map((part) =>
      part
        .replace(/^[\s\d.、)）]+/, '')
        .replace(/[:：]\s*$/, '')
        .trim(),
    )
    // 「熟悉 Redis」这种带动词的短语，只留技术名词本身
    .map((part) => part.replace(/^(熟悉|精通|了解|掌握|具备|负责|使用|会用|有)/, '').trim())
    .filter((part) => /[\u4e00-\u9fa5]/.test(part) && part.length >= 3 && part.length <= 14)
    .filter((part) => !headingPattern.test(part))

  const seen = new Set<string>()
  const result: string[] = []
  const push = (term: string): void => {
    const key = normalizeTerm(term)
    if (key.length < 2 || seen.has(key) || result.length >= 24) return
    seen.add(key)
    result.push(term)
  }

  for (const token of latin) {
    const cleaned = token.trim()
    if (cleaned.length < 2 || cleaned.length > 20) continue
    if (STOP_WORDS.has(cleaned.toLowerCase())) continue
    push(cleaned)
  }
  for (const segment of cjkSegments) push(segment)

  // 「AI Agent」和「Agent」同时出现时只留长的，避免同一个能力重复出现在两块列表里
  return result.filter(
    (term, index) =>
      !result.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          other.length > term.length &&
          normalizeTerm(other).includes(normalizeTerm(term)),
      ),
  )
}

const deepResultSchema = resultSchema.extend({
  verdicts: z
    .array(
      z.object({
        term: z.string().max(40),
        present: z.boolean(),
        evidence: z.string().max(200).default(''),
      }),
    )
    .max(30)
    .default([]),
})

const buildDeepPrompt = (jd: string, resume: string, keywords: string[]): string =>
  [
    '你是资深技术招聘官。逐个核对下列关键词是否在简历中体现。',
    '只输出一个 JSON 对象，不要 markdown、不要解释：',
    '{',
    '  "verdicts": [{ "term": "关键词", "present": true/false, "evidence": "简历里的原句，没有就留空" }],',
    '  "score": 0-100 的整数,',
    '  "summary": "一句话总体判断，40 字以内",',
    '  "suggestions": [{ "title": "建议标题，20 字内", "detail": "具体怎么改，80 字内" }]',
    '}',
    '规则：',
    '1) 必须覆盖下面列出的每一个关键词，顺序保持一致；',
    '2) presence 为 true 时，evidence 必须是从简历里逐字摘录的句子，不许改写；',
    '3) 语义等价也算命中，例如「会话持久化」可以支撑「会话管理」，此时 evidence 写原句；',
    '4) 拿不准时判 false，不要臆造；',
    '5) suggestions 只针对确实缺失或可强化的点，不要建议补充已具备的内容。',
    '',
    '【待核对关键词】',
    keywords.map((keyword, index) => `${index + 1}. ${keyword}`).join('\n'),
    '',
    '【岗位描述】',
    jd,
    '',
    '【简历正文】',
    resume,
  ].join('\n')

/** 模型偶尔会用 ```json 包裹，这里做一次容错提取。 */ const extractJson = (
  text: string,
): unknown => {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced?.[1]?.trim() ?? trimmed
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('模型没有返回 JSON')
  return JSON.parse(candidate.slice(start, end + 1))
}

export const registerAiMatchRoute = (server: FastifyInstance): void => {
  server.post('/api/ai/match', async (request, reply) => {
    const parsed = requestSchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      return reply.code(400).send({
        message: '请提供岗位描述（至少 10 字）',
        details: formatIssues(parsed.error.issues),
      })
    }

    const { mode } = parsed.data
    const jd = parsed.data.jd
    const resume = parsed.data.resume.slice(0, RESUME_CHAR_LIMIT)

    try {
      // 排队拿到模型槽位后再开始计时：排队时间不该算进「模型超时」
      return await withAiSlot(async () => {
        const controller = new AbortController()
        const timeoutMs = mode === 'deep' ? DEEP_TIMEOUT_MS : MATCH_TIMEOUT_MS
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        // 用户关掉对话框 / 取消时，客户端断开连接，这里要真的掐掉上游生成
        const abortOnClose = (): void => {
          if (!reply.raw.writableEnded) controller.abort()
        }
        reply.raw.on('close', abortOnClose)

        const callModel = async (prompt: string, numPredict: number): Promise<unknown> => {
          const ask = async (content: string): Promise<string> =>
            chatLlm({
              provider: parsed.data.provider,
              apiKey: parsed.data.apiKey,
              model: parsed.data.model,
              messages: [
                { role: 'system', content: MATCH_SYSTEM_PROMPT },
                { role: 'user', content },
              ],
              json: true,
              temperature: 0.1,
              maxTokens: numPredict,
              signal: controller.signal,
            })

          const text = await ask(prompt)
          try {
            return extractJson(text)
          } catch {
            // 8B 模型偶尔吐半截 JSON：明确让它重来一次，比直接报错体验好
            const retry = await ask(
              `${prompt}\n\n上次的输出不是合法 JSON。请只输出一个 JSON 对象，不要代码块标记，不要任何说明文字。`,
            )
            return extractJson(retry)
          }
        }

        try {
          if (mode === 'fast') {
            const raw = await callModel(buildPrompt(jd, resume), 700)
            const result = resultSchema.safeParse(raw)
            if (!result.success) throw new Error('模型返回的 JSON 字段不符合约定')
            const reconciled = dropContradictingSuggestions(
              reconcileTerms(result.data, resume),
              resume,
              jd,
            )
            const evidence: Record<string, string> = {}
            for (const term of reconciled.matched) {
              const line = findEvidence(term, resume)
              if (line) evidence[term] = line
            }
            return { model: resolveModel(), mode, ...reconciled, evidence }
          }

          // 深度模式：先确定性地抽出候选关键词，再让模型逐条判断并给出原文依据
          const keywords = extractKeywords(jd)
          const raw = await callModel(buildDeepPrompt(jd, resume, keywords), 1_400)
          const result = deepResultSchema.safeParse(raw)
          if (!result.success) throw new Error('模型返回的 JSON 字段不符合约定')

          const rawLower = resume.toLowerCase()
          const compact = normalizeTerm(resume)
          const matched: string[] = []
          const missing: string[] = []
          const evidence: Record<string, string> = {}

          for (const keyword of keywords) {
            const verdict = result.data.verdicts.find(
              (item) => normalizeTerm(item.term) === normalizeTerm(keyword),
            )
            // 模型说没有，但原文里能搜到，就按「有」处理（8B 模型会漏看）
            const present = verdict?.present === true || termAppearsIn(keyword, rawLower, compact)
            if (present) {
              matched.push(keyword)
              const quoted = verdict?.present ? verdict.evidence.trim() : ''
              const line = sanitizeEvidence(keyword, quoted, resume)
              if (line) evidence[keyword] = line
            } else {
              missing.push(keyword)
            }
          }

          const merged = dropContradictingSuggestions(
            { matched, missing, suggestions: result.data.suggestions },
            resume,
            jd,
          )

          return {
            model: resolveModel(),
            mode,
            score: result.data.score,
            summary: result.data.summary,
            ...merged,
            evidence,
          }
        } finally {
          clearTimeout(timer)
          reply.raw.off('close', abortOnClose)
        }
      })
    } catch (error) {
      if (controllerAborted(error)) {
        // 用户主动取消：不要伪装成「模型不可用」
        return reply.code(499).send({ message: '已取消评估' })
      }
      if (error instanceof ProviderError) {
        return reply.code(error.status).send({ message: friendlyAiError(error) })
      }
      request.log.error(error)
      return reply.code(502).send({
        message: `体检失败：请确认本机 Ollama 正在运行（${resolveOllamaUrl()}），且已导入模型 ${resolveModel()}`,
      })
    }
  })
}
