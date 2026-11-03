import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'

/**
 * 顺序导出 N 次 PDF，报告总耗时与平均耗时，用于对比「每次 launch/close」与
 * 「单例浏览器 + 每次独立 context」两种实现的开销。
 *
 * 用法：node scripts/benchmark-pdf-export.mjs [次数]
 * 环境变量 CHROME_PATH 可指定本机 Chromium/Edge 可执行文件（无 Playwright 自带浏览器时必填）。
 */

const port = 4181
const baseUrl = `http://127.0.0.1:${port}`
const runs = Number(process.argv[2] ?? process.env.RUNS ?? 5)

const resolveTsxCli = () => {
  const candidates = [
    path.resolve('node_modules/tsx/dist/cli.mjs'),
    path.resolve('node_modules/tsx/dist/cli.cjs'),
  ]
  const found = candidates.find((candidate) => existsSync(candidate))
  if (!found) throw new Error('找不到 tsx 命令行入口，请先执行 npm ci')
  return found
}

const waitForServer = async () => {
  const deadline = Date.now() + 40_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      if (response.ok) return
    } catch {
      // 服务可能还没起来，稍后重试
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('本地导出服务启动超时')
}

const resume = {
  id: 'benchmark-resume',
  title: '基准测试简历',
  schemaVersion: 1,
  updatedAt: new Date().toISOString(),
  profile: {
    name: '测试工程师',
    headline: '后端开发',
    phone: '13800000000',
    email: 'test@example.com',
    location: '西安',
    website: '',
  },
  theme: {
    templateId: 'classic',
    pageMode: 'standard',
    fontFamily: 'Arial, sans-serif',
    fontSize: 12.5,
    lineHeight: 1.65,
    pageMargin: 18,
    sectionGap: 18,
    accentColor: '#315D8C',
    showPageNumber: true,
  },
  sections: Array.from({ length: 4 }, (_, sectionIndex) => ({
    id: `section-${sectionIndex}`,
    type: 'experience',
    title: `工作经历 ${sectionIndex + 1}`,
    visible: true,
    items: Array.from({ length: 2 }, (_, itemIndex) => ({
      id: `item-${sectionIndex}-${itemIndex}`,
      title: `公司 ${sectionIndex + 1}-${itemIndex + 1}`,
      subtitle: '后端开发工程师',
      period: '2022.01 - 2023.01',
      location: '西安',
      content: `<p>${'负责核心模块设计、开发与线上问题处理，并持续优化交付流程。'.repeat(4)}</p>`,
      bullets: ['推动公共组件抽取，减少重复代码并提升交付效率'],
    })),
  })),
}

const exportOnce = async () => {
  const response = await fetch(`${baseUrl}/api/export/pdf`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(resume),
  })
  if (!response.ok) throw new Error(`导出失败: HTTP ${response.status}`)
  await response.arrayBuffer()
}

const serverProcess = spawn(process.execPath, [resolveTsxCli(), 'server/index.ts'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
  stdio: 'ignore',
})

try {
  await waitForServer()
  const timings = []
  for (let index = 0; index < runs; index += 1) {
    const started = Date.now()
    await exportOnce()
    const elapsed = Date.now() - started
    timings.push(elapsed)
    console.log(`run ${index + 1}/${runs}: ${elapsed}ms`)
  }
  const total = timings.reduce((sum, value) => sum + value, 0)
  console.log('---')
  console.log(`total: ${total}ms, avg: ${(total / runs).toFixed(0)}ms`)
} finally {
  serverProcess.kill('SIGTERM')
}
