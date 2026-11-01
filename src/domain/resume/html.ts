/**
 * 富文本 HTML 工具：转义、实体解码、清洗和纯文本提取。
 *
 * 前端预览与 Node 端导出共用，不依赖 DOM，保证两端处理结果一致。
 */

/** HTML 转义，防止用户输入的内容破坏文档结构或注入脚本。 */
export const escapeHtml = (value: string): string => {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

/** 解码富文本中常见的命名实体和数字实体，未知实体原样保留。 */
export const decodeHtmlEntities = (value: string): string => {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
    if (body[0] !== '#') return NAMED_ENTITIES[body.toLowerCase()] ?? entity
    const codePoint =
      body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
    return Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : entity
  })
}

const ALLOWED_TAGS = new Set(['p', 'strong', 'em', 'ul', 'ol', 'li', 'br'])

/**
 * 清洗富文本 HTML。
 *
 * 不做「删除危险部分」，而是重建输出：白名单标签（`p`、`strong`、`em`、`ul`、`ol`、`li`、`br`）
 * 一律输出为不带任何属性的规范标签，其他标签丢弃，标签之外残留的 `<`、`>` 转义为文本。
 * 因此输出中不可能出现属性或事件处理器，`<p/onclick=...>` 这类写法也无法绕过。
 */
export const sanitizeRichHtml = (value: string): string => {
  let result = ''
  let cursor = 0
  const source = value.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
  for (const match of source.matchAll(/<(\/?)([a-z][a-z0-9]*)\b[^>]*>/gi)) {
    result += source.slice(cursor, match.index).replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    cursor = match.index + match[0].length
    const tag = match[2].toLowerCase()
    if (!ALLOWED_TAGS.has(tag)) continue
    if (tag === 'br') result += match[1] ? '' : '<br>'
    else result += `<${match[1]}${tag}>`
  }
  return result + source.slice(cursor).replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/**
 * 提取富文本中的纯文本。基于字符串处理而非 `innerHTML`，
 * 避免把不可信内容交给浏览器解析时触发 `<img onerror>` 之类的脚本。
 */
export const stripHtml = (html: string): string => {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}
