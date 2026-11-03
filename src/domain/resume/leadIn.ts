/**
 * 正文里「标签：内容」这种写法的加粗处理。
 *
 * 简历正文常写成「多 Agent 架构：设计……」——标签是视觉锚点，原文件里本来就是加粗的。
 * 但 PDF 提取只拿到纯文本，加粗信息在导入时已经丢了；让用户逐条手动加粗不现实。
 *
 * 所以这里在渲染时统一处理：**段落以「短标签：」开头时，把标签和冒号加粗**。
 * 规则刻意保守，避免把普通句子开头误当成标签：
 * - 标签以字母或汉字开头（数字/标点开头的不算，`2024-至今：` 不会被加粗）；
 * - 标签 2–12 个字符，且不含句号、分号、逗号、顿号这类句子内的标点；
 * - 冒号后面必须还有内容，空标签不处理；
 * - 段落已经以 `<strong>` 开头时不再重复处理。
 */

/** 标签部分：首字符是字母/汉字，后面不允许出现句子内标点。 */
export const LEAD_IN_PATTERN = /^([A-Za-z\u4e00-\u9fa5][^：:。；;，,、]{1,11})([：:])/

/** 把纯文本拆成「标签 + 冒号」与「其余内容」；不是标签写法时返回 null。 */
export const splitLeadIn = (text: string): { lead: string; rest: string } | null => {
  const match = LEAD_IN_PATTERN.exec(text)
  if (!match) return null
  const lead = `${match[1]}${match[2]}`
  const rest = text.slice(lead.length)
  if (!rest.trim()) return null
  return { lead, rest }
}

/**
 * 对富文本 HTML 做标签加粗。
 *
 * 只处理**直接以文字开头**的 `<p>`：段落里带别的标签时不动，避免和用户自己的
 * 加粗/斜体打架。输入应当是已经清洗过的 HTML（标签只会是白名单里的那几个）。
 */
export const emphasizeLeadInHtml = (html: string): string =>
  html.replace(/<p>([^<][\s\S]*?)<\/p>/g, (whole, inner: string) => {
    const split = splitLeadIn(inner)
    if (!split) return whole
    return `<p><strong>${split.lead}</strong>${split.rest}</p>`
  })
