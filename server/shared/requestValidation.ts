import type { ResumeDocument } from '../../src/domain/resume/model.js'

export const isResumeDocument = (value: unknown): value is ResumeDocument => {
  if (!value || typeof value !== 'object') return false
  const document = value as Partial<ResumeDocument>
  return Boolean(
    document.id &&
    document.profile &&
    typeof document.profile === 'object' &&
    Array.isArray(document.sections),
  )
}
