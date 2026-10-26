import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { FastifyInstance } from 'fastify'

const execFileAsync = promisify(execFile)

/**
 * 解析可执行文件路径中的环境变量（如 `$HOME/bin/tesseract`）。
 */
const resolveEnvVars = (value: string): string => {
  return value.replace(/\$\{?(\w+)\}?/g, (_, name: string) => process.env[name] ?? '')
}

const resolveTesseractCmd = (): string => {
  const fromEnv = process.env.TESSERACT_CMD?.trim()
  if (fromEnv) return resolveEnvVars(fromEnv)
  return 'tesseract'
}

export interface OcrStatus {
  available: boolean
  engine: string
  version?: string
  command?: string
  message: string
}

const detectTesseract = async (): Promise<OcrStatus> => {
  const command = resolveTesseractCmd()
  const engine = 'tesseract'
  try {
    const { stdout, stderr } = await execFileAsync(command, ['--version'], { timeout: 5000 })
    // tesseract 在部分平台会把版本号输出到 stderr（历史行为）。
    const versionMatch = `${stdout}\n${stderr}`.match(/tesseract\s+v?([\d.]+)/i)
    return {
      available: true,
      engine,
      version: versionMatch?.[1],
      command,
      message: 'OCR 引擎可用，支持扫描版 PDF 文字识别。',
    }
  } catch {
    return {
      available: false,
      engine,
      command,
      message:
        '当前环境未安装 OCR 引擎。安装 Tesseract 并设置 TESSERACT_CMD 后可接入扫描版 PDF 识别。',
    }
  }
}

export const registerOcrStatusRoute = (server: FastifyInstance): void => {
  server.get('/api/ocr/status', async () => detectTesseract())
}
