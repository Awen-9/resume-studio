import { TYPE_RATIO, resolveSizes, sizeExpr, toHalfPoints } from '@/domain/resume/typography'

describe('resume typography scale', () => {
  it('keeps the four levels strictly decreasing', () => {
    expect(TYPE_RATIO.section).toBeGreaterThan(TYPE_RATIO.itemTitle)
    expect(TYPE_RATIO.itemTitle).toBeGreaterThan(TYPE_RATIO.itemSubtitle)
    expect(TYPE_RATIO.itemSubtitle).toBeGreaterThan(TYPE_RATIO.body)
  })

  it('keeps the compact template hierarchy intact', () => {
    // 紧凑模板只压栏目标题，不能压到比项目标题还小
    expect(TYPE_RATIO.sectionCompact).toBeGreaterThan(TYPE_RATIO.itemTitle)
    expect(TYPE_RATIO.nameCompact).toBeGreaterThan(TYPE_RATIO.section)
  })

  it('produces calc() expressions on the page font size', () => {
    expect(sizeExpr(TYPE_RATIO.section)).toContain('var(--resume-font-size)')
    expect(sizeExpr(TYPE_RATIO.section)).toContain('1.2')
  })

  it('keeps the Word half-point sizes ordered at any base size', () => {
    // 半磅取整会在某些字号下把相邻两级抹平（15px 时副标题与正文都落到 23），
    // resolveSizes 负责兜住这个塌陷
    for (const base of [8, 10, 11, 12.5, 13, 15, 16, 18, 20]) {
      const sizes = resolveSizes(base)
      expect(sizes.section).toBeGreaterThan(sizes.title)
      expect(sizes.title).toBeGreaterThan(sizes.subtitle)
      expect(sizes.subtitle).toBeGreaterThan(sizes.body)
      expect(sizes.name).toBeGreaterThan(sizes.section)
      expect(sizes.nameCompact).toBeGreaterThan(sizes.section)
    }
  })

  it('scales the Word sizes with the user font size', () => {
    // 之前 Word 里字号是写死的半磅值，调「字号」不影响导出的 Word
    expect(toHalfPoints(18, TYPE_RATIO.body)).toBeGreaterThan(toHalfPoints(12.5, TYPE_RATIO.body))
  })
})
