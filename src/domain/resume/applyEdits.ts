import { stripHtml } from './validation'
import type { ResumeDocument } from './model'

/**
 * 把 AI 改写建议应用到简历文档。
 *
 * 模型给的 `before` 是纯文本短句，但文档里的 content 是 HTML。
 * 这里只做安全的替换：要点（纯文本）直接替换；正文只处理「单段 <p>」或纯文本的常见情况，
 * 复杂结构标记为失败，交给用户手动改，绝不把 HTML 弄乱。
 */

export interface ResumeEdit {
  before: string
  after: string
  reason: string
}

export interface ApplyEditsResult {
  applied: number
  failed: ResumeEdit[]
}

const normalize = (text: string): string => stripHtml(text).replace(/\s+/g, ' ').trim()

/** 正文只有一个 <p> 段落时，在段落内替换并保留标签。 */
const replaceInContent = (content: string, before: string, after: string): string | null => {
  if (!content.includes('<')) {
    return content.replace(before, after)
  }
  const singleParagraph = content.match(/^\s*<p>([\s\S]*?)<\/p>\s*$/)
  // 非贪婪匹配仍可能跨过中间的 </p><p>，必须排除捕获内容里还有 <p>
  if (
    singleParagraph &&
    !singleParagraph[1].includes('<p') &&
    singleParagraph[1].includes(before)
  ) {
    return `<p>${singleParagraph[1].replace(before, after)}</p>`
  }
  return null
}

export const applyResumeEdits = (
  document: ResumeDocument,
  edits: ResumeEdit[],
): ApplyEditsResult => {
  let applied = 0
  const failed: ResumeEdit[] = []

  for (const edit of edits) {
    const before = normalize(edit.before)
    if (!before) {
      failed.push(edit)
      continue
    }
    let done = false

    for (const section of document.sections) {
      for (const item of section.items) {
        // 1) 要点：纯文本，直接替换
        for (let index = 0; index < item.bullets.length; index += 1) {
          if (item.bullets[index].includes(before)) {
            item.bullets[index] = item.bullets[index].replace(before, edit.after)
            applied += 1
            done = true
            break
          }
        }
        if (done) break

        // 2) 正文：只处理能安全替换的结构
        const replaced = replaceInContent(item.content, before, edit.after)
        if (replaced !== null) {
          item.content = replaced
          applied += 1
          done = true
          break
        }
      }
      if (done) break
    }

    if (!done) failed.push(edit)
  }

  return { applied, failed }
}
