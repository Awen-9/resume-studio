import { createDefaultDocument } from '@/data/defaultResume'
import { itemTextLength, validateResumeDocument } from '@/lib/resume'
import { sanitizeRichHtml } from '@/lib/resumeRenderer'

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
})
