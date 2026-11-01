import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'
import { hasBuiltFrontend, resolveServerConfig, type ServerConfig } from './config.js'
import { registerExportDocxRoute } from './routes/exportDocx.js'
import { registerExportPdfRoute } from './routes/exportPdf.js'
import { registerHealthRoute } from './routes/health.js'
import { registerImportPdfRoute } from './routes/importPdf.js'
import { registerOcrStatusRoute } from './routes/ocrStatus.js'
import { closePdfBrowser } from './services/pdfExporter.js'
import { registerLocalOriginGuard } from './shared/localOriginGuard.js'

export const buildServer = async (
  config: ServerConfig = resolveServerConfig(),
): Promise<FastifyInstance> => {
  const server = Fastify({ logger: true })
  await server.register(cors, { origin: false })
  registerLocalOriginGuard(server, config.host)
  await server.register(multipart, { limits: { files: 1, fileSize: 15 * 1024 * 1024 } })

  registerHealthRoute(server)
  registerOcrStatusRoute(server)
  registerImportPdfRoute(server)
  registerExportPdfRoute(server, config.chromePath)
  registerExportDocxRoute(server)
  server.addHook('onClose', async () => closePdfBrowser())

  if (hasBuiltFrontend(config)) {
    await server.register(fastifyStatic, { root: config.distPath, prefix: '/' })
  } else {
    server.log.info('dist directory not found; serving API only')
  }
  return server
}
