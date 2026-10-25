import type { ResumeImportResult } from '@/domain/resume/importParser'
import type { ResumeDocument } from '@/domain/resume/model'

interface ImportPdfResponse {
  document?: ResumeDocument
  warnings?: string[]
  extractedLines?: number
  sourceText?: string
  message?: string
}

const getErrorMessage = async (response: Response, fallback: string): Promise<string> => {
  try {
    const payload = (await response.json()) as { message?: string }
    return payload.message ?? fallback
  } catch {
    return fallback
  }
}

export const importResumePdf = async (file: File): Promise<ResumeImportResult> => {
  const formData = new FormData()
  formData.append('file', file)
  const response = await fetch('/api/import/pdf', { method: 'POST', body: formData })
  const payload = (await response.json()) as ImportPdfResponse
  if (!response.ok || !payload.document) {
    throw new Error(payload.message ?? 'PDF 导入失败')
  }
  return {
    document: payload.document,
    warnings: payload.warnings ?? [],
    extractedLines: Number(payload.extractedLines ?? 0),
    sourceText: payload.sourceText ?? '',
  }
}

export const exportResumeFile = async (
  document: ResumeDocument,
  format: 'pdf' | 'docx',
): Promise<Blob> => {
  const response = await fetch(`/api/export/${format}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(document),
  })
  if (!response.ok) {
    const fallback =
      format === 'pdf'
        ? 'PDF 服务未启动，请先运行 npm run dev'
        : 'Word 导出服务未启动，请先运行 npm run dev'
    throw new Error(await getErrorMessage(response, fallback))
  }
  return response.blob()
}
