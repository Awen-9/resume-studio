import type { FastifyInstance } from 'fastify'
import { renderResumeWord } from '../services/docxExporter.js'
import { isResumeDocument } from '../shared/requestValidation.js'
import type { ResumeDocument } from '../../src/domain/resume/model.js'

export const registerExportDocxRoute = (server: FastifyInstance): void => {
  server.post<{ Body: ResumeDocument }>('/api/export/docx', async (request, reply) => {
    if (!isResumeDocument(request.body)) {
      return reply.code(400).send({ message: '简历数据格式不正确' })
    }
    try {
      const buffer = await renderResumeWord(request.body)
      return reply
        .type('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        .send(buffer)
    } catch (error) {
      request.log.error(error)
      return reply.code(500).send({ message: 'DOCX 导出失败' })
    }
  })
}
