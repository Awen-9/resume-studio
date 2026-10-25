import type { FastifyInstance } from 'fastify'
import { parseResumeText } from '../../src/domain/resume/importParser.js'
import { extractPdfText } from '../services/pdfTextExtractor.js'

export const registerImportPdfRoute = (server: FastifyInstance): void => {
  server.post('/api/import/pdf', async (request, reply) => {
    const upload = await request.file()
    if (!upload) return reply.code(400).send({ message: '请选择要导入的 PDF 文件' })
    if (upload.mimetype !== 'application/pdf' && !upload.filename.toLowerCase().endsWith('.pdf')) {
      return reply.code(415).send({ message: '只支持 PDF 文件' })
    }

    try {
      const text = await extractPdfText(await upload.toBuffer())
      if (text.replace(/\s/g, '').length < 30) {
        return reply
          .code(422)
          .send({ message: '没有提取到足够的文字。扫描版 PDF 需要先进行 OCR。' })
      }
      return parseResumeText(text, upload.filename)
    } catch (error) {
      request.log.error(error)
      return reply.code(422).send({ message: 'PDF 解析失败，请确认文件没有损坏。' })
    }
  })
}
