import { describe, expect, it } from 'vitest'
import { planFragments, type SectionMetrics } from '@/domain/resume/layout'

const section = (id: string, heading: number, items: number[]): SectionMetrics => ({
  sectionId: id,
  headingHeight: heading,
  itemHeights: items,
})

describe('page planning', () => {
  it('returns a single empty page when there is nothing to place', () => {
    expect(planFragments([], [1000]).pages).toEqual([[]])
  })

  it('keeps a fitting section on one page as a single fragment', () => {
    const plan = planFragments([section('a', 50, [200, 200])], [1000])
    expect(plan.pages).toEqual([[{ sectionId: 'a', start: 0, end: 2 }]])
    expect(plan.overflowPages).toEqual([])
  })

  it('splits a section across pages instead of leaving a blank gap', () => {
    // 标题 50 + 4 条各 300，一页 1000：首页能放标题+3条（950），第 4 条去下一页
    const plan = planFragments([section('a', 50, [300, 300, 300, 300])], [1000])
    expect(plan.pages).toHaveLength(2)
    expect(plan.pages[0]).toEqual([{ sectionId: 'a', start: 0, end: 3 }])
    // 续页重新带上标题，只放剩下的条目
    expect(plan.pages[1]).toEqual([{ sectionId: 'a', start: 3, end: 4 }])
    expect(plan.overflowPages).toEqual([])
  })

  it('never leaves a section heading alone at the bottom of a page', () => {
    // 首页剩余空间只够标题、放不下第一条 → 整段换页
    const plan = planFragments([section('a', 100, [500]), section('b', 100, [500])], [1000])
    expect(plan.pages[0]).toEqual([{ sectionId: 'a', start: 0, end: 1 }])
    expect(plan.pages[1]).toEqual([{ sectionId: 'b', start: 0, end: 1 }])
  })

  it('subtracts the header only from the first page', () => {
    const plan = planFragments([section('a', 100, [500]), section('b', 100, [500])], [600, 1000])
    expect(plan.pages).toHaveLength(2)
    expect(plan.pages[0][0].sectionId).toBe('a')
    expect(plan.pages[1][0].sectionId).toBe('b')
  })

  it('puts an oversized item on its own page and flags the overflow', () => {
    const plan = planFragments([section('a', 50, [300, 1600, 200])], [1000])
    expect(plan.overflowPages).toEqual([2])
    const placed = plan.pages.flat().flatMap((fragment) =>
      Array.from({ length: fragment.end - fragment.start }, (_, index) => ({
        id: fragment.sectionId,
        index: fragment.start + index,
      })),
    )
    expect(placed).toEqual([
      { id: 'a', index: 0 },
      { id: 'a', index: 1 },
      { id: 'a', index: 2 },
    ])
  })

  it('keeps module order and never loses an item', () => {
    const plan = planFragments(
      [section('a', 40, [200, 200, 200]), section('b', 40, [200]), section('c', 40, [200])],
      [500],
    )
    const covered = plan.pages
      .flat()
      .map((fragment) => `${fragment.sectionId}:${fragment.start}-${fragment.end}`)
    expect(covered).toEqual(['a:0-2', 'a:2-3', 'b:0-1', 'c:0-1'])
  })

  it('renders the heading even for an empty section', () => {
    const plan = planFragments([section('empty', 60, [])], [1000])
    expect(plan.pages).toEqual([[]])
    expect(plan.overflowPages).toEqual([])
  })
})

describe('fixed page count', () => {
  it('keeps natural spacing when no target is set', () => {
    const plan = planFragments([section('a', 40, [200, 200])], [1000])
    expect(plan.stretch).toEqual([0])
  })

  it('spreads a one-page resume over two pages and fills them', () => {
    // 自然排 1 页；固定 2 页后应拆成 2 页，并给每页算出撑开间距
    const plan = planFragments([section('a', 40, [300, 300, 300])], [1000, 1000], 2)
    expect(plan.pages).toHaveLength(2)
    expect(plan.pages.flat().length).toBeGreaterThan(1)
    // 至少有一页需要撑开，否则页底就会留白
    expect(plan.stretch.some((value) => value > 0)).toBe(true)
    // 撑开有上限，不能变成大缝隙
    expect(Math.max(...plan.stretch)).toBeLessThanOrEqual(36)
  })

  it('keeps the item order when distributing', () => {
    const plan = planFragments([section('a', 40, [300, 300, 300, 300])], [1000, 1000], 2)
    const covered = plan.pages
      .flat()
      .map((fragment) => `${fragment.sectionId}:${fragment.start}-${fragment.end}`)
    expect(covered.join('|')).toBe('a:0-2|a:2-4')
  })

  it('falls back to the natural layout when the content needs more pages than the target', () => {
    // 3 页内容要求压成 2 页：排版层不做压缩，交给调用方缩字号
    const plan = planFragments([section('a', 40, [600, 600, 600])], [700], 2)
    expect(plan.pages.length).toBeGreaterThan(2)
    expect(plan.stretch.every((value) => value === 0)).toBe(true)
  })

  it('clamps an impossible target to the number of items', () => {
    const plan = planFragments([section('a', 40, [300, 300])], [1000], 6)
    expect(plan.pages.length).toBeLessThanOrEqual(2)
  })
})
