import type { FastifyInstance } from 'fastify'
import { parseResumeText } from '../../src/domain/resume/importParser.js'
import { extractDocxText } from '../services/docxTextExtractor.js'
import { isFileTooLarge, MAX_UPLOAD_MB } from '../shared/upload.js'

/** Word 的 OOXML 媒体类型；有些浏览器/系统会给空值，所以同时看扩展名。 */
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export const registerImportDocxRoute = (server: FastifyInstance): void => {
  server.post('/api/import/docx', async (request, reply) => {
    let upload
    try {
      upload = await request.file()
    } catch (error) {
      if (isFileTooLarge(error)) {
        return reply
          .code(413)
          .send({ message: `文件超过 ${MAX_UPLOAD_MB} MB，请先压缩或拆分后再导入。` })
      }
      throw error
    }

    if (!upload) return reply.code(400).send({ message: '请选择要导入的 Word 文件' })
    const fileName = upload.filename.toLowerCase()
    // 老的 .doc 是二进制格式，和 .docx 的 zip 结构完全不同，明确让用户另存
    if (fileName.endsWith('.doc')) {
      return reply.code(415).send({
        message: '不支持旧版 .doc，请在 Word 里「另存为」.docx 后再导入。',
      })
    }
    if (upload.mimetype !== DOCX_MIME && !fileName.endsWith('.docx')) {
      return reply.code(415).send({ message: '只支持 Word（.docx）文件' })
    }

    try {
      const { text, warnings } = await extractDocxText(await upload.toBuffer())
      if (text.replace(/\s/g, '').length < 30) {
        return reply
          .code(422)
          .send({ message: '没有从这份 Word 里读到足够的文字，请确认文件不是空的或只有图片。' })
      }

      const result = parseResumeText(text, upload.filename)
      if (warnings.length > 0) {
        // mammoth 的原始告警是英文的样式名，对用户没意义，只给一句可行动的提示
        result.warnings.unshift(
          `Word 里有 ${warnings.length} 处样式无法识别，已尽量按正文导入，建议核对内容。`,
        )
      }
      return result
    } catch (error) {
      if (isFileTooLarge(error)) {
        return reply
          .code(413)
          .send({ message: `文件超过 ${MAX_UPLOAD_MB} MB，请先压缩或拆分后再导入。` })
      }
      if ((error as { name?: string }).name === 'PasswordException') {
        return reply.code(422).send({ message: '这个 Word 文档有密码保护，请先解除密码再导入。' })
      }
      request.log.error(error)
      return reply.code(422).send({
        message: 'Word 解析失败：请确认文件没有损坏，且是 .docx 格式。',
      })
    }
  })
}
