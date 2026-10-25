import { createDefaultDocument } from '@/data/defaultResume'
import { checkResumeBeforeExport } from '@/lib/resumeChecks'

describe('export readiness checks', () => {
  it('blocks export when required identity or layout is invalid', () => {
    const document = createDefaultDocument()
    const issues = checkResumeBeforeExport(document, {
      pageCount: 2,
      overflowPages: [2],
      ready: true,
    })
    expect(
      issues.some((issue) => issue.code === 'missing-name' && issue.severity === 'error'),
    ).toBe(true)
    expect(
      issues.some((issue) => issue.code === 'page-overflow' && issue.severity === 'error'),
    ).toBe(true)
  })

  it('reports a clean resume as ready', () => {
    const document = createDefaultDocument()
    document.profile.name = '测试用户'
    const issues = checkResumeBeforeExport(document, {
      pageCount: 1,
      overflowPages: [],
      ready: true,
    })
    expect(issues).toEqual([
      { code: 'ready', severity: 'success', message: '内容和分页检查通过，可以导出。' },
    ])
  })

  it('warns when one-page mode still has multiple pages', () => {
    const document = createDefaultDocument()
    document.profile.name = '测试用户'
    document.theme.pageMode = 'one-page'
    const issues = checkResumeBeforeExport(document, {
      pageCount: 2,
      overflowPages: [],
      ready: true,
    })
    expect(issues.some((issue) => issue.code === 'one-page-missed')).toBe(true)
  })
})
