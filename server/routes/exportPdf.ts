import type { FastifyInstance } from 'fastify'
import { renderResumePdf } from '../services/pdfExporter.js'
import { validateResumeDocument } from '../shared/requestValidation.js'

export const registerExportPdfRoute = (server: FastifyInstance, chromePath: string): void => {
  server.post('/api/export/pdf', async (request, reply) => {
    const validation = validateResumeDocument(request.body)
    if (!validation.ok) {
      return reply.code(400).send({ message: '简历数据格式不正确', details: validation.issues })
    }
    try {
      const buffer = await renderResumePdf(validation.document, chromePath)
      return reply.type('application/pdf').send(buffer)
    } catch (error) {
      request.log.error(error)
      return reply.code(500).send({ message: 'PDF 导出失败' })
    }
  })
}
