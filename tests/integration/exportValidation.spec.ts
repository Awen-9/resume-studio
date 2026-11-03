import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../../server/app'
import { createDefaultDocument } from '../../src/domain/resume/defaults'

/**
 * 导出接口的运行时校验。
 *
 * 直接 `server.inject` 走完整路由，不碰真实浏览器：畸形数据会在进入渲染器之前
 * 被类型守卫挡下并返回 400，所以这里不需要 Chromium 也能验证「边界拒绝」这条链路。
 * 正常简历用 DOCX 路由验证 200（同一套校验、无需浏览器）。
 */
describe('export runtime validation', () => {
  let server: FastifyInstance

  beforeAll(async () => {
    server = await buildServer({
      host: '127.0.0.1',
      port: 0,
      projectRoot: '/tmp/resume-studio-test',
      distPath: '/tmp/resume-studio-test/dist',
      chromePath: '',
    })
  })

  afterAll(async () => {
    await server.close()
  })

  /** 深拷贝一份默认文档，方便按字段改成恶意值（JSON 反序列化后为可变普通对象）。 */
  const documentPayload = (): Record<string, any> =>
    JSON.parse(JSON.stringify(createDefaultDocument()))

  const postExport = (format: 'pdf' | 'docx', body: object) =>
    server.inject({ method: 'POST', url: `/api/export/${format}`, payload: body })

  it('accepts a normal resume on the docx route', async () => {
    const response = await postExport('docx', documentPayload())
    expect(response.statusCode).toBe(200)
    expect(response.rawPayload.subarray(0, 2).toString()).toBe('PK')
  })

  it('rejects a string fontSize carrying an attribute-injection payload', async () => {
    const body = documentPayload()
    body.theme.fontSize = '12" onload="alert(1)'
    expect((await postExport('pdf', body)).statusCode).toBe(400)
    expect((await postExport('docx', body)).statusCode).toBe(400)
  })

  it('rejects a fontSize outside the editor slider range', async () => {
    const body = documentPayload()
    body.theme.fontSize = 999
    expect((await postExport('pdf', body)).statusCode).toBe(400)
  })

  it('rejects an unknown templateId', async () => {
    const body = documentPayload()
    body.theme.templateId = 'injected" onload="x'
    expect((await postExport('pdf', body)).statusCode).toBe(400)
    expect((await postExport('docx', body)).statusCode).toBe(400)
  })

  it('rejects an accentColor with a css injection payload', async () => {
    const body = documentPayload()
    body.theme.accentColor = 'red;background:url(x)'
    expect((await postExport('pdf', body)).statusCode).toBe(400)
    expect((await postExport('docx', body)).statusCode).toBe(400)
  })

  it('rejects an unknown pageMode', async () => {
    const body = documentPayload()
    body.theme.pageMode = 'not-a-mode'
    expect((await postExport('pdf', body)).statusCode).toBe(400)
  })

  it('rejects bullets that are not a string array', async () => {
    const body = documentPayload()
    body.sections[0].items[0].bullets = 'not-an-array'
    expect((await postExport('docx', body)).statusCode).toBe(400)
  })
})
