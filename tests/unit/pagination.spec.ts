import { createDefaultDocument } from '@/domain/resume/defaults'
import {
  applyItemSplits,
  computeItemSplits,
  MAX_FIT_FACTOR,
  MIN_FIT_FACTOR,
  nextFitFactor,
  normalizePageMode,
  prepareSections,
  splitItemInto,
} from '@/domain/resume/pagination'
import type { ResumeItem } from '@/domain/resume/model'

const makeItem = (overrides: Partial<ResumeItem> = {}): ResumeItem => ({
  id: 'item-1',
  title: '某公司',
  subtitle: '后端开发',
  period: '2022 - 至今',
  location: '西安',
  content: '<p>第一句。第二句。第三句。第四句。</p>',
  bullets: [],
  ...overrides,
})

describe('content preparation before pagination', () => {
  it('drops hidden sections before anything else', () => {
    const document = createDefaultDocument()
    document.sections[0].visible = false
    const sections = prepareSections(document.sections, document.theme)
    expect(sections.some((section) => section.id === document.sections[0].id)).toBe(false)
    expect(sections).toHaveLength(document.sections.length - 1)
  })

  it('keeps a short resume as one section per module', () => {
    const document = createDefaultDocument()
    const sections = prepareSections(document.sections, document.theme)
    expect(sections).toHaveLength(document.sections.length)
    expect(sections.map((section) => section.items.length)).toEqual(
      document.sections.map((section) => section.items.length),
    )
  })

  it('splits an oversized item into continuation entries without losing content', () => {
    const document = createDefaultDocument()
    document.sections[2].items.push({
      id: 'oversized-item',
      title: '超长项目',
      subtitle: '核心开发成员',
      period: '2022.01 - 2024.03',
      location: '深圳',
      content: `<p>${'负责复杂业务模块和系统交付，持续优化服务稳定性。'.repeat(120)}</p>`,
      bullets: [],
    })
    const sections = prepareSections(document.sections, document.theme)
    const ids = sections.flatMap((section) => section.items.map((item) => item.id))
    expect(ids).toContain('oversized-item')
    expect(ids.some((id) => id.startsWith('oversized-item-cont-'))).toBe(true)
    // 续段 id 必须唯一，否则渲染时会互相覆盖
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps the item heading only on the first fragment', () => {
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
    const sections = prepareSections(document.sections, document.theme)
    const fragments = sections
      .flatMap((section) => section.items)
      .filter((item) => item.id.startsWith('oversized-item'))
    expect(fragments.length).toBeGreaterThan(1)
    expect(fragments[0].title).toBe('超长项目')
    for (const fragment of fragments.slice(1)) {
      expect(fragment.title).toBe('超长项目（续）')
      expect(fragment.bullets.length).toBeGreaterThan(0)
    }
  })

  it('does not pre-split when the user forced one page', () => {
    const document = createDefaultDocument()
    document.theme.pageMode = 'one-page-strict'
    document.sections[2].items.push({
      id: 'oversized-item',
      title: '超长项目',
      subtitle: '核心开发成员',
      period: '2022.01 - 2024.03',
      location: '深圳',
      content: `<p>${'负责复杂业务模块和系统交付。'.repeat(200)}</p>`,
      bullets: [],
    })
    const sections = prepareSections(document.sections, document.theme)
    const item = sections
      .flatMap((section) => section.items)
      .find((it) => it.id === 'oversized-item')
    expect(item).toBeDefined()
    expect(
      sections.flatMap((section) => section.items).filter((it) => it.id.includes('cont')).length,
    ).toBe(0)
  })

  it('normalizes the legacy one-page page mode', () => {
    expect(normalizePageMode('one-page')).toBe('one-page-strict')
    expect(normalizePageMode(undefined)).toBe('standard')
    expect(normalizePageMode('one-page-preferred')).toBe('one-page-preferred')
  })
})

