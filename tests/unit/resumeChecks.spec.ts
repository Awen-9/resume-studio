import { createDefaultDocument } from '@/domain/resume/defaults'
import { checkResumeBeforeExport } from '@/domain/resume/checks'

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
      // 预览不再裁剪内容（页面会长高），溢出只影响导出的分页位置，因此是 warning
      issues.some((issue) => issue.code === 'page-overflow' && issue.severity === 'warning'),
    ).toBe(true)
  })

  it('reports a clean resume as ready', () => {
    const document = createDefaultDocument()
    document.profile.name = '测试用户'
    // 让默认的经历内容带量化，避免质量提醒干扰「clean」判断
    for (const section of document.sections) {
      if (section.type === 'experience' || section.type === 'project') {
        for (const item of section.items) {
          if (!item.content) item.content = '<p>主导系统改造，支撑峰值 10 万 QPS</p>'
          if (item.bullets.length > 0)
            item.bullets = item.bullets.map(() => '优化索引，P99 从 480ms 降到 90ms')
        }
      }
    }
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
    document.theme.pageMode = 'one-page-strict'
    const issues = checkResumeBeforeExport(document, {
      pageCount: 2,
      overflowPages: [],
      ready: true,
    })
    expect(issues.some((issue) => issue.code === 'one-page-missed')).toBe(true)
  })

  it('warns when a fixed page count is not reached', () => {
    const document = createDefaultDocument()
    document.profile.name = '测试用户'
    document.theme.targetPages = 2
    const issues = checkResumeBeforeExport(document, {
      pageCount: 3,
      overflowPages: [],
      ready: true,
    })
    expect(issues.some((issue) => issue.code === 'fixed-pages-missed')).toBe(true)
  })

  it('warns when experience content lacks quantification or uses weak verbs', () => {
    const document = createDefaultDocument()
    document.profile.name = '测试用户'
    const work = document.sections.find((section) => section.type === 'experience')
    if (work) {
      work.items[0].content = '<p>负责订单系统的稳定性建设与性能优化</p>'
      work.items[0].bullets = ['做了订单系统的日常维护']
    }
    const issues = checkResumeBeforeExport(document, {
      pageCount: 1,
      overflowPages: [],
      ready: true,
    })
    expect(issues.some((issue) => issue.code === 'no-quantified-result')).toBe(true)
    expect(issues.some((issue) => issue.code === 'weak-verb')).toBe(true)
  })

  it('keeps quiet when experience content is quantified and verb-led', () => {
    const document = createDefaultDocument()
    document.profile.name = '测试用户'
    const work = document.sections.find((section) => section.type === 'experience')
    if (work) {
      work.items[0].content = '<p>主导订单系统改造，支撑峰值 10 万 QPS</p>'
      work.items[0].bullets = ['优化查询索引，P99 从 480ms 降到 90ms']
    }
    const issues = checkResumeBeforeExport(document, {
      pageCount: 1,
      overflowPages: [],
      ready: true,
    })
    expect(issues.some((issue) => issue.code === 'no-quantified-result')).toBe(false)
    expect(issues.some((issue) => issue.code === 'weak-verb')).toBe(false)
  })

  it('stays quiet when the fixed page count matches', () => {
    const document = createDefaultDocument()
    document.profile.name = '测试用户'
    document.theme.targetPages = 2
    const issues = checkResumeBeforeExport(document, {
      pageCount: 2,
      overflowPages: [],
      ready: true,
    })
    expect(issues.some((issue) => issue.code === 'fixed-pages-missed')).toBe(false)
  })

  it('normalizes the legacy one-page value to one-page-strict', () => {
    const document = createDefaultDocument()
    document.profile.name = '测试用户'
    // 模拟旧数据仍携带历史遗留值 'one-page'。
    document.theme.pageMode = 'one-page' as never
    const issues = checkResumeBeforeExport(document, {
      pageCount: 2,
      overflowPages: [],
      ready: true,
    })
    expect(issues.some((issue) => issue.code === 'one-page-missed')).toBe(true)
  })
})
