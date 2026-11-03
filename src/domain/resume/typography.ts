/**
 * 简历的字号层级。
 *
 * 一页简历应该一眼能分出四层：栏目标题 > 项目标题 > 项目副标题 > 正文。
 * 之前这些尺寸是各处硬编码的像素值（15px / 12.5px / 11.5px / 继承），
 * 于是「字号」调大以后正文反而比栏目标题还大，导入回来的简历尤其明显。
 *
 * 这里只存**相对基准字号的倍数**，预览、PDF、Word 三个渲染出口都从这一份换算：
 * - CSS 侧写成 `calc(var(--resume-font-size) * ratio)`；
 * - Word 侧用半磅（half-point）：`fontSize * 1.5 * ratio`（1px = 0.75pt，1pt = 2 half-point）。
 *
 * 基准 `--resume-font-size` 就是正文大小，用户调「字号」时看到的是正文变化。
 */
export const TYPE_RATIO = {
  /** 栏目标题（教育经历 / 工作经历） */
  section: 1.2,
  /** 项目标题（公司、学校） */
  itemTitle: 1.1,
  /** 项目副标题（职位、专业、地点） */
  itemSubtitle: 1.04,
  /** 正文与要点 —— 基准字号本身 */
  body: 1,
  /** 头部姓名 */
  name: 2,
  /** 头部目标职位 */
  headline: 1.2,
  /** 头部联系方式 */
  contact: 0.84,
  /** 头部补充信息（年龄/现居） */
  detail: 0.92,
  /** 紧凑模板：栏目字号压一档，但仍高于项目标题 */
  sectionCompact: 1.14,
  /** 紧凑模板：姓名压一档 */
  nameCompact: 1.76,
  /** 紧凑模板：目标职位压一档 */
  headlineCompact: 0.96,
} as const

/** CSS 里可用的 `calc()` 表达式：`calc(var(--resume-font-size) * 1.2)`。 */
export const sizeExpr = (ratio: number): string => `calc(var(--resume-font-size) * ${ratio})`

/** Word 的半磅字号：px → pt → half-point。 */
export const toHalfPoints = (fontSizePx: number, ratio: number): number =>
  Math.max(2, Math.round(fontSizePx * 1.5 * ratio))

/**
 * 一次性算出 Word 用到的全部字号，并**强制**四级层级递增。
 *
 * 半磅取整会在某些基准字号下把相邻两级抹平（例如 15px 时副标题 23.4 与正文 22.5
 * 都会落到 23），所以这里逐级取 max(下一级 + 1)，保证任何字号下都不塌陷。
 */
export interface ResolvedSizes {
  body: number
  subtitle: number
  title: number
  section: number
  name: number
  nameCompact: number
  headline: number
  contact: number
  detail: number
}

export const resolveSizes = (fontSizePx: number): ResolvedSizes => {
  const body = toHalfPoints(fontSizePx, TYPE_RATIO.body)
  const subtitle = Math.max(body + 1, toHalfPoints(fontSizePx, TYPE_RATIO.itemSubtitle))
  const title = Math.max(subtitle + 1, toHalfPoints(fontSizePx, TYPE_RATIO.itemTitle))
  const section = Math.max(title + 1, toHalfPoints(fontSizePx, TYPE_RATIO.section))
  return {
    body,
    subtitle,
    title,
    section,
    name: Math.max(section + 2, toHalfPoints(fontSizePx, TYPE_RATIO.name)),
    nameCompact: Math.max(section + 1, toHalfPoints(fontSizePx, TYPE_RATIO.nameCompact)),
    headline: Math.max(body + 1, toHalfPoints(fontSizePx, TYPE_RATIO.headline)),
    contact: toHalfPoints(fontSizePx, TYPE_RATIO.contact),
    detail: toHalfPoints(fontSizePx, TYPE_RATIO.detail),
  }
}
