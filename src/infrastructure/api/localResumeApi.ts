import type { ResumeImportResult } from '@/domain/resume/importParser'
import { loadAiSettings } from '@/infrastructure/storage/aiSettings'
import type { ResumeDocument, ResumeSection, SectionType } from '@/domain/resume/model'

interface ImportFileResponse {
  document?: ResumeDocument
  warnings?: string[]
  extractedLines?: number
  sourceText?: string
  pages?: number
  sectionSources?: Record<string, { start: number; lines: string[] }>
  message?: string
}

/**
 * 本机导出服务的基地址。浏览器开发/生产模式下由 Vite 代理或 Fastify 同源提供，
 * 因此使用相对路径；桌面端（Tauri）以自定义协议加载静态资源，需要显式指向
 * 本机服务地址。可通过 `VITE_API_BASE_URL` 构建时注入。
 */
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''

const getErrorMessage = async (response: Response, fallback: string): Promise<string> => {
  try {
    const payload = (await response.json()) as { message?: string }
    return payload.message ?? fallback
  } catch {
    return fallback
  }
}

/** 简历文件导入支持的两类来源；两端返回同一种结构，确认页可以复用。 */
export type ImportFileKind = 'pdf' | 'docx'

const importResumeFile = async (file: File, kind: ImportFileKind): Promise<ResumeImportResult> => {
  const formData = new FormData()
  formData.append('file', file)
  const response = await fetch(`${API_BASE_URL}/api/import/${kind}`, {
    method: 'POST',
    body: formData,
  })
  const payload = (await response.json()) as ImportFileResponse
  if (!response.ok || !payload.document) {
    throw new Error(payload.message ?? (kind === 'pdf' ? 'PDF 导入失败' : 'Word 导入失败'))
  }
  return {
    document: payload.document,
    warnings: payload.warnings ?? [],
    extractedLines: Number(payload.extractedLines ?? 0),
    sourceText: payload.sourceText ?? '',
    sectionSources: payload.sectionSources ?? {},
    pages: payload.pages,
  }
}

export const importResumePdf = (file: File): Promise<ResumeImportResult> =>
  importResumeFile(file, 'pdf')

export const importResumeDocx = (file: File): Promise<ResumeImportResult> =>
  importResumeFile(file, 'docx')

export const exportResumeFile = async (
  document: ResumeDocument,
  format: 'pdf' | 'docx',
): Promise<Blob> => {
  const response = await fetch(`${API_BASE_URL}/api/export/${format}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(document),
  })
  if (!response.ok) {
    const fallback =
      format === 'pdf'
        ? 'PDF 服务未启动，请先运行 npm run dev'
        : 'Word 导出服务未启动，请先运行 npm run dev'
    throw new Error(await getErrorMessage(response, fallback))
  }
  return response.blob()
}

/** 本机模型状态：Ollama 没起来时前端要提前禁用按钮，而不是等点击后才报错。 */
export interface AiStatus {
  available: boolean
  model: string
  models: string[]
}

export const fetchAiStatus = async (): Promise<AiStatus> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/ai/status`)
    if (!response.ok) return { available: false, model: '', models: [] }
    const payload = (await response.json()) as Partial<AiStatus>
    return {
      available: payload.available === true,
      model: payload.model ?? '',
      models: payload.models ?? [],
    }
  } catch {
    return { available: false, model: '', models: [] }
  }
}

interface RewriteStreamEvent {
  chunk?: string
  done?: boolean
  /** 清洗后的完整结果，前端以它为准（流式增量会被思考块/开场白污染过）。 */
  final?: string
  error?: string
} /**
 * 流式改写：每收到一段增量就回调一次，最终返回完整文本。
 *
 * 用 SSE（`data: {...}`）而不是普通 JSON，是为了让首字尽快出现——
 * 8B 模型在 CPU 上首字延迟可能 2-4 秒，整段十几秒，干等体验很差。
 */
/** 改写、体检都跟随「模型来源」设置：填了 DeepSeek Key 就走云端，否则本地。 */
export const providerPayload = (): {
  provider: 'ollama' | 'deepseek'
  apiKey?: string
  model?: string
} => {
  const settings = loadAiSettings()
  const model = settings.model?.trim() || undefined
  if (settings.provider !== 'deepseek' || !settings.deepseekKey.trim()) {
    return { provider: 'ollama', model }
  }
  return { provider: 'deepseek', apiKey: settings.deepseekKey.trim(), model }
}

export interface AgentStepPayload {
  tool: string
  args: Record<string, unknown>
  result: unknown
}

