// @vitest-environment node

import { parseResumeText } from '../../src/domain/resume/importParser'
import { extractDocxText, htmlToTextLines } from '../../server/services/docxTextExtractor'
import { buildResumeDocx } from '../helpers/docxFixture'

describe('word import', () => {
  it('turns block tags into one line per paragraph and keeps list markers', () => {
    const html = '<h2>工作经历</h2><p>第一段</p><ul><li>要点一</li><li>要点二</li></ul>'
    expect(htmlToTextLines(html)).toBe('工作经历\n第一段\n- 要点一\n- 要点二')
  })

  it('keeps table cells separated instead of gluing them together', () => {
    const html = '<table><tr><td>某某公司</td><td>2022.07 - 至今</td></tr></table>'
    expect(htmlToTextLines(html)).toBe('某某公司 | 2022.07 - 至今')
  })

  it('extracts text from a generated .docx', async () => {
    const { text } = await extractDocxText(await buildResumeDocx())
    expect(text).toContain('张三')
    expect(text).toContain('工作经历')
    expect(text).toContain('某某科技有限公司')
    expect(text.split('\n').length).toBeGreaterThan(5)
  })

  it('feeds the shared parser so a Word resume becomes sections', async () => {
    const { text } = await extractDocxText(await buildResumeDocx())
    const result = parseResumeText(text, '张三.docx')
    const titles = result.document.sections.map((section) => section.title)
    expect(titles).toEqual(expect.arrayContaining(['工作经历', '教育经历', '专业技能']))
    expect(result.document.profile.name).toBe('张三')
    expect(result.document.profile.phone).toContain('13800000000')
    expect(result.document.profile.email).toContain('zhangsan@example.com')
  })
})
