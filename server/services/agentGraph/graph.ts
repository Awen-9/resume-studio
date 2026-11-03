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

const emitStep = (step: AgentStep): void => {
  getWriter()?.({ type: 'step', step })
}

const truncate = (text: string, limit = 4000): string =>
  text.length > limit ? `${text.slice(0, limit)}\n…（已截断）` : text

const textOf = (content: unknown): string =>
  typeof content === 'string' ? content : JSON.stringify(content)

const CLASSIFY_PROMPT = `你是简历助手的意图分类器。只输出 JSON 对象，不要解释、不要代码块。
字段：intent（只能是 analyze / rewrite / interview / qa 之一）、reason（一句话）。
判断规则：
- analyze：岗位匹配、打分、差距分析、点评简历
- rewrite：改写、润色、优化简历里的句子
- interview：出面试题、模拟面试、准备回答
- qa：其他提问、追问、解释简历内容
`

const ANALYZE_PROMPT = `你是简历与岗位匹配分析器。根据简历和 JD 打分并给出可执行建议。
只输出 JSON：{"score":0-100,"summary":"两句话以内的总评","matched":["已满足的要求"],"missing":["缺失的要求"],"suggestions":[{"title":"短标题","detail":"具体怎么改"}]}
只依据给出的内容判断，不要编造经历；缺少关键要求时不要给高分。
`

const REWRITE_PROMPT = `你在改写中文简历。只改写、不扩写、不编造。
只输出 JSON：{"summary":"整体思路","edits":[{"before":"简历原文","after":"改写后","reason":"为什么这样改"}]}
要求：before 必须是简历里原样出现的句子；每条 after 不超过 50 个汉字；最多 5 条。
`

const INTERVIEW_PROMPT = `你是面试官。根据岗位和简历出题，题目要能验证简历里的经历。
只输出 JSON：{"questions":[{"type":"场景题/八股/基础知识/算法/项目深挖","difficulty":"简单/中等/困难","question":"题目","answer":"参考答案，分点说明"}]}
`

const QA_PROMPT = `你是简历助手。回答用户关于简历和岗位的问题。
可以调用工具读取简历模块、读取 JD、生成改写稿；需要细节时先调用工具，不要凭空猜测。
回答用中文，简洁、具体，必要时分点。`

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
    const hints = instruction?.trim() ? `\n额外要求：${instruction.trim()}` : ''
    return invokeStructured(model, rewriteSchema, [
      new SystemMessage(REWRITE_PROMPT),
      new HumanMessage(`要改写的原文：\n${target}${hints}`),
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
        new HumanMessage(
          `最近对话：\n${history || '（无）'}\n\n本次目标：${state.goal}\n\n只输出 {"intent":"...","reason":"..."}。`,
        ),
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
      new HumanMessage(
        `简历：\n${truncate(state.resume)}\n\n岗位描述：\n${state.jd ? truncate(state.jd, 3000) : '（用户没有提供 JD，请按简历本身给通用点评）'}`,
      ),
    ])
    const step: AgentStep = { tool: 'analyze_match', args: {}, result }
    emitStep(step)
    const answer = formatMatch(result)
    return { answer, steps: [step], messages: [new AIMessage(answer)] }
  }

  const rewriteDraftNode = async (state: AgentState): Promise<Partial<AgentState>> => {
    const result = await invokeStructured(model, rewriteSchema, [
      new SystemMessage(REWRITE_PROMPT),
      new HumanMessage(
        `简历：\n${truncate(state.resume)}\n\n岗位描述：\n${state.jd ? truncate(state.jd, 3000) : '（未提供）'}\n\n本次目标：${state.goal}`,
      ),
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
      new HumanMessage(
        `岗位描述：\n${state.jd ? truncate(state.jd, 3000) : '（未提供，按简历本身出题）'}\n\n简历：\n${truncate(state.resume)}\n\n目标：${state.goal}`,
      ),
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
      new SystemMessage(
        `${QA_PROMPT}\n\n简历：\n${truncate(state.resume)}\n\n岗位描述：\n${state.jd ? truncate(state.jd, 3000) : '（未提供）'}`,
      ),
      ...state.messages,
    ]

    for (let round = 0; round < 4; round += 1) {
      const response = await withTools.invoke(conversation)
      conversation.push(response)
      const calls = response.tool_calls ?? []
      if (calls.length === 0) {
        const answer = stripThinkingBlocks(textOf(response.content))
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
