import { describe, expect, it } from 'vitest'
import { runAgent, type AgentTool } from '../../server/services/agent'

const tools: AgentTool[] = [
  {
    name: 'summarize_resume',
    description: '把简历总结成摘要',
    parameters: '{ resume: string }',
    run: async (args) => ({ summary: `摘要：${String(args.resume).slice(0, 8)}…` }),
  },
  {
    name: 'generate_questions',
    description: '根据摘要出面试题',
    parameters: '{ summary: string, count: number }',
    run: async (args) => ({
      questions: Array.from({ length: Number(args.count) }, (_, i) => `题${i + 1}`),
    }),
  },
]

describe('agent loop', () => {
  it('calls tools in sequence and returns the final answer', async () => {
    // 假模型按剧本返回：先总结 → 再出题 → 结束
    const script = [
      { tool: 'summarize_resume', args: { resume: '五年 Java 后端' }, done: false, answer: '' },
      { tool: 'generate_questions', args: { summary: '摘要', count: 2 }, done: false, answer: '' },
      { tool: null, args: {}, done: true, answer: '已出 2 道题' },
    ]
    let call = 0
    const result = await runAgent({
      goal: '总结简历并出题',
      tools,
      chat: async () => JSON.stringify(script[call++]),
    })

    expect(result.steps.map((step) => step.tool)).toEqual([
      'summarize_resume',
      'generate_questions',
    ])
    expect(result.answer).toBe('已出 2 道题')
  })

  it('feeds tool results back and stops when the model says done immediately', async () => {
    const result = await runAgent({
      goal: '简单任务',
      tools,
      chat: async () => JSON.stringify({ tool: null, args: {}, done: true, answer: '直接完成' }),
    })
    expect(result.steps).toHaveLength(0)
    expect(result.answer).toBe('直接完成')
  })

  it('reports unknown tools instead of crashing', async () => {
    const script = [
      { tool: 'not_a_tool', args: {}, done: false, answer: '' },
      { tool: null, args: {}, done: true, answer: '结束' },
    ]
    let call = 0
    const result = await runAgent({
      goal: '任务',
      tools,
      maxSteps: 4,
      chat: async () => JSON.stringify(script[call++]),
    })
    expect(result.steps).toHaveLength(0)
    expect(result.answer).toBe('结束')
  })

  it('puts the provided resume and JD into the model context so it does not ask for them', async () => {
    let firstUserMessage = ''
    await runAgent({
      goal: '匹配岗位',
      jd: '负责高并发订单系统',
      resume: '五年 Java 后端',
      tools,
      chat: async (messages) => {
        firstUserMessage = messages.find((m) => m.role === 'user')?.content ?? ''
        return JSON.stringify({ tool: null, args: {}, done: true, answer: '完成' })
      },
    })
    expect(firstUserMessage).toContain('负责高并发订单系统')
    expect(firstUserMessage).toContain('五年 Java 后端')
    expect(firstUserMessage).toContain('不要再反问用户')
  })
})
