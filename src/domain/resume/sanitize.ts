/**
 * 清洗富文本 HTML，只保留白名单标签，**属性一律丢弃**。
 *
 * 这里不能继续用「黑名单正则删 on* 属性」的做法：`<li/onclick="…">` 这种写法里
 * `onclick` 前面没有空格，正则匹配不到，而浏览器的 HTML 解析器会把 `/` 之后的部分
 * 当成属性名，于是清洗后仍然可执行。所以改成词法解析：认出标签名，白名单内的
 * 重新序列化成「无属性的裸标签」，白名单外的一律丢弃。
 *
 * 白名单：`p`、`strong`、`em`、`ul`、`ol`、`li`、`br`。
 * 文本里只转义 `<`，已存在的实体（`&amp;` 等）保持原样，避免二次转义。
 *
 * 这是**浏览器侧**的轻量实现（零依赖、不打进前端包）。服务端导出换用
 * `server/services/sanitizeRichHtml.ts` 的 sanitize-html 实现，两个实现的白名单一致，
 * 对合法内容输出相同，不会造成预览/导出漂移。
 */
const ALLOWED_TAGS: ReadonlySet<string> = new Set(['p', 'strong', 'em', 'ul', 'ol', 'li', 'br'])

/** 找到标签结束的 `>`，跳过引号内的内容（属性值里可能出现 `>`）。 */
const findTagEnd = (value: string, start: number): number => {
  let quote: string | null = null
  for (let index = start + 1; index < value.length; index += 1) {
    const char = value[index]
    if (quote) {
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '>') return index
  }
  return -1
}

type TagToken =
  | { kind: 'tag'; name: string; closing: boolean }
  /** 看着像标签但不在白名单：整段丢弃（`<script>`、`<img ...>`）。 */
  | { kind: 'drop' }
  /** 根本不是标签（`a < b 且 c > d`）：转义 `<` 并继续当文本处理。 */
  | { kind: 'text' }

/** 从尖括号里的内容解析出标签名；注释、声明、非法写法都返回 null（整段丢弃）。 */
const parseTagToken = (inner: string): TagToken => {
  // HTML 里 `<` 后面紧跟空白就不是标签，属于普通文本（也是保留比较运算符的关键）
  if (inner.startsWith('!')) return { kind: 'drop' }
  const match = /^(\/?)([a-zA-Z][a-zA-Z0-9]*)/.exec(inner)
  if (!match) return { kind: 'text' }
  const name = match[2].toLowerCase()
  if (!ALLOWED_TAGS.has(name)) return { kind: 'drop' }
  return { kind: 'tag', name, closing: match[1] === '/' }
}

export const sanitizeRichHtml = (value: string): string => {
  if (!value) return ''
  const escapeText = (text: string): string => text.replace(/</g, '&lt;')
  let output = ''
  let index = 0
  while (index < value.length) {
    const open = value.indexOf('<', index)
    if (open < 0) {
      output += escapeText(value.slice(index))
      break
    }
    output += escapeText(value.slice(index, open))
    const close = findTagEnd(value, open)
    // 没有闭合的 `<` 当普通文本处理，避免把后面所有内容吞掉
    if (close < 0) {
      output += escapeText(value.slice(open))
      break
    }
    const token = parseTagToken(value.slice(open + 1, close))
    if (token.kind === 'text') {
      output += '&lt;'
      index = open + 1
      continue
    }
    if (token.kind === 'tag') {
      if (token.name === 'br') {
        if (!token.closing) output += '<br />'
      } else {
        output += token.closing ? `</${token.name}>` : `<${token.name}>`
      }
    }
    index = close + 1
  }
  return output
}
