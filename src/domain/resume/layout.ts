/**
 * 分页规划：把「已测量的模块」装进「一页的可用高度」。
 *
 * 这是排版决策的唯一来源。高度怎么量、量在哪个引擎里是调用方的事
 * （浏览器预览由 DOM 实测，导出由无头 Chromium 实测），但**怎么分配到页**只有这一份实现。
 *
 * 两种模式：
 * - 自动：顺序装满每一页，最后剩下的就是最后那页（可能不满）。
 * - 固定页数（`targetPages`）：先找出「恰好 N 页」的每页预算，让内容尽量均摊到 N 页，
 *   再给每页算出需要额外撑开的间距（`stretch`），把页底剩余空间分摊到条目之间——
 *   这样每页都是满的，而不是最后一页留一大片空白。
 */

export interface SectionMetrics {
  sectionId: string
  /** 模块标题占位（含它与上一节之间的间距）。 */
  headingHeight: number
  /** 每条内容占位（含它与上一条之间的间距）。 */
  itemHeights: number[]
}

export interface PageFragment {
  sectionId: string
  /** 本页包含 [start, end) 区间的条目；每页片段都会重新渲染模块标题。 */
  start: number
  end: number
}

export interface FragmentPlan {
  pages: PageFragment[][]
  /** 内容超过页面高度的页序号（从 1 开始）。 */
  overflowPages: number[]
  /** 每页额外撑开的间距（px），用于把页底空余平摊到条目之间；自动模式全为 0。 */
  stretch: number[]
}

interface PackResult {
  pages: PageFragment[][]
  /** 每页已用高度。 */
  used: number[]
  overflowPages: number[]
}

/** 单页最多额外撑开多少间距；再大就不像排版而像凑数了。 */
const MAX_STRETCH = 36

/**
 * 把模块装进页面。
 *
 * `budget` 是每页的「预算高度」：小于物理容量时会更早换页，用来把内容均匀摊到固定页数。
 * 传 `null` 表示按物理容量装满。
 */
const pack = (
  sections: SectionMetrics[],
  capacities: number[],
  budget: number | null,
): PackResult => {
  const pages: PageFragment[][] = [[]]
  const used: number[] = [0]
  const overflowPages: number[] = []
  let pageIndex = 0

  // 页数与高度表可能不等长：越过末尾后沿用最后一页的高度
  const capacityOf = (index: number): number =>
    capacities[Math.min(index, capacities.length - 1)] ?? 0
  const limitOf = (index: number): number => {
    const capacity = capacityOf(index)
    return budget === null ? capacity : Math.min(capacity, budget)
  }

  const startPage = (): void => {
    pageIndex += 1
    pages[pageIndex] = []
    used[pageIndex] = 0
  }

  const markOverflow = (): void => {
    const page = pageIndex + 1
    if (!overflowPages.includes(page)) overflowPages.push(page)
  }

  for (const section of sections) {
    let itemIndex = 0
    // 空模块也要渲染标题，给一条占位高度
    if (section.itemHeights.length === 0) {
      if (used[pageIndex] > 0 && used[pageIndex] + section.headingHeight > limitOf(pageIndex)) {
        startPage()
      }
      used[pageIndex] += section.headingHeight
      if (used[pageIndex] > capacityOf(pageIndex)) markOverflow()
      continue
    }

    while (itemIndex < section.itemHeights.length) {
      // 标题要跟着第一条走：放不下就换页，避免标题孤零零留在页底
      const firstItem = section.itemHeights[itemIndex]
      if (
        used[pageIndex] > 0 &&
        used[pageIndex] + section.headingHeight + firstItem > limitOf(pageIndex)
      ) {
        startPage()
        continue
      }

      used[pageIndex] += section.headingHeight
      if (used[pageIndex] > capacityOf(pageIndex)) markOverflow()

      const start = itemIndex
      while (
        itemIndex < section.itemHeights.length &&
        used[pageIndex] + section.itemHeights[itemIndex] <= limitOf(pageIndex)
      ) {
        used[pageIndex] += section.itemHeights[itemIndex]
        itemIndex += 1
      }

      // 一条都放不下（单条内容自身超过一页）：硬放一条并标记溢出，避免死循环
      if (itemIndex === start) {
        used[pageIndex] += section.itemHeights[itemIndex]
        itemIndex += 1
        markOverflow()
      }

      pages[pageIndex].push({ sectionId: section.sectionId, start, end: itemIndex })
    }
  }

  if (pages.length === 0) pages.push([])
  return { pages, used, overflowPages }
}

/** 一页里可以被「撑开」的间距个数：模块之间 + 同一模块内的条目之间。 */
const countGaps = (fragments: PageFragment[]): number =>
  fragments.reduce(
    (total, fragment, index) =>
      total + (index > 0 ? 1 : 0) + Math.max(0, fragment.end - fragment.start - 1),
    0,
  )

const withStretch = (result: PackResult, capacities: number[]): FragmentPlan => {
  const stretch = result.pages.map((fragments, index) => {
    const slots = countGaps(fragments)
    if (slots === 0) return 0
    const capacity = capacities[Math.min(index, capacities.length - 1)] ?? 0
    const slack = capacity - (result.used[index] ?? 0)
    if (slack <= 0) return 0
    return Math.min(MAX_STRETCH, Math.round((slack / slots) * 10) / 10)
  })
  return { pages: result.pages, overflowPages: result.overflowPages, stretch }
}

/**
 * @param sections     按渲染顺序排列的模块测量结果
 * @param capacities   每页可用高度；只有第 1 页会减去头部占用的高度
 * @param targetPages  固定页数；为空表示按内容自动分页
 */
export const planFragments = (
  sections: SectionMetrics[],
  capacities: number[],
  targetPages?: number | null,
): FragmentPlan => {
  const natural = pack(sections, capacities, null)
  // 自动模式保持原有间距，不做「撑满」
  if (!targetPages) return { ...natural, stretch: natural.pages.map(() => 0) }

  const itemCount = sections.reduce((total, section) => total + section.itemHeights.length, 0)
  // 页数不可能超过「每条内容独占一页」的数量
  const target = Math.min(Math.max(1, Math.round(targetPages)), Math.max(1, itemCount))
  // 内容本身就超过目标页数：调用方应先压缩字号；这里按自然分页返回，页数由上层提示
  if (natural.pages.length > target) {
    return { ...natural, stretch: natural.pages.map(() => 0) }
  }

  // 从较小的预算往上扫：预算越小页数越多，第一个恰好得到 target 页的方案
  // 就是「每页分得最平均」的那个（继续加大预算会让前面几页吃太多、最后一页空着）
  const maxCapacity = Math.max(...capacities)
  const minBudget = maxCapacity * 0.3
  for (let step = 0; step <= 20; step += 1) {
    const budget = minBudget + ((maxCapacity - minBudget) * step) / 20
    const result = pack(sections, capacities, budget)
    if (result.pages.length === target) return withStretch(result, capacities)
    // 预算已经大到页数少于目标：再大只会更少，说明凑不出均摊方案
    if (result.pages.length < target) break
  }

  // 条目粒度太粗，凑不出目标页数：退回自然分页（至少内容不会被切坏）
  return withStretch(natural, capacities)
}
