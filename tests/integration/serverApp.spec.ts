import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../../server/app'
import { createDefaultDocument } from '../../src/domain/resume/defaults'

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

  it('rejects malformed export payloads at the HTTP boundary', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/export/pdf',
      payload: { title: 'invalid' },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ message: '简历数据格式不正确' })
  })

  it('rejects documents whose theme could inject styles', async () => {
    const document = createDefaultDocument()
    document.theme.accentColor = 'red;}</style><script>alert(1)</script>'
    const response = await server.inject({
      method: 'POST',
      url: '/api/export/docx',
      payload: document,
    })

    expect(response.statusCode).toBe(400)
  })

  it('rejects requests sent from other websites', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/export/docx',
      headers: { origin: 'https://evil.example' },
      payload: createDefaultDocument(),
    })

    expect(response.statusCode).toBe(403)
  })

  it('rejects requests whose Host is not a loopback address', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/health',
      headers: { host: 'rebind.example:4173' },
    })

    expect(response.statusCode).toBe(403)
  })

  it.each(['http://127.0.0.1:5173', 'http://localhost:4173', 'tauri://localhost'])(
    'accepts requests from the local app origin %s',
    async (origin) => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/health',
        headers: { origin },
      })

      expect(response.statusCode).toBe(200)
    },
  )
})
