import { createDefaultDocument } from '@/data/defaultResume'
import { paginateSections } from '@/lib/pagination'

describe('resume pagination', () => {
  it('keeps a short resume on one page', () => {
    const document = createDefaultDocument()
    const pages = paginateSections(document.sections, document.theme)
    expect(pages.length).toBe(1)
  })

  it('splits a long resume into multiple pages without losing content', () => {
    const document = createDefaultDocument()
    for (let index = 0; index < 10; index += 1) {
      document.sections[2].items.push({
        id: `long-${index}`,
        title: `项目 ${index}`,
        subtitle: '核心开发成员',
        period: '2023.01 - 2024.03',
        location: '上海',
        content: `<p>${'负责复杂业务模块和系统交付。'.repeat(40)}</p>`,
        bullets: ['优化服务稳定性和可维护性', '完善自动化测试和发布流程'],
      })
    }
    const pages = paginateSections(document.sections, document.theme)
    const itemIds = pages.flatMap((page) =>
      page.sections.flatMap((section) => section.items.map((item) => item.id)),
    )
    expect(pages.length).toBeGreaterThan(1)
    expect(new Set(itemIds).size).toBe(itemIds.length)
    expect(itemIds).toContain('long-9')
  })

  it('ignores hidden sections', () => {
    const document = createDefaultDocument()
    document.sections[0].visible = false
    const pages = paginateSections(document.sections, document.theme)
    expect(
      pages
        .flatMap((page) => page.sections)
        .some((section) => section.id === document.sections[0].id),
    ).toBe(false)
  })

  it('starts one-page mode from a single compact page', () => {
    const document = createDefaultDocument()
    document.theme.pageMode = 'one-page'
    for (let index = 0; index < 6; index += 1) document.sections.push(document.sections[0])
    const pages = paginateSections(document.sections, document.theme)
    expect(pages).toHaveLength(1)
    expect(pages[0].sections).toHaveLength(document.sections.length)
  })
})
