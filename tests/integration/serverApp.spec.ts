import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../../server/app'

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
})
