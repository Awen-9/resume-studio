/**
 * HTTP 边界的请求校验。
 *
 * 简历文档导出（PDF/DOCX）的校验已迁移到 `domain/resume/validation.ts` 的手写类型守卫
 * {@link validateResumeDocument}，本文件只保留仍需要 zod 做字段级错误定位的接口
 * （AI 改写、单模块重解析）。
 */
import { z } from 'zod'
import { SECTION_TYPES } from '../../src/domain/resume/model.js'

/** 模块类型白名单：从领域模型常量数组推导，与手写类型守卫共用同一份定义。 */
export const sectionTypeSchema = z.enum(SECTION_TYPES)

/** AI 改写请求：正文上限与路由里的常量保持一致，避免两处漂移。 */
export const AI_TEXT_LIMIT = 4000

export const aiRewriteRequestSchema = z.object({
  text: z.string().max(AI_TEXT_LIMIT),
  instruction: z.string().max(300).optional(),
  provider: z.enum(['ollama', 'deepseek']).default('ollama'),
  apiKey: z.string().max(200).optional(),
  model: z.string().max(120).optional(),
})

export interface ValidationIssue {
  path: string
  message: string
}

/** 把 zod 的 issues 转成前端好用的扁平结构（`profile.phone: Too big...`）。 */
export const formatIssues = (
  issues: ReadonlyArray<{ path: readonly PropertyKey[]; message: string }>,
): ValidationIssue[] =>
  issues.map((issue) => ({
    path: issue.path.map((segment) => String(segment)).join('.') || '(root)',
    message: issue.message,
  }))
