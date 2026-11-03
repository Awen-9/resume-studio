import { Annotation, messagesStateReducer } from '@langchain/langgraph'
import type { BaseMessage } from '@langchain/core/messages'
import { z } from 'zod'

/**
 * 简历 Agent 的状态与结构化输出约定。
 *
 * 图状态里只放「一次请求需要的材料」和「已经产出的结果」：
 * - goal / jd / resume：本次任务的输入，前端每次都会带上
 * - messages：多轮对话历史，由 checkpointer 按 thread_id 持久化
 * - steps：给 SSE 用的工具执行记录，前端把它渲染成时间线
 */

export const intentSchema = z.object({
  intent: z.enum(['analyze', 'rewrite', 'interview', 'qa']).describe('用户这次想做的事'),
  reason: z.string().describe('一句话理由，便于调试'),
})

export type AgentIntent = z.infer<typeof intentSchema>['intent']

export const rewriteSchema = z.object({
  summary: z.string().describe('整体改写思路，一句话'),
  edits: z
    .array(
      z.object({
        before: z.string().describe('简历里的原文，必须能在简历中找到'),
        after: z.string().describe('改写后的文本'),
        reason: z.string().describe('为什么这样改'),
      }),
    )
    .min(1)
    .max(5),
})

export type RewriteResult = z.infer<typeof rewriteSchema>

export const matchSchema = z.object({
  score: z.number().min(0).max(100).describe('岗位匹配度 0-100'),
  summary: z.string().describe('两句话以内的总体评价'),
  matched: z.array(z.string()).describe('简历里已满足的关键要求'),
  missing: z.array(z.string()).describe('简历里缺失的关键要求'),
  suggestions: z
    .array(z.object({ title: z.string(), detail: z.string() }))
    .describe('可执行的补充建议'),
})

export type MatchResult = z.infer<typeof matchSchema>

export const questionItemSchema = z.object({
  type: z.string().describe('场景题 / 八股 / 基础知识 / 算法 / 项目深挖'),
  difficulty: z.enum(['简单', '中等', '困难']),
  question: z.string(),
  answer: z.string().describe('参考答案，分点说明'),
})

export const questionsSchema = z.object({
  questions: z.array(questionItemSchema).min(1).max(10),
})

export type QuestionResult = z.infer<typeof questionsSchema>

export interface AgentStep {
  tool: string
  args: Record<string, unknown>
  result: unknown
}

export const AgentStateAnnotation = Annotation.Root({
  goal: Annotation<string>({ reducer: (_previous, next) => next, default: () => '' }),
  jd: Annotation<string>({ reducer: (_previous, next) => next, default: () => '' }),
  resume: Annotation<string>({ reducer: (_previous, next) => next, default: () => '' }),
  intent: Annotation<AgentIntent | null>({
    reducer: (_previous, next) => next,
    default: () => null,
  }),
  answer: Annotation<string>({ reducer: (_previous, next) => next, default: () => '' }),
  proposal: Annotation<RewriteResult | null>({
    reducer: (_previous, next) => next,
    default: () => null,
  }),
  decision: Annotation<'accept' | 'reject' | null>({
    reducer: (_previous, next) => next,
    default: () => null,
  }),
  /** 用户在确认卡里勾选了哪几条改写；不传则视为全选。 */
  accepted: Annotation<number[] | null>({
    reducer: (_previous, next) => next,
    default: () => null,
  }),
  steps: Annotation<AgentStep[]>({
    reducer: (previous, next) => previous.concat(next),
    default: () => [],
  }),
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
})

export type AgentState = typeof AgentStateAnnotation.State
