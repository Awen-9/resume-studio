import { buildServer } from './app.js'
import { resolveServerConfig } from './config.js'

const config = resolveServerConfig()
const server = await buildServer(config)

await server.listen({ port: config.port, host: config.host })
