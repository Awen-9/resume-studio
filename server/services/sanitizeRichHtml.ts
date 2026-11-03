import sanitizeHtml from 'sanitize-html'

/**
 * 服务端导出用的富文本清洗器：基于 sanitize-html，只保留白名单标签、丢弃全部属性。
 *
 * 与浏览器侧的 `src/domain/resume/sanitize.ts`（零依赖词法解析）保持同一白名单，
 * 对合法内容输出一致。sanitize-html 体积较大（会连 htmlparser2/postcss 一起进来），
 * 所以**只放在服务端**，避免被打进前端包；`renderer.ts` 通过 `configureRichHtmlSanitizer`
 * 在导出服务启动时把它接进来。
 */
export const SANITIZE_ALLOWED_TAGS = ['p', 'strong', 'em', 'ul', 'ol', 'li', 'br'] as const

export const sanitizeRichHtml = (value: string): string => {
  if (!value) return ''
  return sanitizeHtml(value, {
    allowedTags: [...SANITIZE_ALLOWED_TAGS],
    allowedAttributes: {},
  })
}
