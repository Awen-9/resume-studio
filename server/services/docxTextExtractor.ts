import mammoth from 'mammoth'

/**
 * Word（.docx）文字提取。
 *
 * 和 PDF 不同，docx 里本来就有结构：标题样式、列表、表格。直接抽纯文本会把它们
 * 拍平，这里先把文档转成 HTML，再按「块级标签换行、列表项加 `- `、表格单元格用 `|` 分隔」
 * 还原成带标记的文本行，交给与 PDF 共用的解析器（它认识 `- ` 要点和竖线分隔）。
 *
 * 只支持 .docx（OOXML zip）；老的 .doc 是二进制格式，明确报错让用户另存。
 */
export interface DocxTextExtraction {
  text: string
  /** mammoth 在转换过程中给出的告警（例如不支持的样式），透传给导入确认页。 */
  warnings: string[]
}

const BLOCK_END = /<\/(p|h[1-6]|li|tr|div|blockquote)>/gi

const decodeEntities = (value: string): string =>
  value
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')

/** 把 mammoth 输出的 HTML 还原成「一行一段、要点带 `- `」的文本。 */
export const htmlToTextLines = (html: string): string =>
  decodeEntities(
    html
      // 列表项：先变成独立一行的要点，解析器才认得出
      .replace(/<li[^>]*>/gi, '\n- ')
      .replace(/<\/td>/gi, ' | ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(BLOCK_END, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) =>
      line
        .replace(/[ \t]+/g, ' ')
        .replace(/\s*\|\s*$/, '')
        .trim(),
    )
    .filter((line) => line.length > 0)
    .join('\n')

export const extractDocxText = async (buffer: Buffer): Promise<DocxTextExtraction> => {
  const result = await mammoth.convertToHtml({ buffer })
  const warnings = result.messages
    .filter((message) => message.type === 'warning')
    .map((message) => message.message)
  return { text: htmlToTextLines(result.value), warnings }
}
