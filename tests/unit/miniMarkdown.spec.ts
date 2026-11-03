import { renderAnswerHtml } from '@/shared/utils/miniMarkdown'

describe('answer rendering', () => {
  it('turns section labels into headings', () => {
    const html = renderAnswerHtml('**简要回答**\n结论一句话\n**详细回答**\n1) 细节')
    expect(html).toContain('<h4 class="answer-h">简要回答</h4>')
    expect(html).toContain('<h4 class="answer-h">详细回答</h4>')
  })

  it('keeps inline bold and code', () => {
    const html = renderAnswerHtml('把 **P99** 从 480ms 降到 90ms，命令是 `EXPLAIN`')
    expect(html).toContain('<strong>P99</strong>')
    expect(html).toContain('<code>EXPLAIN</code>')
  })

  it('escapes raw html so model output cannot inject markup', () => {
    const html = renderAnswerHtml('<img src=x onerror=alert(1)>')
    expect(html).toContain('&lt;img')
    expect(html).not.toContain('<img')
  })

  it('preserves line breaks between points', () => {
    expect(renderAnswerHtml('1) 第一点\n2) 第二点')).toContain('<br>')
  })
})
