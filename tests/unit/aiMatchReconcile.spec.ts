import { describe, expect, it } from 'vitest'
import {
  dropContradictingSuggestions,
  extractKeywords,
  reconcileTerms,
} from '../../server/routes/aiMatch'

describe('jd match keyword reconciliation', () => {
  const resume = [
    '熟悉 AgentScope、Spring AI、LangChain4j、MCP、RAG、Tool Calling。',
    '多 Agent 协作、Master Agent / SubAgent、ReAct、Plan-and-Execute。',
    '后端工程 MySQL、Redis/Redisson、Kafka、ElasticSearch、XXL-JOB。',
    '博客：awen-9.github.io ｜ GitHub：github.com/Awen-9',
  ].join('\n')

  it('moves keywords the model called missing back to matched', () => {
    const result = reconcileTerms(
      { matched: ['AgentScope'], missing: ['MCP', '多 Agent 协作', 'Kafka', 'ElasticSearch'] },
      resume,
    )
    expect(result.matched).toEqual(['AgentScope', 'MCP', '多 Agent 协作', 'Kafka', 'ElasticSearch'])
    expect(result.missing).toEqual([])
  })

  it('keeps truly absent skills in missing', () => {
    const result = reconcileTerms(
      { matched: [], missing: ['Go', 'Rust', 'Kubernetes', 'Istio', 'Flink'] },
      resume,
    )
    expect(result.missing).toEqual(['Go', 'Rust', 'Kubernetes', 'Istio', 'Flink'])
    expect(result.matched).toEqual([])
  })

  it('does not match Go inside github', () => {
    const result = reconcileTerms({ matched: [], missing: ['Go'] }, 'awen-9.github.io')
    expect(result.missing).toEqual(['Go'])
  })

  it('matches latin terms with separators such as Redis/Redisson', () => {
    const result = reconcileTerms({ matched: [], missing: ['Redis'] }, 'Redis/Redisson、MySQL')
    expect(result.matched).toEqual(['Redis'])
  })

  it('normalizes spaces inside chinese-and-latin phrases', () => {
    const result = reconcileTerms(
      { matched: [], missing: ['多Agent协作'] },
      '多 Agent 协作、Master Agent',
    )
    expect(result.matched).toEqual(['多Agent协作'])
  })

  it('drops suggestions telling the user to add something already matched', () => {
    const result = dropContradictingSuggestions({
      matched: ['技术博客', '开源项目', 'SSE'],
      suggestions: [
        { title: '补充会话管理经验', detail: '增加上下文维护和中断恢复的描述' },
        { title: '展示开源贡献', detail: '提及参与的开源项目或技术博客' },
        { title: '把 RAG 写具体', detail: '量化检索准确率与召回率' },
      ],
    })
    expect(result.suggestions.map((item) => item.title)).toEqual([
      '补充会话管理经验',
      '把 RAG 写具体',
    ])
  })

  it('falls back to a neutral suggestion when every suggestion contradicts', () => {
    const result = dropContradictingSuggestions({
      matched: ['开源项目'],
      suggestions: [{ title: '展示开源贡献', detail: '提及参与的开源项目' }],
    })
    expect(result.suggestions).toHaveLength(1)
    expect(result.suggestions[0].title).not.toContain('开源')
  })

  it('keeps hyphenated technology names in one piece', () => {
    const keywords = extractKeywords(
      '有 ReAct、Plan-and-Execute、Human-in-the-Loop 实战经验，熟悉 Spring AI 与 MCP',
    )
    expect(keywords).toContain('Plan-and-Execute')
    expect(keywords).toContain('Human-in-the-Loop')
    expect(keywords).not.toContain('Plan')
    expect(keywords).not.toContain('Loop')
    expect(keywords).toContain('Spring AI')
    expect(keywords).toContain('MCP')
  })

  it('drops section headings from keywords', () => {
    const keywords = extractKeywords(
      ['岗位职责：', '负责 AI Agent 平台研发', '任职要求：', '熟悉 Redis'].join('\n'),
    )
    expect(keywords.some((keyword) => keyword.includes('岗位职责'))).toBe(false)
    expect(keywords.some((keyword) => keyword.includes('任职要求'))).toBe(false)
    expect(keywords).toContain('Redis')
  })

  it('prefers the longer phrase when one contains another', () => {
    const keywords = extractKeywords('熟悉 AI Agent 与 Agent 架构')
    expect(keywords.filter((keyword) => /agent/i.test(keyword))).toHaveLength(1)
  })

  it('drops a suggestion asking for tech that is already in the resume', () => {
    const result = dropContradictingSuggestions(
      {
        matched: [],
        missing: [],
        suggestions: [{ title: '补充 Ollama 部署经验', detail: '说明本地模型部署方式' }],
      },
      '通过 Ollama 调用本地模型',
      '要求熟悉 Ollama 与本地模型部署',
    )
    expect(result.suggestions[0].title).not.toContain('Ollama')
  })

  it('keeps a suggestion for tech the resume really lacks', () => {
    const result = dropContradictingSuggestions(
      {
        matched: [],
        missing: ['Kubernetes'],
        suggestions: [{ title: '补充 Kubernetes 经验', detail: '补充容器编排实践' }],
      },
      '熟悉 Redis、Kafka',
      '要求 Kubernetes 与 Redis',
    )
    expect(result.suggestions[0].title).toContain('Kubernetes')
  })

  it('builds fallback suggestions from missing items instead of a canned line', () => {
    const result = dropContradictingSuggestions(
      {
        matched: ['Redis'],
        missing: ['Kubernetes', 'Istio'],
        suggestions: [{ title: '补充 Redis 经验', detail: '增加缓存实践' }],
      },
      '熟悉 Redis',
      '要求 Redis 与 Kubernetes',
    )
    expect(result.suggestions[0].title).toBe('补上 Kubernetes')
    expect(result.suggestions.some((item) => item.title.includes('Kubernetes'))).toBe(true)
  })

  it('suggests ordering when nothing is missing', () => {
    const result = dropContradictingSuggestions(
      {
        matched: ['AgentScope', 'MCP', 'RAG'],
        missing: [],
        suggestions: [{ title: '补充 AgentScope 经验', detail: '提及 AgentScope' }],
      },
      '使用 AgentScope 与 MCP',
      '要求 AgentScope、MCP、RAG',
    )
    expect(result.suggestions).toHaveLength(1)
    expect(result.suggestions[0].title).toBe('把最匹配的经历往前排')
  })
})
