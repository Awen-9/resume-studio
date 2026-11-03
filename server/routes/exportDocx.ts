import type { FastifyInstance } from 'fastify'
import { renderResumeWord } from '../services/docxExporter.js'
import { validateResumeDocument } from '../shared/requestValidation.js'

export const registerExportDocxRoute = (server: FastifyInstance): void => {
  server.post('/api/export/docx', async (request, reply) => {
    const validation = validateResumeDocument(request.body)
    if (!validation.ok) {
      return reply.code(400).send({ message: '简历数据格式不正确', details: validation.issues })
    }
    try {
      const buffer = await renderResumeWord(validation.document)
      return reply
        .type('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        .send(buffer)
    } catch (error) {
      request.log.error(error)
      return reply.code(500).send({ message: 'DOCX 导出失败' })
    }
  })
}
