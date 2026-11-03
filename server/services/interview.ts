import { z } from 'zod'
import { chatLlm, type ProviderId } from './llm.js'
import { streamChat } from './ollama.js'
import { buildStreamSystemPrompt, buildSystemPrompt } from './interviewPrompts.js'
import type { PromptProfileId } from './interviewProfiles.js'

/** 题型：面试官最常用的五类，顺序也是出题优先级。 */
export const QUESTION_TYPES = ['scenario', 'fundamental', 'basic', 'algorithm', 'project'] as const
export type QuestionType = (typeof QUESTION_TYPES)[number]

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  scenario: '场景题',
  fundamental: '八股文',
  basic: '基础知识',
  algorithm: '算法',
  project: '项目深挖',
}

export const questionSchema = z.object({
  type: z.enum(QUESTION_TYPES),
  question: z.string().min(6).max(400),
  answer: z.string().min(8).max(1600),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
})

export const questionBatchSchema = z.object({
  questions: z.array(questionSchema).min(1).max(20),
})

export type InterviewQuestion = z.infer<typeof questionSchema>

const buildUserPrompt = (input: {
  jd: string
  resume: string
  types: QuestionType[]
  count: number
}): string => {
  const typeList = input.types.map((type) => `${type}（${QUESTION_TYPE_LABELS[type]}）`).join('、')
  const hasJd = input.jd.trim().length > 0
  // 推理模型会「逐字思考」输入：超长 JD/简历会让 reasoning 爆炸到耗尽输出预算、
  // 结果 content 返回空。截断到足够出题的长度即可，不必全文喂进去。
  const jd = input.jd.trim().slice(0, 800)
  const resume = input.resume.trim().slice(0, 4000)
  return [
    ...(hasJd ? ['岗位描述：', jd, ''] : []),
    '候选人简历：',
    resume,
    '',
    hasJd
      ? `请出 ${input.count} 道题，题型在以下范围内分配：${typeList}。`
      : `没有提供岗位描述。请只根据简历里的技术栈、项目经历和职责，出 ${input.count} 道题，题型在以下范围内分配：${typeList}。`,
    '各题型数量尽量均衡，总数必须等于要求数量。',
  ].join('\n')
}

/**
 * 出题。
 *
 * 和改写共用同一个 Ollama 客户端（chat + json 模式 + 关思考），
 * 但温度更高：出题需要联想，跟改写「不许发挥」是相反的要求。
 */
export const generateInterviewQuestions = async (input: {
  /** 没有 JD 时为空字符串：按简历本身出题。 */
  jd: string
  resume: string
  types: QuestionType[]
  count: number
  signal?: AbortSignal
  model?: string
  provider?: ProviderId
  apiKey?: string
  profile?: PromptProfileId
}): Promise<{ questions: InterviewQuestion[]; model: string }> => {
  const ask = async (prompt: string, temperature: number): Promise<string> =>
    chatLlm({
      provider: input.provider ?? 'ollama',
      apiKey: input.apiKey,
      messages: [
        { role: 'system', content: buildSystemPrompt(input.types, input.profile) },
        { role: 'user', content: prompt },
      ],
      json: true,
      temperature,
      maxTokens: 32000,
      signal: input.signal,
      model: input.model,
    })

  const prompt = buildUserPrompt(input)
  let raw = await ask(prompt, 0.7)

  const parse = (text: string): InterviewQuestion[] | null => {
    try {
      const start = text.indexOf('{')
      const end = text.lastIndexOf('}')
      if (start < 0 || end <= start) return null
      const parsed = questionBatchSchema.safeParse(JSON.parse(text.slice(start, end + 1)))
      return parsed.success ? parsed.data.questions : null
    } catch {
      return null
    }
  }

  let questions = parse(raw)
  if (!questions) {
    // 8B 模型偶尔吐半截 JSON：明确要求「只输出 JSON」再试一次
    raw = await ask(
      `${prompt}\n\n上次输出不是合法 JSON。请只输出 JSON 对象，不要代码块和说明。`,
      0.2,
    )
    questions = parse(raw)
  }
  if (!questions) throw new Error('模型没有返回可用的题目')

  // 只保留用户勾选的题型（模型偶尔会越界出题）
  const allowed = new Set(input.types)
  const filtered = questions.filter((question) => allowed.has(question.type))
  return { questions: filtered.length > 0 ? filtered : questions, model: '' }
}

