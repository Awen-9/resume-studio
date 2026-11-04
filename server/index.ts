import { buildServer } from './app.js'
import { resolveServerConfig } from './config.js'

/**
 * 启动本地服务。
 *
 * 用 async main 而不是顶层 await：Node SEA 的主脚本必须是 CJS，
 * 顶层 await 会让 esbuild 无法打成 CJS 包。启动行为（监听端口、失败退出）保持不变。
 */
const main = async (): Promise<void> => {
  const config = resolveServerConfig()
  const server = await buildServer(config)
  await server.listen({ port: config.port, host: config.host })
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
