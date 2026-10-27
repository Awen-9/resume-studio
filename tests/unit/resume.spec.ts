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
