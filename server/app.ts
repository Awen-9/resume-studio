import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'
import { hasBuiltFrontend, resolveServerConfig, type ServerConfig } from './config.js'
import { registerAiMatchRoute } from './routes/aiMatch.js'
import { registerAiRewriteRoute } from './routes/aiRewrite.js'
import { registerExportDocxRoute } from './routes/exportDocx.js'
import { registerExportPdfRoute } from './routes/exportPdf.js'
import { registerHealthRoute } from './routes/health.js'
import { registerImportDocxRoute } from './routes/importDocx.js'
import { registerInterviewRoute } from './routes/interview.js'
import { registerAiProvidersRoute } from './routes/aiProviders.js'
import { registerJdRoute } from './routes/jd.js'
import { registerInterviewExpandRoute } from './routes/interviewExpand.js'
import { registerResumeOptimizeRoute } from './routes/resumeOptimize.js'
import { registerAgentRoute } from './routes/agent.js'
import { registerImportPdfRoute } from './routes/importPdf.js'
import { registerOcrStatusRoute } from './routes/ocrStatus.js'
import { registerReparseImportRoute } from './routes/reparseImport.js'
import { closePdfBrowser } from './services/pdfExporter.js'

/** JSON 请求体上限：简历文档正常在几十 KB，2 MB 足够挡住异常大包。 */
const JSON_BODY_LIMIT = 2 * 1024 * 1024

/** 只接受本机 Host，挡住 DNS rebinding（恶意域名解析到 127.0.0.1 后打这个端口）。 */
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/**
 * 允许的页面来源：
 * - Vite dev server（5173）与 Fastify 自服务（4173）
 * - Tauri 桌面端（自定义协议，origin 不是 http）
 */
const ALLOWED_ORIGIN =
  /^(https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?|tauri:\/\/localhost|https?:\/\/tauri\.localhost)$/

export const buildServer = async (
  config: ServerConfig = resolveServerConfig(),
): Promise<FastifyInstance> => {
  const server = Fastify({ logger: true, bodyLimit: JSON_BODY_LIMIT })

  // 本机服务虽然只绑 127.0.0.1，但浏览器里任何网页都能向它发请求，
  // 所以按 Host / Origin 做一层白名单，非本机来源直接 403。
  server.addHook('onRequest', async (request, reply) => {
    const host = request.hostname.toLowerCase()
    if (host && !LOCAL_HOSTS.has(host)) {
      return reply.code(403).send({ message: '只允许本机访问该服务' })
    }
    const origin = request.headers.origin
    if (origin && !ALLOWED_ORIGIN.test(origin)) {
      return reply.code(403).send({ message: '请求来源不被允许' })
    }
    return undefined
  })

  await server.register(cors, { origin: false })
  await server.register(multipart, { limits: { files: 1, fileSize: 15 * 1024 * 1024 } })

  registerHealthRoute(server)
  registerOcrStatusRoute(server)
  registerImportPdfRoute(server)
  registerImportDocxRoute(server)
  registerReparseImportRoute(server)
  registerExportPdfRoute(server, config.chromePath)
  registerExportDocxRoute(server)
  registerAiRewriteRoute(server)
  registerAiMatchRoute(server)
  registerInterviewRoute(server)
  registerAiProvidersRoute(server)
  registerJdRoute(server)
  registerInterviewExpandRoute(server)
  registerResumeOptimizeRoute(server)
  registerAgentRoute(server)

  // 服务关闭时回收复用的 Chromium 单例，避免残留无头浏览器进程
  server.addHook('onClose', async () => {
    await closePdfBrowser()
  })

  /**
   * 统一错误出口。
   *
   * 不设的话，未捕获的异常会走 Fastify 默认响应（带英文 error 字段）；
   * 前端只认 `message`，遇到 500 会显示一句笼统的失败提示。这里保证：
   * 4xx 透传业务消息、5xx 不泄露堆栈只说一句人话，日志里留完整错误。
   */
  server.setErrorHandler((rawError, request, reply) => {
    const error = rawError as Error & { statusCode?: number }
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500
    if (status >= 500) {
      request.log.error({ err: error, url: request.url }, 'unhandled route error')
      return reply.code(status).send({ message: '服务内部错误，请重试' })
    }
    return reply.code(status).send({ message: error.message })
  })

  server.setNotFoundHandler((request, reply) =>
    reply.code(404).send({ message: `没有这个接口：${request.method} ${request.url}` }),
  )

  if (hasBuiltFrontend(config)) {
    await server.register(fastifyStatic, { root: config.distPath, prefix: '/' })
  } else {
    server.log.info('dist directory not found; serving API only')
  }
  return server
}
