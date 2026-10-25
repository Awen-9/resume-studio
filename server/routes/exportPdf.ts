import type { FastifyInstance } from 'fastify'
import { renderResumePdf } from '../services/pdfExporter.js'
import { isResumeDocument } from '../shared/requestValidation.js'
import type { ResumeDocument } from '../../src/domain/resume/model.js'

export const registerExportPdfRoute = (server: FastifyInstance, chromePath: string): void => {
  server.post<{ Body: ResumeDocument }>('/api/export/pdf', async (request, reply) => {
    if (!isResumeDocument(request.body)) {
      return reply.code(400).send({ message: '简历数据格式不正确' })
    }
    try {
      const buffer = await renderResumePdf(request.body, chromePath)
      return reply.type('application/pdf').send(buffer)
    } catch (error) {
      request.log.error(error)
      return reply.code(500).send({ message: 'PDF 导出失败' })
    }
  })
}
