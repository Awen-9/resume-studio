import { createDefaultDocument } from '@/domain/resume/defaults'
import { itemTextLength, validateResumeDocument } from '@/domain/resume/validation'
import { sanitizeRichHtml } from '@/domain/resume/renderer'

describe('resume document rules', () => {
  it('creates a valid starter document', () => {
    const document = createDefaultDocument()
    expect(validateResumeDocument(document)).toEqual([])
    expect(document.sections.length).toBeGreaterThan(0)
  })

  it('detects missing required fields and duplicate ids', () => {
    const document = createDefaultDocument()
    document.profile.name = ''
    document.sections[0].id = document.sections[1].id
    const errors = validateResumeDocument(document)
    expect(errors).toContain('姓名不能为空')
    expect(errors.some((error) => error.includes('模块 id 重复'))).toBe(true)
  })

  it('counts rich text and bullet content', () => {
    const document = createDefaultDocument()
    const item = document.sections[0].items[0]
    item.content = '<p>一段内容</p>'
    item.bullets = ['补充要点']
    expect(itemTextLength(item)).toBeGreaterThan(5)
  })

  it('removes unsafe rich text tags and attributes', () => {
    const result = sanitizeRichHtml('<p onclick="alert(1)">正文</p><script>alert(1)</script>')
    expect(result).toContain('<p>正文</p>')
    expect(result).not.toContain('onclick')
    expect(result).not.toContain('<script>')
  })

  it('drops attributes hidden behind a slash instead of a space', () => {
    // 浏览器会把 `/onclick` 解析成 `onclick`，旧的正则（要求属性前有空格）漏掉这一类
    expect(sanitizeRichHtml('<li/onclick="alert(1)">条目</li>')).toBe('<li>条目</li>')
    expect(sanitizeRichHtml('<p/onmouseover="x()">段落</p>')).toBe('<p>段落</p>')
  })

  it('strips event handlers in any spelling', () => {
    for (const input of [
      '<p ONLOAD=alert(1)>a</p>',
      '<img src=x onerror=alert(1)>c',
      '<svg/onload=alert(1)></svg>',
      '<p style="background:url(javascript:alert(1))">d</p>',
    ]) {
      const result = sanitizeRichHtml(input).toLowerCase()
      for (const forbidden of [
        'onerror',
        'onload',
        'onmouseover',
        'onclick',
        'javascript:',
        '<img',
        '<svg',
      ])
        expect(result).not.toContain(forbidden)
    }
  })

  it('keeps the whitelisted formatting intact', () => {
    const html = '<p>正文<strong>重点</strong><em>强调</em></p><ul><li>要点</li></ul><br />'
    expect(sanitizeRichHtml(html)).toBe(html)
  })

  it('escapes stray angle brackets so text cannot assemble a tag', () => {
    expect(sanitizeRichHtml('<scr<script>ipt>')).not.toContain('<script')
    expect(sanitizeRichHtml('a < b 且 c > d')).toBe('a &lt; b 且 c > d')
  })

  it('validates email and phone format', () => {
    const document = createDefaultDocument()
    document.profile.email = 'not-an-email'
    document.profile.phone = '12345'
    const errors = validateResumeDocument(document)
    expect(errors).toContain('邮箱格式不正确')
    expect(errors).toContain('手机号格式不正确')
  })

  it('accepts valid email and phone without format errors', () => {
    const document = createDefaultDocument()
    document.profile.email = 'name@example.com'
    document.profile.phone = '138 0000 0000'
    const errors = validateResumeDocument(document)
    expect(errors.some((error) => error.includes('格式不正确'))).toBe(false)
  })

  it('flags an invalid schema version', () => {
    const document = createDefaultDocument()
    document.schemaVersion = 0
    const errors = validateResumeDocument(document)
    expect(errors).toContain('简历数据版本不合法')
  })
})
