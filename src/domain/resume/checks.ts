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
      severity: 'error',
      message: `第 ${layout.overflowPages.join('、')} 页内容溢出，可能在 PDF 中被裁切。`,
    })
  }
  if (normalizePageMode(document.theme.pageMode) === 'one-page-strict' && layout.pageCount > 1) {
    issues.push({
      code: 'one-page-missed',
      severity: 'warning',
      message: `一页模式仍生成 ${layout.pageCount} 页，需要精简内容或进一步缩小字号。`,
    })
  } else if (layout.pageCount > 2) {
    issues.push({
      code: 'long-resume',
      severity: 'warning',
      message: `当前简历共 ${layout.pageCount} 页，建议确认内容是否需要精简。`,
    })
  }

  if (issues.length === 0) {
    issues.push({ code: 'ready', severity: 'success', message: '内容和分页检查通过，可以导出。' })
  }
  return issues
}