/**
 * 流式出题：提示词要求「一行一个 JSON 对象」，每解析出一行就产出一道题。
 *
 * 为什么不用整体 JSON：整体 JSON 必须等模型写完才能解析，几十秒里界面一片空白。
 * 逐行 JSON 牺牲一点格式严格性，换来「生成一道就显示一道」。
 */

const TYPE_ALIASES: Record<string, QuestionType> = {
  场景: 'scenario',
  场景题: 'scenario',
  场景设计: 'scenario',
  八股: 'fundamental',
  八股文: 'fundamental',
  原理: 'fundamental',
  基础: 'basic',
  基础知识: 'basic',
  算法: 'algorithm',
  算法题: 'algorithm',
  项目: 'project',
  项目深挖: 'project',
}

/** 把任意来源的题型数组规范化：中文别名 → 枚举，过滤非法值，空则给默认。 */
export const normalizeQuestionTypes = (input: unknown): QuestionType[] => {
  if (!Array.isArray(input)) return QUESTION_TYPES.slice(0, 2)
  const out: QuestionType[] = []
  for (const raw of input) {
    const key = String(raw ?? '').trim()
    const normalized =
      TYPE_ALIASES[key] ??
      ((QUESTION_TYPES as readonly string[]).includes(key) ? (key as QuestionType) : undefined)
    if (normalized && !out.includes(normalized)) out.push(normalized)
  }
  return out.length > 0 ? out : QUESTION_TYPES.slice(0, 2)
}

const DIFFICULTY_ALIASES: Record<string, 'easy' | 'medium' | 'hard'> = {
  简单: 'easy',
  容易: 'easy',
  中等: 'medium',
  一般: 'medium',
  困难: 'hard',
  难: 'hard',
}

/** 模型输出经常带中文枚举、多余字段或超长文本：先归一化再交给 schema。 */
const normalizeQuestion = (raw: unknown): InterviewQuestion | null => {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const rawType = String(item.type ?? '')
    .trim()
    .toLowerCase()
  const type: QuestionType | undefined =
    TYPE_ALIASES[String(item.type ?? '').trim()] ??
    ((QUESTION_TYPES as readonly string[]).includes(rawType)
      ? (rawType as QuestionType)
      : undefined)
  if (!type) return null
  const rawDifficulty = String(item.difficulty ?? item.level ?? '')
    .trim()
    .toLowerCase()
  const difficulty =
    DIFFICULTY_ALIASES[String(item.difficulty ?? item.level ?? '').trim()] ??
    (['easy', 'medium', 'hard'].includes(rawDifficulty)
      ? (rawDifficulty as 'easy' | 'medium' | 'hard')
      : 'medium')
  const question = String(item.question ?? item.title ?? '').trim()
  const answer = String(item.answer ?? item.explanation ?? '').trim()
  if (question.length < 4 || answer.length < 8) return null
  return {
    type,
    difficulty,
    question: question.slice(0, 400),
    answer: answer.slice(0, 1600),
  }
}

const parseQuestionLine = (line: string): InterviewQuestion[] => {
  // 允许「- {…}」「1. {…}」这种带前缀的行：只取花括号那段
  const start = line.indexOf('{')
  const end = line.lastIndexOf('}')
  const sliced = start >= 0 && end > start ? line.slice(start, end + 1) : line
  const text = sliced
    .trim()
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .replace(/^[\s,[\]]+/, '')
    .replace(/[,\s]+$/, '')
  if (!text.startsWith('{') || !text.endsWith('}')) return []
  try {
    const parsed = JSON.parse(text) as unknown
    if (Array.isArray((parsed as { questions?: unknown }).questions)) {
      const list = (parsed as { questions?: unknown[] }).questions ?? []
      const mapped = list
        .map((entry) => normalizeQuestion(entry))
        .filter((entry): entry is InterviewQuestion => entry !== null)
      if (mapped.length > 0) return mapped
    }
    const single = normalizeQuestion(parsed)
    return single ? [single] : []
  } catch {
    return []
  }
}

