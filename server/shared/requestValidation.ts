import type { ResumeDocument } from '../../src/domain/resume/model.js'
import { isResumeDocument, resumeDocumentIssues } from '../../src/domain/resume/validation.js'
import type { ValidationIssue } from './schemas.js'

export type ResumeValidationResult =
  | { ok: true; document: ResumeDocument }
  | { ok: false; issues: ValidationIssue[] }

/**
 * 校验导出的简历文档。
 *
 * 交给渲染器之前的边界校验：结构不完整或排版数值越界（例如 `fontSize` 塞字符串、
 * `templateId` 不在白名单、`accentColor` 不是合法色值）都会在这里被挡下并返回 400，
 * 而不是让畸形数据一路流进 Chromium 后抛错变成 500。
 *
 * 校验逻辑是 `domain/resume/validation.ts` 里的手写类型守卫 {@link isResumeDocument}，
 * 与领域模型共用同一份白名单常量数组，不再依赖 schema 库做二次维护。
 */
export const validateResumeDocument = (value: unknown): ResumeValidationResult => {
  if (isResumeDocument(value)) return { ok: true, document: value }
  return {
    ok: false,
    issues: resumeDocumentIssues(value).map((path) => ({
      path,
      message: '字段缺失或格式不正确',
    })),
  }
}
