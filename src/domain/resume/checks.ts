import { stripHtml } from './validation.js'
import { normalizePageMode } from './pagination.js'
import type { ResumeDocument } from './model.js'

export type CheckSeverity = 'error' | 'warning' | 'success'

export interface ExportCheckIssue {
  code: string
  severity: CheckSeverity
  message: string
}

export interface ResumeLayoutStatus {
  pageCount: number
  overflowPages: number[]
  ready: boolean
}

const itemHasContent = (item: ResumeDocument['sections'][number]['items'][number]): boolean => {
  return Boolean(
    item.title.trim() ||
    item.subtitle.trim() ||
    item.period.trim() ||
    item.location.trim() ||
    stripHtml(item.content) ||
    item.bullets.some((bullet) => bullet.trim()),
  )
}

/**
 * 内容质量检查：不做「填没填」，只做「写得好不好」。
 *
 * 都是 warning，不阻断导出——这类建议是给求职者的提醒，不是硬性错误。
 */
const hasQuantifier = (text: string): boolean =>
  /\d/.test(text) || /[万亿倍%％]|QPS|TPS|qps|tps|GB|MB|TB|PB/i.test(text)

const WEAK_LEAD = /^(我|本人|做了|进行了|参与了|负责了|从事了)/

const STRONG_LEAD =
  /^(负责|主导|设计|推动|优化|搭建|落地|重构|实现|开发|建设|制定|改进|提升|降低|保障)/

const qualityWarnings = (document: ResumeDocument): ExportCheckIssue[] => {
  const warnings: ExportCheckIssue[] = []
  for (const section of document.sections) {
    if (!section.visible) continue
    if (section.type !== 'experience' && section.type !== 'project') continue

    let unquantified = 0
    let weakBullets = 0
    let longBullets = 0
    for (const item of section.items) {
      const content = stripHtml(item.content)
      const bullets = item.bullets.filter((bullet) => bullet.trim())
      const all = `${content}\n${bullets.join('\n')}`
      if (all.trim() && !hasQuantifier(all)) unquantified += 1
      for (const bullet of bullets) {
        const text = bullet.trim()
        if (WEAK_LEAD.test(text)) weakBullets += 1
        else if (text.length > 0 && !STRONG_LEAD.test(text) && text.length > 30) {
          // 不要求每条都动词开头，但长要点若既不强动词开头也不弱动词，多半是流水账
          longBullets += 1
        }
        if (text.length > 60) longBullets += 1
      }
    }

    const title = section.title || '未命名模块'
    if (unquantified > 0) {
      warnings.push({
        code: 'no-quantified-result',
        severity: 'warning',
        message: `「${title}」有 ${unquantified} 条内容缺少量化结果，建议补充数字（规模、耗时、提升幅度）。`,
      })
    }
    if (weakBullets > 0) {
      warnings.push({
        code: 'weak-verb',
        severity: 'warning',
        message: `「${title}」有 ${weakBullets} 条要点以弱动词开头（如「做了」「参与了」），建议换成「负责 / 主导 / 设计 / 优化」。`,
      })
    }
    if (longBullets > 0) {
      warnings.push({
        code: 'overlong-bullet',
        severity: 'warning',
        message: `「${title}」有 ${longBullets} 条要点过长，建议拆成两条。`,
      })
    }
  }
  return warnings
}

export const checkResumeBeforeExport = (
  document: ResumeDocument,
  layout: ResumeLayoutStatus,
): ExportCheckIssue[] => {
  const issues: ExportCheckIssue[] = []
  const visibleSections = document.sections.filter((section) => section.visible)

  if (!layout.ready) {
    issues.push({
      code: 'layout-pending',
      severity: 'error',
      message: '正在测量 A4 页面，请稍候再导出。',
    })
  }

  if (!document.profile.name.trim() || document.profile.name === '你的姓名') {
    issues.push({ code: 'missing-name', severity: 'error', message: '请先填写真实姓名。' })
  }
  if (!document.profile.phone.trim() && !document.profile.email.trim()) {
    issues.push({
      code: 'missing-contact',
      severity: 'error',
      message: '手机号和邮箱至少填写一项。',
    })
  } else {
    if (!document.profile.phone.trim()) {
      issues.push({ code: 'missing-phone', severity: 'warning', message: '没有填写手机号。' })
    }
    if (!document.profile.email.trim()) {
      issues.push({ code: 'missing-email', severity: 'warning', message: '没有填写邮箱。' })
    }
  }
  if (visibleSections.length === 0) {
    issues.push({ code: 'no-content', severity: 'error', message: '至少显示一个内容模块。' })
  }
  const emptySections = visibleSections.filter((section) => !section.items.some(itemHasContent))
  if (emptySections.length > 0) {
    issues.push({
      code: 'empty-sections',
      severity: 'warning',
      message: `${emptySections.map((section) => section.title || '未命名模块').join('、')}没有填写内容。`,
    })
  }
  if (layout.overflowPages.length > 0) {
    issues.push({
      code: 'page-overflow',
      // 预览不再裁剪内容（页面会长高），所以这只影响导出后的分页位置，属于提醒而非错误
      severity: 'warning',
      message: `第 ${layout.overflowPages.join('、')} 页超出 A4 高度，导出时会自动分到下一页。`,
    })
  }
  if (normalizePageMode(document.theme.pageMode) === 'one-page-strict' && layout.pageCount > 1) {
    issues.push({
      code: 'one-page-missed',
      severity: 'warning',
      message: `一页模式仍生成 ${layout.pageCount} 页，需要精简内容或进一步缩小字号。`,
    })
  } else if (document.theme.targetPages) {
    // 固定页数是「强制」承诺：没达成就要在导出前说清楚，而不是只在预览里提示
    if (layout.pageCount !== document.theme.targetPages) {
      issues.push({
        code: 'fixed-pages-missed',
        severity: 'warning',
        message: `固定 ${document.theme.targetPages} 页，但当前会导出 ${layout.pageCount} 页。`,
      })
    }
  } else if (layout.pageCount > 2) {
    issues.push({
      code: 'long-resume',
      severity: 'warning',
      message: `当前简历共 ${layout.pageCount} 页，建议确认内容是否需要精简。`,
    })
  }

  // 内容质量建议：加在结构检查之后，都是提醒性质
  issues.push(...qualityWarnings(document))

  if (issues.length === 0) {
    issues.push({ code: 'ready', severity: 'success', message: '内容和分页检查通过，可以导出。' })
  }
  return issues
}
