import { createDefaultDocument } from '@/domain/resume/defaults'
import { paginateSections } from '@/domain/resume/pagination'

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
    document.theme.pageMode = 'one-page-strict'
    for (let index = 0; index < 6; index += 1) document.sections.push(document.sections[0])
    const pages = paginateSections(document.sections, document.theme)
    expect(pages).toHaveLength(1)
    expect(pages[0].sections).toHaveLength(document.sections.length)
  })

  it('normalizes the legacy one-page value to one-page-strict', () => {
    const document = createDefaultDocument()
    // 模拟旧数据仍携带历史遗留值 'one-page'。
    document.theme.pageMode = 'one-page' as never
    const pages = paginateSections(document.sections, document.theme)
    expect(pages).toHaveLength(1)
  })

  it('splits a single oversized item across pages without truncation', () => {
    const document = createDefaultDocument()
    // 制造一条自身就超过一页容量的超长内容块。
    document.sections[2].items.push({
      id: 'oversized-item',
      title: '超长项目',
      subtitle: '核心开发成员',
      period: '2022.01 - 2024.03',
      location: '深圳',
      content: `<p>${'负责复杂业务模块和系统交付，持续优化服务稳定性。'.repeat(120)}</p>`,
      bullets: [],
    })
    const pages = paginateSections(document.sections, document.theme)
    const itemIds = pages.flatMap((page) =>
      page.sections.flatMap((section) => section.items.map((item) => item.id)),
    )
    // 拆分后的续段 id 带 -cont- 后缀，且原始 id 仍保留在第一段。
    expect(itemIds).toContain('oversized-item')
    expect(itemIds.some((id) => id.startsWith('oversized-item-cont-'))).toBe(true)
    // 不能有内容被硬丢弃：所有续段 id 唯一。
    expect(new Set(itemIds).size).toBe(itemIds.length)
  })

  it('keeps oversized item heading only on the first fragment', () => {
    const document = createDefaultDocument()
    document.sections[2].items.push({
      id: 'oversized-item',
      title: '超长项目',
      subtitle: '核心开发成员',
      period: '2022.01 - 2024.03',
      location: '深圳',
      content: `<p>${'负责复杂业务模块和系统交付。'.repeat(200)}</p>`,
      bullets: [],
    })
    const pages = paginateSections(document.sections, document.theme)
    const allItems = pages.flatMap((page) => page.sections.flatMap((section) => section.items))
    const fragments = allItems.filter((item) => item.id.startsWith('oversized-item'))
    expect(fragments[0].title).toBe('超长项目')
    expect(fragments[0].content).toBeTruthy()
    for (const fragment of fragments.slice(1)) {
      expect(fragment.title).toBe('超长项目（续）')
      expect(fragment.content).toBe('')
      expect(fragment.bullets.length).toBeGreaterThan(0)
    }
  })
})
