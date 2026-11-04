/**
 * HTML 转义（五字符版）。
 *
 * 模板渲染和 PDF 文本解析都需要把用户内容安全地放进 HTML；这两处原本各有一份
 * 完全相同的实现，合并到这里，避免以后只改一处导致渲染结果不一致。
 *
 * 编辑器预览和 miniMarkdown 的转义范围不同（只转 `& < >` 或多转 `"`），
 * 不要在那些地方换成这个版本，否则输出字符串会变。
 */
export const escapeHtml = (value: string): string => {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
