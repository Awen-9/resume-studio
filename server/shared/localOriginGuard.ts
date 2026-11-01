import type { FastifyInstance } from 'fastify'

/**
 * 只放行来自本机应用的请求。
 *
 * 服务虽然只监听本机地址，但浏览器里任意网页都能向 `127.0.0.1` 发起表单式 POST（不触发预检），
 * DNS 重绑定还能让外部域名解析到本机。这里检查两件事：
 * - `Host` 必须是本机地址或配置的监听地址，挡住重绑定；
 * - 带 `Origin` 的请求必须来自本机页面或桌面端，挡住其他网站的跨站请求。
 * 不带 `Origin` 的请求（命令行工具、服务端测试）不受影响。
 */
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]'])
const DESKTOP_ORIGINS = new Set([
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
])

const hostnameOf = (host: string): string => host.replace(/:\d+$/, '').toLowerCase()

export const registerLocalOriginGuard = (server: FastifyInstance, listenHost: string): void => {
  const allowedHostnames = new Set([...LOOPBACK_HOSTNAMES, listenHost.toLowerCase()])

  const isAllowedOrigin = (origin: string): boolean => {
    if (DESKTOP_ORIGINS.has(origin)) return true
    try {
      const url = new URL(origin)
      return (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        allowedHostnames.has(url.hostname.toLowerCase())
      )
    } catch {
      return false
    }
  }

  server.addHook('onRequest', async (request, reply) => {
    const host = request.headers.host ?? ''
    const origin = request.headers.origin
    if (!allowedHostnames.has(hostnameOf(host)) || (origin && !isAllowedOrigin(origin))) {
      return reply.code(403).send({ message: '只接受本机应用的请求' })
    }
  })
}
