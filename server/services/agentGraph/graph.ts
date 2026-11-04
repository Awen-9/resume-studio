import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages'
import { END, MemorySaver, START, StateGraph, getWriter, interrupt } from '@langchain/langgraph'
import {
  createChatModel,
  invokeStructured,
  stripThinkingBlocks,
  type ModelRequest,
} from './model.js'
import {
  AgentStateAnnotation,
  intentSchema,
  matchSchema,
  questionsSchema,
  rewriteSchema,
  type AgentIntent,
  type AgentState,
  type AgentStep,
  type QuestionResult,
  type RewriteResult,
} from './state.js'
import { buildAgentTools } from './tools.js'
import {
  ANALYZE_PROMPT,
  CLASSIFY_PROMPT,
  INTERVIEW_PROMPT,
  REWRITE_PROMPT,
  buildAnalyzeInput,
  buildClassifyInput,
  buildDraftRewriteInput,
  buildInterviewInput,
  buildQaSystemPrompt,
  buildRewriteInput,
} from './prompts.js'

/**
 * 简历 Agent 的 LangGraph 编排。
 *
 * 一次请求从 START 进入 classify，按意图分流：
 * - analyze：读简历 + JD → 打分与建议（withStructuredOutput）
 * - rewrite：生成改写稿 → interrupt 等人工确认 → 采纳/放弃
 * - interview：按题型出题（withStructuredOutput）
 * - qa：带上工具（读模块 / 读 JD / 生成改写稿）走工具调用循环
 *
 * checkpointer 用进程内 MemorySaver：同一个 thread_id 的多轮对话、
 * 以及 interrupt 之后的中断续跑都靠它保存图状态。
 */
const checkpointer = new MemorySaver()

export const agentCheckpointer = checkpointer

/**
 * 进程内最多保留的会话数。
 *
 * MemorySaver 没有过期时间，服务一直开着时每个 thread_id 都会占内存；
 * 这里按创建顺序只保留最近 50 个，超出后删掉最旧的（本地单用户足够用）。
 */
export const MAX_AGENT_SESSIONS = 50
const trackedSessions: string[] = []

/** 登记一个新会话；超过上限时按创建顺序淘汰最旧的。 */
export const trackAgentSession = async (threadId: string): Promise<void> => {
  if (trackedSessions.includes(threadId)) return
  trackedSessions.push(threadId)
  while (trackedSessions.length > MAX_AGENT_SESSIONS) {
    const oldest = trackedSessions.shift()
    if (oldest) await checkpointer.deleteThread(oldest)
  }
}

const emitStep = (step: AgentStep): void => {
  getWriter()?.({ type: 'step', step })
}

const textOf = (content: unknown): string =>
  typeof content === 'string' ? content : JSON.stringify(content)

/** 结构化输出偶尔失败时的兜底：按关键词判断意图，避免整个请求挂掉。 */
const guessIntent = (goal: string): AgentIntent => {
  if (/改写|润色|优化|重写/.test(goal)) return 'rewrite'
  if (/面试|出题|题目|模拟/.test(goal)) return 'interview'
  if (/匹配|打分|评分|差距|点评|分析/.test(goal)) return 'analyze'
  return 'qa'
}

/** 模型偶尔把 JD 或用户目标也塞进 before；只保留能在简历原文里逐字找到的条目。 */
const groundEdits = (resume: string, result: RewriteResult): RewriteResult => {
  const text = resume.replace(/\s+/g, ' ')
  const edits = result.edits.filter((edit) => {
    const before = edit.before.trim()
    return before.length >= 2 && text.includes(before.replace(/\s+/g, ' '))
  })
  if (edits.length === 0) return result
  return { ...result, edits: edits.slice(0, 5) }
}

