import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../../server/app'
import { createDefaultDocument } from '../../src/domain/resume/defaults'
import { buildResumeDocx, multipartBody } from '../helpers/docxFixture'

describe('local Fastify application', () => {
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

  it('registers the health route without opening a network port', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok' })
  })

  it('answers unknown endpoints with a JSON message the client can show', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/does-not-exist' })

    expect(response.statusCode).toBe(404)
    expect((response.json() as { message: string }).message).toContain('/api/does-not-exist')
  })

  it('rejects malformed export payloads and reports the offending fields', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/export/pdf',
      payload: { title: 'invalid' },
    })

    expect(response.statusCode).toBe(400)
    const body = response.json() as { message: string; details: Array<{ path: string }> }
    expect(body.message).toBe('简历数据格式不正确')
    expect(Array.isArray(body.details)).toBe(true)
    // 缺少 id / profile / theme / sections 都应该被点名
    expect(body.details.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(['id', 'profile', 'theme', 'sections']),
    )
  })

  it('accepts a well-formed document (docx path, no browser needed)', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/export/docx',
      payload: createDefaultDocument(),
    })

    expect(response.statusCode).toBe(200)
    expect(response.rawPayload.subarray(0, 2).toString()).toBe('PK')
  })

  it('rejects requests coming from a foreign origin', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'https://evil.example' },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ message: '请求来源不被允许' })
  })

  it('rejects a non-local Host header (dns rebinding)', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/health',
      headers: { host: 'evil.example' },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ message: '只允许本机访问该服务' })
  })

  it('allows the vite dev origin and tauri origin', async () => {
    for (const origin of ['http://127.0.0.1:5173', 'http://localhost:5173', 'tauri://localhost']) {
      const response = await server.inject({
        method: 'GET',
        url: '/api/health',
        headers: { origin },
      })
      expect(response.statusCode, origin).toBe(200)
    }
  })

  it('rejects json bodies above the body limit', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/export/docx',
      payload: { title: 'x'.repeat(3 * 1024 * 1024) },
    })

    expect(response.statusCode).toBe(413)
  })

  it('reparses a single section from its raw lines', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/import/reparse',
      payload: {
        id: 'section-1',
        type: 'experience',
        title: '工作经历',
        lines: ['某公司 2023.07 - 至今', '负责后端系统建设。'],
      },
    })

    expect(response.statusCode).toBe(200)
    const body = response.json() as {
      section: { id: string; type: string; items: Array<{ title: string; period: string }> }
    }
    expect(body.section.id).toBe('section-1')
    expect(body.section.type).toBe('experience')
    expect(body.section.items[0].title).toBe('某公司')
    expect(body.section.items[0].period).toBe('2023.07-至今')
  })

  it('rejects reparse requests with an unknown section type', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/import/reparse',
      payload: { id: 'section-1', type: 'not-a-type', title: 'x', lines: ['a'] },
    })

    expect(response.statusCode).toBe(400)
  })

  it('rejects empty text on the streaming rewrite endpoint', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/ai/rewrite/stream',
      payload: { text: '   ' },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ message: '没有可改写的内容' })
  })

  it('rejects a job match request without a usable JD', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/ai/match',
      payload: { jd: '太短', resume: '一些简历内容' },
    })

    expect(response.statusCode).toBe(400)
    const body = response.json() as { message: string; details: Array<{ path: string }> }
    expect(body.message).toContain('岗位描述')
    expect(body.details.map((issue) => issue.path)).toContain('jd')
  })

  it('imports a .docx resume and returns the same shape as the PDF importer', async () => {
    const body = multipartBody(await buildResumeDocx(), '张三.docx')
    const response = await server.inject({
      method: 'POST',
      url: '/api/import/docx',
      payload: body.payload,
      headers: body.headers,
    })

    expect(response.statusCode).toBe(200)
    const payload = response.json() as {
      document: { profile: { name: string; phone: string }; sections: Array<{ title: string }> }
      sourceText: string
      extractedLines: number
      sectionSources: Record<string, unknown>
    }
    expect(payload.document.profile.name).toBe('张三')
    expect(payload.document.profile.phone).toContain('13800000000')
    expect(payload.document.sections.map((section) => section.title)).toContain('工作经历')
    expect(payload.sourceText).toContain('某某科技有限公司')
    expect(payload.extractedLines).toBeGreaterThan(5)
    expect(Object.keys(payload.sectionSources).length).toBeGreaterThan(0)
  })

  it('rejects the legacy .doc format with an actionable message', async () => {
    const body = multipartBody(Buffer.from('legacy binary'), 'resume.doc')
    const response = await server.inject({
      method: 'POST',
      url: '/api/import/docx',
      payload: body.payload,
      headers: body.headers,
    })

    expect(response.statusCode).toBe(415)
    expect((response.json() as { message: string }).message).toContain('.docx')
  })
})
