import { describe, expect, it } from 'vitest'
import { sanitizeRichHtml } from '../../server/services/sanitizeRichHtml'

/**
 * 服务端富文本清洗器（sanitize-html）的安全用例。
 *
 * 覆盖旧正则方案会漏掉的绕过写法（`/onclick` 前面没有空格），以及事件属性、
 * javascript: 协议、style 属性、嵌套标签重组等常见注入；并断言白名单内的
 * 正常结构原样保留。
 */
describe('sanitize-html rich text sanitizer', () => {
  it('drops attributes hidden behind a slash instead of a space', () => {
    const result = sanitizeRichHtml('<p/onclick=x>')
    expect(result).not.toContain('onclick')
    expect(result).toContain('<p>')
  })

  it('drops event handler attributes', () => {
    expect(sanitizeRichHtml('<p onmouseover=x>')).not.toContain('onmouseover')
  })

  it('drops non-whitelisted tags like img', () => {
    const result = sanitizeRichHtml('<img src=x onerror=alert(1)>')
    expect(result).not.toContain('img')
    expect(result).not.toContain('src')
    expect(result).not.toContain('onerror')
  })

  it('drops script elements including their text content', () => {
    expect(sanitizeRichHtml('<script>x</script>')).toBe('')
  })

  it('drops javascript: URLs on non-whitelisted tags', () => {
    const result = sanitizeRichHtml('<a href="javascript:x">x</a>')
    expect(result).not.toContain('javascript:')
    expect(result).not.toContain('<a')
    expect(result).toContain('x')
  })

  it('drops style attributes', () => {
    expect(sanitizeRichHtml('<p style="x">a</p>')).not.toContain('style')
  })

  it('escapes stray angle brackets so text cannot assemble a tag', () => {
    expect(sanitizeRichHtml('<<script>script>')).not.toContain('<script')
  })

  it('preserves whitelisted formatting exactly', () => {
    expect(sanitizeRichHtml('<p><strong>a</strong></p>')).toBe('<p><strong>a</strong></p>')
    expect(sanitizeRichHtml('<ul><li>x</li></ul>')).toBe('<ul><li>x</li></ul>')
  })
})