/** 整段兜底解析：数组、代码块、pretty-print 都能救回来。 */
const parseQuestionBlock = (raw: string): InterviewQuestion[] => {
  const text = raw.replace(/```(?:json)?/gi, '').trim()
  const candidates: string[] = []
  const objStart = text.indexOf('{')
  const objEnd = text.lastIndexOf('}')
  if (objStart >= 0 && objEnd > objStart) candidates.push(text.slice(objStart, objEnd + 1))
  const arrStart = text.indexOf('[')
  const arrEnd = text.lastIndexOf(']')
  if (arrStart >= 0 && arrEnd > arrStart) candidates.push(text.slice(arrStart, arrEnd + 1))

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      if (Array.isArray(parsed)) {
        const questions = parsed
          .map((item) => normalizeQuestion(item))
          .filter((entry): entry is InterviewQuestion => entry !== null)
        if (questions.length > 0) return questions
      }
      if (Array.isArray((parsed as { questions?: unknown }).questions)) {
        const list = (parsed as { questions: unknown[] }).questions
        const mapped = list
          .map((entry) => normalizeQuestion(entry))
          .filter((entry): entry is InterviewQuestion => entry !== null)
        if (mapped.length > 0) return mapped
      }
      const single = normalizeQuestion(parsed)
      if (single) return [single]
    } catch {
      // 换下一个候选
    }
  }
  return []
}

/** 逐题产出。Ollama 走流式；DeepSeek 一次性返回后逐条吐出（保持同一套事件形状）。 */
export async function* streamInterviewQuestions(input: {
  jd: string
  resume: string
  types: QuestionType[]
  count: number
  signal?: AbortSignal
  model?: string
  provider?: ProviderId
  apiKey?: string
  profile?: PromptProfileId
}): AsyncGenerator<InterviewQuestion> {
  const prompt = buildUserPrompt(input)
  const allowed = new Set(input.types)
  const emit = (question: InterviewQuestion): boolean => allowed.has(question.type)

  if ((input.provider ?? 'ollama') === 'deepseek') {
    const text = await chatLlm({
      provider: 'deepseek',
      apiKey: input.apiKey,
      model: input.model,
      messages: [
        { role: 'system', content: buildStreamSystemPrompt(input.types, input.profile) },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      maxTokens: 2400,
      signal: input.signal,
    })
    let deepseekEmitted = 0
    for (const line of text.split('\n')) {
      for (const question of parseQuestionLine(line)) {
        if (emit(question)) {
          deepseekEmitted += 1
          yield question
        }
      }
    }
    if (deepseekEmitted === 0) {
      for (const question of parseQuestionBlock(text)) {
        if (emit(question)) {
          deepseekEmitted += 1
          yield question
        }
      }
    }
    if (deepseekEmitted === 0) {
      const sample = text.replace(/\s+/g, ' ').trim().slice(0, 180)
      throw new Error(sample ? `模型没有按格式输出，原文开头：${sample}` : '模型没有返回任何内容')
    }
    return
  }

  let buffer = ''
  let collected = ''
  let emitted = 0
  for await (const delta of streamChat({
    messages: [
      { role: 'system', content: buildStreamSystemPrompt(input.types) },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
    numPredict: 8000,
    signal: input.signal,
    model: input.model,
  })) {
    buffer += delta
    collected += delta
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf('\n')
      for (const question of parseQuestionLine(line)) {
        if (emit(question)) {
          emitted += 1
          yield question
        }
      }
    }
  }
  // 最后一行可能没有换行符
  for (const question of parseQuestionLine(buffer)) {
    if (emit(question)) {
      emitted += 1
      yield question
    }
  }

  const failWithSample = (text: string): never => {
    const sample = text.replace(/\s+/g, ' ').trim().slice(0, 180)
    throw new Error(sample ? `模型没有按格式输出，原文开头：${sample}` : '模型没有返回任何内容')
  }

  // 模型可能整段输出一个数组（或代码块里的数组）：逐行解析会全部落空，
  // 这时用全文兜底，避免「明明生成了题，界面却报出题失败」。
  if (emitted === 0) {
    for (const question of parseQuestionBlock(collected || buffer)) {
      if (emit(question)) {
        emitted += 1
        yield question
      }
    }
  }
  if (emitted === 0) failWithSample(collected || buffer)
}