const formatMatch = (result: {
  score: number
  summary: string
  matched: string[]
  missing: string[]
  suggestions: Array<{ title: string; detail: string }>
}): string => {
  const lines = [`匹配度 ${result.score}/100。${result.summary}`]
  if (result.matched.length) lines.push('', `已具备：${result.matched.join('、')}`)
  if (result.missing.length) lines.push('', `还缺：${result.missing.join('、')}`)
  if (result.suggestions.length) {
    lines.push('', '建议：')
    for (const item of result.suggestions) lines.push(`- ${item.title}：${item.detail}`)
  }
  return lines.join('\n')
}

const formatQuestions = (result: QuestionResult): string =>
  result.questions
    .map(
      (item, index) =>
        `${index + 1}. [${item.type} · ${item.difficulty}] ${item.question}\n   参考：${item.answer}`,
    )
    .join('\n\n')

export const buildAgentGraph = (request: ModelRequest) => {
  const model = createChatModel(request)

  const draftRewrite = async (target: string, instruction?: string): Promise<RewriteResult> => {
    return invokeStructured(model, rewriteSchema, [
      new SystemMessage(REWRITE_PROMPT),
      new HumanMessage(buildDraftRewriteInput(target, instruction)),
    ])
  }

  const classifyNode = async (state: AgentState): Promise<Partial<AgentState>> => {
    const history = state.messages
      .slice(-6)
      .map((message) => `${message.getType()}: ${textOf(message.content).slice(0, 200)}`)
      .join('\n')
    let intent: AgentIntent
    try {
      const result = await invokeStructured(model, intentSchema, [
        new SystemMessage(CLASSIFY_PROMPT),
        new HumanMessage(buildClassifyInput(history, state.goal)),
      ])
      intent = result.intent
    } catch {
      intent = guessIntent(state.goal)
    }
    const step: AgentStep = {
      tool: 'classify_intent',
      args: { goal: state.goal },
      result: { intent },
    }
    emitStep(step)
    return { intent, steps: [step], messages: [new HumanMessage(state.goal)] }
  }

  const analyzeNode = async (state: AgentState): Promise<Partial<AgentState>> => {
    const result = await invokeStructured(model, matchSchema, [
      new SystemMessage(ANALYZE_PROMPT),
      new HumanMessage(buildAnalyzeInput(state.resume, state.jd)),
    ])
    const step: AgentStep = { tool: 'analyze_match', args: {}, result }
    emitStep(step)
    const answer = formatMatch(result)
    return { answer, steps: [step], messages: [new AIMessage(answer)] }
  }

  const rewriteDraftNode = async (state: AgentState): Promise<Partial<AgentState>> => {
    const result = await invokeStructured(model, rewriteSchema, [
      new SystemMessage(REWRITE_PROMPT),
      new HumanMessage(buildRewriteInput(state.resume, state.jd, state.goal)),
    ])
    const proposal = groundEdits(state.resume, result)
    const step: AgentStep = { tool: 'draft_rewrite', args: {}, result: proposal }
    emitStep(step)
    return { proposal, steps: [step] }
  }

  /** 人工确认：图在这里暂停，前端展示 before/after，用户采纳或放弃后再 resume。 */
  const rewriteReviewNode = async (state: AgentState): Promise<Partial<AgentState>> => {
    const decision = interrupt<
      { type: 'rewrite_review'; proposal: RewriteResult | null },
      { decision: 'accept' | 'reject'; accepted?: number[] }
    >({ type: 'rewrite_review', proposal: state.proposal })
    const all = state.proposal?.edits.map((_, index) => index) ?? []
    return {
      decision: decision.decision,
      accepted: decision.accepted?.length ? decision.accepted : all,
    }
  }

  const rewriteApplyNode = async (state: AgentState): Promise<Partial<AgentState>> => {
    const proposal = state.proposal
    if (!proposal || state.decision !== 'accept') {
      const answer = '已放弃这次改写，简历没有改动。'
      return { answer, messages: [new AIMessage(answer)] }
    }
    const accepted = (state.accepted ?? proposal.edits.map((_, index) => index)).filter(
      (index) => index >= 0 && index < proposal.edits.length,
    )
    const edits = accepted.map((index) => proposal.edits[index]).filter((edit) => Boolean(edit))
    const step: AgentStep = { tool: 'apply_rewrite', args: { accepted }, result: { edits } }
    emitStep(step)
    const answer = `已采纳 ${edits.length} 条改写建议，写回简历后可以在编辑器里 Ctrl+Z 撤销。`
    return { answer, steps: [step], messages: [new AIMessage(answer)] }
  }

  const interviewNode = async (state: AgentState): Promise<Partial<AgentState>> => {
    const result = await invokeStructured(model, questionsSchema, [
      new SystemMessage(INTERVIEW_PROMPT),
      new HumanMessage(buildInterviewInput(state.resume, state.jd, state.goal)),
    ])
    const step: AgentStep = { tool: 'generate_questions', args: {}, result }
    emitStep(step)
    const answer = formatQuestions(result)
    return { answer, steps: [step], messages: [new AIMessage(answer)] }
  }

  const qaNode = async (state: AgentState): Promise<Partial<AgentState>> => {
    const tools = buildAgentTools({ resume: state.resume, jd: state.jd, draftRewrite })
    const withTools = (
      model as typeof model & { bindTools: (input: typeof tools) => typeof model }
    ).bindTools(tools)
    const collected: AgentStep[] = []
    const conversation: BaseMessage[] = [
      new SystemMessage(buildQaSystemPrompt(state.resume, state.jd)),
      ...state.messages,
    ]

    for (let round = 0; round < 4; round += 1) {
      const response = await withTools.invoke(conversation)
      conversation.push(response)
      const calls = response.tool_calls ?? []
      if (calls.length === 0) {
        const answer =
          stripThinkingBlocks(textOf(response.content)) ||
          '模型这次只返回了思考过程，没有给出答案，请重试。'
        return { answer, steps: collected, messages: [new AIMessage(answer)] }
      }

      for (const call of calls) {
        const found = tools.find((candidate) => candidate.name === call.name)
        let result: unknown
        try {
          const invoke = found?.invoke.bind(found) as unknown as (
            args: Record<string, unknown>,
          ) => Promise<unknown>
          result = found ? await invoke(call.args) : { error: `没有工具 ${call.name}` }
        } catch (error) {
          result = { error: error instanceof Error ? error.message : String(error) }
        }
        const step: AgentStep = { tool: call.name, args: call.args, result }
        emitStep(step)
        collected.push(step)
        conversation.push(
          new ToolMessage({
            content: JSON.stringify(result).slice(0, 4000),
            tool_call_id: call.id ?? call.name,
          }),
        )
      }
    }

    const fallback = '工具调用达到上限，先给出目前拿到的信息；可以把问题拆小一点再问。'
    return { answer: fallback, steps: collected, messages: [new AIMessage(fallback)] }
  }

  const routeByIntent = (state: AgentState): string => state.intent ?? 'qa'

  return new StateGraph(AgentStateAnnotation)
    .addNode('classify', classifyNode)
    .addNode('analyze', analyzeNode)
    .addNode('rewrite_draft', rewriteDraftNode)
    .addNode('rewrite_review', rewriteReviewNode)
    .addNode('rewrite_apply', rewriteApplyNode)
    .addNode('interview', interviewNode)
    .addNode('qa', qaNode)
    .addEdge(START, 'classify')
    .addConditionalEdges('classify', routeByIntent, {
      analyze: 'analyze',
      rewrite: 'rewrite_draft',
      interview: 'interview',
      qa: 'qa',
    })
    .addEdge('analyze', END)
    .addEdge('rewrite_draft', 'rewrite_review')
    .addEdge('rewrite_review', 'rewrite_apply')
    .addEdge('rewrite_apply', END)
    .addEdge('interview', END)
    .addEdge('qa', END)
    .compile({ checkpointer })
}
