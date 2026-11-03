import { LEAD_IN_PATTERN, emphasizeLeadInHtml, splitLeadIn } from '@/domain/resume/leadIn'

describe('bolding the lead-in label of a paragraph', () => {
  it('splits a label and its content', () => {
    expect(splitLeadIn('多 Agent 架构：设计用户请求 → 结果返回的执行链路')).toEqual({
      lead: '多 Agent 架构：',
      rest: '设计用户请求 → 结果返回的执行链路',
    })
  })

  it('accepts latin labels and half-width colons', () => {
    expect(splitLeadIn('Skill 与 Tool: 把能力封装为预置 Skill')).toEqual({
      lead: 'Skill 与 Tool:',
      rest: ' 把能力封装为预置 Skill',
    })
  })

  it('does not treat a sentence as a label', () => {
    // 标签里出现句子内标点时不算标签
    expect(splitLeadIn('负责业务需求分析、技术方案设计：核心模块')).toBeNull()
    expect(splitLeadIn('这里是一句很长的开头，后面才出现冒号：内容')).toBeNull()
  })

  it('does not bold numeric or empty labels', () => {
    expect(splitLeadIn('2024-至今：某公司')).toBeNull()
    expect(splitLeadIn('注意：')).toBeNull()
  })

  it('only bolds the first paragraph that starts with plain text', () => {
    const html =
      '<p>多 Agent 架构：设计链路</p><p>这里没有标签</p><p><strong>已经是粗体：</strong>不变</p>'
    expect(emphasizeLeadInHtml(html)).toBe(
      '<p><strong>多 Agent 架构：</strong>设计链路</p><p>这里没有标签</p><p><strong>已经是粗体：</strong>不变</p>',
    )
  })

  it('keeps the pattern anchored so tags are not swallowed', () => {
    expect(LEAD_IN_PATTERN.test('<strong>x</strong>')).toBe(false)
  })
})
