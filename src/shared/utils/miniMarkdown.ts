/**
 * 极简 Markdown 渲染（只用于面试答案展示）。
 *
 * 为什么不用 marked/intentionally 完整解析器：答案内容来自本机模型，
 * 只需要「标题、加粗、行内代码、列表」这四种排版能力，多引一个依赖不值得。
 *
 * 安全：先整体 HTML 转义，再只把 `**粗体**`、`` `代码` `` 与换行转成标签，
 * 模型输出的原始 HTML 不会被执行。
 */
const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const renderAnswerHtml = (text: string): string => {
  if (!text) return ''
  const escaped = escapeHtml(text)

  return (
    escaped
      // ### 小标题 / **小标题** 形式的分段
      .replace(/^###\s*(.+)$/gm, '<h4 class="answer-h">$1</h4>')
      .replace(/^\*\*(.+?)\*\*\s*$/gm, '<h4 class="answer-h">$1</h4>')
      // 行内加粗与代码
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // 列表项统一成带圆点的行
      .replace(/^\s*[-*]\s+/gm, '• ')
      // 换行保留：答案里分点靠换行表达
      .replace(/\n/g, '<br>')
  )
}
