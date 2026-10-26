import type { ResumeImportResult } from '@/domain/resume/importParser'
import type { ResumeDocument } from '@/domain/resume/model'

interface ImportPdfResponse {
  document?: ResumeDocument
  warnings?: string[]
  extractedLines?: number
  sourceText?: string
  message?: string
}

/**
 * 本机导出服务的基地址。浏览器开发/生产模式下由 Vite 代理或 Fastify 同源提供，
 * 因此使用相对路径；桌面端（Tauri）以自定义协议加载静态资源，需要显式指向
 * 本机服务地址。可通过 `VITE_API_BASE_URL` 构建时注入。
 */
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''

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
  const response = await fetch(`${API_BASE_URL}/api/import/pdf`, { method: 'POST', body: formData })
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
  const response = await fetch(`${API_BASE_URL}/api/export/${format}`, {
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
