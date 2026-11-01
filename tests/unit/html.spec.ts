import { createDefaultDocument } from '@/domain/resume/defaults'
import { decodeHtmlEntities, sanitizeRichHtml, stripHtml } from '@/domain/resume/html'
import { renderResumeHtml } from '@/domain/resume/renderer'
import { RESUME_TEMPLATE_CSS } from '@/domain/resume/templateStyles'
import { isResumeDocument } from '@/domain/resume/validation'

describe('rich text sanitizer', () => {
  it.each([
    ['<p/onmouseover=alert(1)>hi</p>', '<p>hi</p>'],
    ['<br/onfocus=alert(1) autofocus tabindex=1>', '<br>'],
    ['<p\nonclick=alert(1)>a</p>', '<p>a</p>'],
    ['<img src=x onerror=alert(1)>', ''],
    ['<svg><script>alert(1)</script></svg>文字', '文字'],
    ['<p style="color:red" class="x">a</p>', '<p>a</p>'],
    ['<strong>粗</strong><em>斜</em>', '<strong>粗</strong><em>斜</em>'],
  ])('rebuilds %j without attributes', (input, expected) => {
    expect(sanitizeRichHtml(input)).toBe(expected)
  })

  it('escapes stray angle brackets outside of tags', () => {
    expect(sanitizeRichHtml('<p>1 < 2 > 0</p>')).toBe('<p>1 &lt; 2 &gt; 0</p>')
    expect(sanitizeRichHtml('<<img src=x onerror=alert(1)>p>')).toBe('&lt;p&gt;')
  })

  it('never outputs an attribute on any tag', () => {
    const output = sanitizeRichHtml(
      '<ul onclick=a><li title="x">a</li></ul><ol data-x=1><li>b</li></ol><em/x=1>c</em>',
    )
    expect(output).not.toMatch(/<[a-z]+[^a-z>]/i)
  })
})

describe('stripHtml', () => {
  it('extracts text and decodes entities without a DOM', () => {
    expect(stripHtml('<p>A &amp; B</p><p>&lt;tag&gt;&nbsp;&#20013;&#x6587;</p>')).toBe(
      'A & B <tag> 中文',
    )
  })

  it('keeps unknown entities as-is', () => {
    expect(decodeHtmlEntities('&unknown; &#0;')).toBe('&unknown; &#0;')
  })
})

describe('isResumeDocument', () => {
  it('accepts the default document', () => {
    expect(isResumeDocument(createDefaultDocument())).toBe(true)
  })

  it('rejects documents missing nested fields', () => {
    const document = createDefaultDocument() as unknown as Record<string, unknown>
    expect(isResumeDocument({ ...document, theme: undefined })).toBe(false)
    const brokenItem = createDefaultDocument()
    ;(brokenItem.sections[0].items[0] as unknown as Record<string, unknown>).bullets = 'x'
    expect(isResumeDocument(brokenItem)).toBe(false)
  })

  it('rejects theme values that could break out of an inline style', () => {
    const badColor = createDefaultDocument()
    badColor.theme.accentColor = 'red;background:url(https://example.com)'
    expect(isResumeDocument(badColor)).toBe(false)
    const badFont = createDefaultDocument()
    badFont.theme.fontFamily = 'Arial;}</style><script>alert(1)</script>'
    expect(isResumeDocument(badFont)).toBe(false)
    const badSize = createDefaultDocument()
    badSize.theme.fontSize = 1e9
    expect(isResumeDocument(badSize)).toBe(false)
  })

  it('accepts the legacy one-page mode for backward compatibility', () => {
    const document = createDefaultDocument()
    document.theme.pageMode = 'one-page' as never
    expect(isResumeDocument(document)).toBe(true)
  })
})

describe('shared template styles', () => {
  it('embeds the same template stylesheet the preview uses into exported HTML', () => {
    const html = renderResumeHtml(createDefaultDocument())
    expect(html).toContain(RESUME_TEMPLATE_CSS)
    expect(RESUME_TEMPLATE_CSS).toContain('.resume-page.template-accent')
  })
})
