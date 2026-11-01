import type { FastifyInstance } from 'fastify'

export const registerHealthRoute = (server: FastifyInstance): void => {
  server.get('/api/health', async () => ({ status: 'ok' }))
}
