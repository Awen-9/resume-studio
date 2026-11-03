import type { FastifyInstance } from 'fastify'
import { parseResumeText } from '../../src/domain/resume/importParser.js'
import { extractPdfText } from '../services/pdfTextExtractor.js'
import { isFileTooLarge, MAX_UPLOAD_MB } from '../shared/upload.js'

/** 单份简历正常不超过十几页，超过这个数多半是导错了文件（论文、作品集、合同）。 */
const PAGE_WARN_THRESHOLD = 15
const MAX_PAGES_HARD_LIMIT = 60

export const registerImportPdfRoute = (server: FastifyInstance): void => {
  server.post('/api/import/pdf', async (request, reply) => {
    let upload
    try {
      upload = await request.file()
    } catch (error) {
      // 超过 multipart 的 15 MB 上限时，Fastify 抛的是 FST_REQ_FILE_TOO_LARGE
      if (isFileTooLarge(error)) {
        return reply
          .code(413)
          .send({ message: `PDF 超过 ${MAX_UPLOAD_MB} MB，请先压缩或拆分后再导入。` })
      }
      throw error
    }

    if (!upload) return reply.code(400).send({ message: '请选择要导入的 PDF 文件' })
    if (upload.mimetype !== 'application/pdf' && !upload.filename.toLowerCase().endsWith('.pdf')) {
      return reply.code(415).send({ message: '只支持 PDF 文件' })
    }

    try {
      const { text, pages } = await extractPdfText(await upload.toBuffer())

      if (text.replace(/\s/g, '').length < 30) {
        return reply
          .code(422)
          .send({ message: '没有提取到足够的文字。扫描版 PDF 需要先进行 OCR。' })
      }
      if (pages > MAX_PAGES_HARD_LIMIT) {
        return reply
          .code(422)
          .send({ message: `这份 PDF 有 ${pages} 页，不像是单份简历，请确认文件是否正确。` })
      }

      const result = parseResumeText(text, upload.filename)
      if (pages > PAGE_WARN_THRESHOLD) {
        result.warnings.push(`PDF 共 ${pages} 页，已全部提取，请确认是否只需要其中一部分。`)
      }
      return { ...result, pages }
    } catch (error) {
      // 超限也可能在 toBuffer() 阶段才抛出
      if (isFileTooLarge(error)) {
        return reply
          .code(413)
          .send({ message: `PDF 超过 ${MAX_UPLOAD_MB} MB，请先压缩或拆分后再导入。` })
      }
      // pdfjs 对加密文件抛 PasswordException
      if ((error as { name?: string }).name === 'PasswordException') {
        return reply.code(422).send({ message: '这个 PDF 有密码保护，请先解除密码再导入。' })
      }
      request.log.error(error)
      return reply.code(422).send({ message: 'PDF 解析失败，请确认文件没有损坏。' })
    }
  })
}