/** 跑 agent 任务，SSE 逐步推送工具执行过程；返回最终答案。 */
export const runAgentStream = async (
  input: {
    goal: string
    jd?: string
    resume: string
    provider?: 'ollama' | 'deepseek'
    apiKey?: string
    model?: string
  },
  onStep: (step: AgentStepPayload) => void,
  signal?: AbortSignal,
): Promise<string> => {
  const settings = input.provider
    ? { provider: input.provider, apiKey: input.apiKey, model: input.model }
    : providerPayload()
  const response = await fetch(`${API_BASE_URL}/api/agent/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ goal: input.goal, jd: input.jd, resume: input.resume, ...settings }),
    signal,
  })
  if (!response.ok || !response.body) throw new Error('运行失败')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let answer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const event = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      boundary = buffer.indexOf('\n\n')
      const line = event.split('\n').find((l) => l.startsWith('data: '))
      if (!line) continue
      const payload = JSON.parse(line.slice(6)) as {
        step?: AgentStepPayload
        done?: boolean
        answer?: string
        error?: string
      }
      if (payload.error) throw new Error(payload.error)
      if (payload.step) onStep(payload.step)
      if (payload.done) answer = payload.answer ?? ''
    }
  }
  return answer
}

/** AI 改简历：给 JD 和简历，返回逐条改写建议。 */
export const optimizeResume = async (input: {
  jd: string
  resume: string
}): Promise<{
  summary: string
  edits: Array<{ before: string; after: string; reason: string }>
}> => {
  const response = await fetch(`${API_BASE_URL}/api/ai/optimize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...input, ...providerPayload() }),
  })
  const payload = (await response.json()) as {
    summary?: string
    edits?: Array<{ before: string; after: string; reason: string }>
    message?: string
    detail?: string
  }
  if (!response.ok || !payload.edits) {
    throw new Error(payload.message ?? payload.detail ?? '生成改写建议失败')
  }
  return { summary: payload.summary ?? '', edits: payload.edits }
}

