import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import 'dotenv/config'

export interface ServerConfig {
  host: string
  port: number
  projectRoot: string
  distPath: string
  chromePath: string
}

const getProjectRoot = (): string => {
  const currentDir = path.dirname(fileURLToPath(import.meta.url))
  return currentDir.includes(`${path.sep}dist-server${path.sep}`)
    ? path.resolve(currentDir, '../..')
    : path.resolve(currentDir, '..')
}

const getDefaultChromeCandidates = (): string[] => {
  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ]
  }
  if (process.platform === 'win32') {
    return [
      `${process.env.PROGRAMFILES ?? 'C:/Program Files'}/Google/Chrome/Application/chrome.exe`,
      `${process.env.LOCALAPPDATA ?? 'C:/Users/Default/AppData/Local'}/Google/Chrome/Application/chrome.exe`,
    ]
  }
  return ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
}

const resolveChromePath = (): string => {
  const configuredPath = process.env.CHROME_PATH?.trim()
  if (configuredPath) return configuredPath
  return getDefaultChromeCandidates().find((candidate) => existsSync(candidate)) ?? ''
}

export const resolveServerConfig = (): ServerConfig => {
  const projectRoot = getProjectRoot()
  const chromePath = resolveChromePath()

  return {
    host: process.env.HOST ?? '127.0.0.1',
    port: Number(process.env.PORT ?? 4173),
    projectRoot,
    distPath: path.join(projectRoot, 'dist'),
    chromePath,
  }
}

export const hasBuiltFrontend = (config: ServerConfig): boolean => existsSync(config.distPath)
