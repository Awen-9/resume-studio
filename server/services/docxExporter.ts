import { renderResumeDocx } from '../../src/infrastructure/export/docxRenderer.js'
import type { ResumeDocument } from '../../src/domain/resume/model.js'

export const renderResumeWord = (resumeDocument: ResumeDocument): Promise<Buffer> => {
  return renderResumeDocx(resumeDocument)
}