export const rewriteResumeTextStream = async (
  text: string,
  onChunk: (delta: string) => void,
): Promise<string> => {
  const response = await fetch(`${API_BASE_URL}/api/ai/rewrite/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, ...providerPayload() }),
  })
  if (!response.ok || !response.body) {
    throw new Error(await getErrorMessage(response, 'AI 改写失败'))
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const event = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      boundary = buffer.indexOf('\n\n')

      const dataLine = event.split('\n').find((line) => line.startsWith('data: '))
      if (!dataLine) continue
      const payload = JSON.parse(dataLine.slice(6)) as RewriteStreamEvent
      if (payload.error) throw new Error(payload.error)
      if (payload.chunk) {
        result += payload.chunk
        onChunk(payload.chunk)
      }
      if (payload.done) return payload.final ?? result
    }
  }

  return result
}

/** 单模块重新解析：把某个模块的原文重跑一遍，返回新的模块结构。 */
export const reparseImportSection = async (input: {
  id: string
  type: SectionType
  title: string
  lines: string[]
}): Promise<ResumeSection> => {
  const response = await fetch(`${API_BASE_URL}/api/import/reparse`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  const payload = (await response.json()) as { section?: ResumeSection; message?: string }
  if (!response.ok || !payload.section) {
    throw new Error(payload.message ?? '重新解析失败')
  }
  return payload.section
}

export interface JobMatchSuggestion {
  title: string
  detail: string
}

export interface JobMatchResult {
  model: string
  mode?: 'fast' | 'deep'
  score: number
  summary: string
  matched: string[]
  missing: string[]
  suggestions: JobMatchSuggestion[]
  /** 深度模式下每个命中词的原文依据：词 → 简历里的原句。 */
  evidence?: Record<string, string>
}

/** 岗位匹配体检：把 JD 和当前简历正文交给本机模型，拿回结构化评分与建议。 */
export const matchResumeToJob = async (input: {
  jd: string
  resume: string
  mode?: 'fast' | 'deep'
  /** 用户取消时中断请求，服务端同时会掐掉上游生成。 */
  signal?: AbortSignal
}): Promise<JobMatchResult> => {
  const { signal, ...body } = input
  const response = await fetch(`${API_BASE_URL}/api/ai/match`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, ...providerPayload() }),
    signal,
  })
  const payload = (await response.json()) as Partial<JobMatchResult> & { message?: string }
  if (!response.ok || typeof payload.score !== 'number') {
    throw new Error(payload.message ?? '体检失败')
  }
  return {
    model: payload.model ?? '',
    score: payload.score,
    summary: payload.summary ?? '',
    matched: payload.matched ?? [],
    missing: payload.missing ?? [],
    suggestions: payload.suggestions ?? [],
    evidence: payload.evidence ?? {},
  }
}

/** 出题：面试官视角，按 JD + 简历生成若干道题。 */
export const generateInterviewQuestions = async (input: {
  jd: string
  resume: string
  types: string[]
  count: number
  model?: string
  provider?: 'ollama' | 'deepseek'
  apiKey?: string
  /** 用户点「暂停」时中断请求；服务端会同步掐掉模型生成。 */
  signal?: AbortSignal
}): Promise<{ model: string; provider?: string; questions: unknown[] }> => {
  const { signal, ...body } = input
  const response = await fetch(`${API_BASE_URL}/api/interview/questions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  const payload = (await response.json()) as {
    model?: string
    questions?: unknown[]
    message?: string
  }
  if (!response.ok || !payload.questions) {
    throw new Error(payload.message ?? '出题失败')
  }
  return { model: payload.model ?? '', questions: payload.questions }
}

/** 两种后端当前可用的模型；DeepSeek 需要带 Key（只用于这次探测）。 */
export interface AiProviders {
  ollama: { available: boolean; models: string[]; error?: string }
  deepseek: { configured: boolean; models: string[]; error?: string }
}

export const fetchAiProviders = async (apiKey?: string): Promise<AiProviders> => {
  const response = await fetch(`${API_BASE_URL}/api/ai/providers`, {
    headers: apiKey ? { 'x-ai-key': apiKey } : {},
  })
  if (!response.ok) throw new Error('读取模型列表失败')
  return (await response.json()) as AiProviders
}

/**
 * 流式出题：每解析出一道题就回调一次，最终返回全部题目。
 * 暂停由 signal 控制，服务端在连接关闭时同步中止模型生成。
 */
export const generateInterviewQuestionsStream = async (
  input: {
    jd: string
    resume: string
    types: string[]
    count: number
    model?: string
    provider?: 'ollama' | 'deepseek'
    apiKey?: string
    profile?: 'compact' | 'standard' | 'deep'
  },
  onQuestion: (question: unknown) => void,
  signal?: AbortSignal,
): Promise<{ model: string; questions: unknown[]; summary: string }> => {
  const response = await fetch(`${API_BASE_URL}/api/interview/questions/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
  if (!response.ok || !response.body) throw new Error('出题失败')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const questions: unknown[] = []
  let model = ''
  let summary = ''
  let buffer = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const event = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      boundary = buffer.indexOf('\n\n')
      const dataLine = event.split('\n').find((line) => line.startsWith('data: '))
      if (!dataLine) continue
      const payload = JSON.parse(dataLine.slice(6)) as {
        question?: unknown
        done?: boolean
        model?: string
        error?: string
        detail?: string
        summary?: string
      }
      if (payload.error) {
        throw new Error(
          payload.detail ? payload.error + ' [' + payload.detail + ']' : payload.error,
        )
      }
      if (payload.summary) summary = payload.summary
      if (payload.question) {
        questions.push(payload.question)
        onQuestion(payload.question)
      }
      if (payload.done) {
        model = payload.model ?? ''
        return { model, questions, summary }
      }
    }
  }
  return { model, questions, summary }
}

/** 一句话生成 JD（流式），返回完整文本。 */
export const generateJdStream = async (
  input: { role: string; provider?: 'ollama' | 'deepseek'; apiKey?: string; model?: string },
  onChunk: (delta: string) => void,
  signal?: AbortSignal,
): Promise<string> => {
  const response = await fetch(`${API_BASE_URL}/api/ai/jd/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
  if (!response.ok || !response.body) {
    throw new Error(await getErrorMessage(response, '生成 JD 失败'))
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const event = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      boundary = buffer.indexOf('\n\n')
      const dataLine = event.split('\n').find((line) => line.startsWith('data: '))
      if (!dataLine) continue
      const payload = JSON.parse(dataLine.slice(6)) as {
        chunk?: string
        done?: boolean
        error?: string
      }
      if (payload.error) throw new Error(payload.error)
      if (payload.chunk) {
        result += payload.chunk
        onChunk(payload.chunk)
      }
      if (payload.done) return result
    }
  }
  return result
}

/** 把一条简略答案扩写成详细版（每道题单独一次调用）。 */
export const expandInterviewAnswer = async (input: {
  question: string
  answer: string
  type: string
  jd?: string
  resume?: string
  provider?: 'ollama' | 'deepseek'
  apiKey?: string
  model?: string
  profile?: 'compact' | 'standard' | 'deep'
}): Promise<string> => {
  const response = await fetch(`${API_BASE_URL}/api/interview/expand`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  const payload = (await response.json()) as { answer?: string; message?: string }
  if (!response.ok || !payload.answer) throw new Error(payload.message ?? '展开失败')
  return payload.answer
}
