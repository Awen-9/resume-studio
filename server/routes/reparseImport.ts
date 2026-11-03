import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { parseSectionFromLines } from '../../src/domain/resume/importParser.js'
import { formatIssues, sectionTypeSchema } from '../shared/schemas.js'

const reparseSchema = z.object({
  id: z.string().min(1).max(120),
  type: sectionTypeSchema,
  title: z.string().max(80),
  // 单模块的原文行；一份模块不会超过几百行，超出说明前端传错了范围
  lines: z.array(z.string().max(4_000)).min(1).max(400),
})

/**
 * 单模块重新解析。
 *
 * 导入确认页里允许用户改模块类型（把误判的模块纠正过来），改完调这个接口
 * 只重跑该模块的原文，不用整份 PDF 重导。
 */
export const registerReparseImportRoute = (server: FastifyInstance): void => {
  server.post('/api/import/reparse', async (request, reply) => {
    const parsed = reparseSchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ message: '模块数据不完整', details: formatIssues(parsed.error.issues) })
    }
    try {
      const section = parseSectionFromLines(parsed.data)
      return { section }
    } catch (error) {
      request.log.error(error)
      return reply.code(422).send({ message: '这个模块解析失败，请检查原文内容' })
    }
  })
}