describe('splitting an item that is taller than a page', () => {
  it('splits a long paragraph by sentence boundaries', () => {
    const parts = splitItemInto(makeItem(), 2)
    expect(parts).toHaveLength(2)
    expect(parts[0].id).toBe('item-1')
    expect(parts[0].title).toBe('某公司')
    expect(parts[1].id).toBe('item-1~1')
    expect(parts[1].title).toBe('某公司（续）')
    // 续段不再重复抬头信息，只保留正文
    expect(parts[1].subtitle).toBe('')
    expect(parts[1].period).toBe('')
    const text = parts.map((part) => part.content.replace(/<[^>]*>/g, '')).join('')
    expect(text).toContain('第一句')
    expect(text).toContain('第四句')
  })

  it('falls back to splitting bullets when the paragraph has nothing to cut', () => {
    const item = makeItem({
      content: '<p>一句话。</p>',
      bullets: ['要点一', '要点二', '要点三', '要点四'],
    })
    const parts = splitItemInto(item, 2)
    expect(parts).toHaveLength(2)
    expect(parts[0].bullets).toEqual(['要点一', '要点二'])
    expect(parts[1].bullets).toEqual(['要点三', '要点四'])
  })

  it('does nothing when there is nothing to split', () => {
    const item = makeItem({ content: '<p>一句话。</p>', bullets: [] })
    expect(splitItemInto(item, 2)).toHaveLength(1)
    expect(splitItemInto(makeItem(), 1)).toHaveLength(1)
  })

  it('only targets items taller than a page and keeps 12% headroom', () => {
    const splits = computeItemSplits(
      [
        { sectionId: 'a', headingHeight: 40, itemHeights: [100, 1800, 300] },
        { sectionId: 'b', headingHeight: 40, itemHeights: [] },
      ],
      1000,
    )
    expect(splits).toEqual([{ sectionId: 'a', itemIndex: 1, parts: 3 }])
  })

  it('rebuilds sections with the split items in place', () => {
    const sections = [
      {
        id: 'a',
        type: 'experience' as const,
        title: '工作经历',
        visible: true,
        items: [makeItem({ id: 'keep' }), makeItem({ id: 'split' })],
      },
    ]
    const result = applyItemSplits(sections, [{ sectionId: 'a', itemIndex: 1, parts: 2 }])
    expect(result[0].items.map((item) => item.id)).toEqual(['keep', 'split', 'split~1'])
  })

  it('returns the same sections when there is nothing to split', () => {
    const sections = createDefaultDocument().sections
    expect(applyItemSplits(sections, [])).toBe(sections)
  })
})

describe('fitting content to a fixed page count', () => {
  it('stops once the page count matches', () => {
    expect(nextFitFactor(1, 2, 2, 1000, 500)).toBeNull()
  })

  it('keeps shrinking when there are too many pages — no human floor', () => {
    // 两页内容要求一页：下一轮大约压到 0.5
    const next = nextFitFactor(1, 2, 1, 2000, 1000)
    expect(next).not.toBeNull()
    expect(next as number).toBeLessThan(0.6)
    // 还没到下限，可以继续压
    expect(next as number).toBeGreaterThan(MIN_FIT_FACTOR)
  })

  it('stops when it cannot get smaller than the floor', () => {
    expect(nextFitFactor(MIN_FIT_FACTOR, 3, 1, 3000, 900)).toBeNull()
  })

  it('grows the type when content is shorter than the target', () => {
    const next = nextFitFactor(1, 1, 2, 900, 1800)
    expect(next).not.toBeNull()
    expect(next as number).toBeGreaterThan(1)
    expect(next as number).toBeLessThanOrEqual(MAX_FIT_FACTOR)
  })

  it('never exceeds the upper bound', () => {
    expect(nextFitFactor(1.2, 1, 2, 100, 5000)).toBeLessThanOrEqual(MAX_FIT_FACTOR)
  })

  it('bails out on degenerate measurements', () => {
    expect(nextFitFactor(1, 2, 1, 0, 1000)).toBeNull()
    expect(nextFitFactor(1, 2, 1, 1000, 0)).toBeNull()
  })
})
