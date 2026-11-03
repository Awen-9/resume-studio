// @vitest-environment node

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import 'dotenv/config'
import { extractPdfText } from '../../server/services/pdfTextExtractor'

const port = 4180
const baseUrl = `http://127.0.0.1:${port}`
const fixturePath = process.env.RESUME_FIXTURE_PDF
let serverProcess: ChildProcess | undefined

/**
 * 测试里要把导出服务拉起来。不能直接用 `node_modules/.bin/tsx`：在 Windows 上那是
 * 一个 Unix shell 脚本（真正的入口是 tsx.cmd / tsx.ps1），`node` 解析它必然失败，
 * 表现就是「本地导出服务启动超时」。这里直接定位 tsx 的 JS 入口，跨平台都成立。
 */
const resolveTsxCli = (): string => {
  const candidates = [
    path.resolve('node_modules/tsx/dist/cli.mjs'),
    path.resolve('node_modules/tsx/dist/cli.cjs'),
  ]
  const found = candidates.find((candidate) => existsSync(candidate))
  if (!found) throw new Error('找不到 tsx 命令行入口，请先执行 npm ci')
  return found
}

const waitForServer = async (): Promise<void> => {
  const deadline = Date.now() + 40_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      if (response.ok) return
    } catch {
      // The child process may need a few seconds to start tsx and Fastify.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('本地导出服务启动超时')
}

beforeAll(async () => {
  serverProcess = spawn(process.execPath, [resolveTsxCli(), 'server/index.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
    stdio: 'ignore',
  })
  await waitForServer()
}, 60_000)

afterAll(() => {
  serverProcess?.kill('SIGTERM')
})

describe('local PDF exporter', () => {
  it.skipIf(!fixturePath || !existsSync(fixturePath))(
    'imports a real Chinese resume PDF into the template model',
    async () => {
      const bytes = await readFile(fixturePath as string)
      const formData = new FormData()
      formData.append(
        'file',
        new Blob([bytes], { type: 'application/pdf' }),
        path.basename(fixturePath as string),
      )
      const response = await fetch(`${baseUrl}/api/import/pdf`, { method: 'POST', body: formData })
      const payload = (await response.json()) as {
        document?: {
          profile: {
            name: string
            phone: string
            email: string
            displayTitle?: string
            detail?: string
            headline?: string
          }
          sections: Array<{ type: string }>
        }
        warnings?: string[]
      }
      expect(response.status).toBe(200)
      expect(payload.document?.profile.name).toBeTruthy()
      expect(payload.document?.profile.phone || payload.document?.profile.email).toBeTruthy()
      if (process.env.RESUME_FIXTURE_NAME)
        expect(payload.document?.profile.name).toBe(process.env.RESUME_FIXTURE_NAME)
      expect(payload.document?.sections.length).toBeGreaterThan(2)
    },
    30_000,
  )

  it('returns a real A4 PDF for a valid resume document', async () => {
    const response = await fetch(`${baseUrl}/api/export/pdf`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'integration-resume',
        title: '集成测试简历',
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
          fontFamily: 'Arial, sans-serif',
          fontSize: 12.5,
          lineHeight: 1.65,
          pageMargin: 18,
          sectionGap: 18,
          accentColor: '#315D8C',
          showPageNumber: false,
        },
        sections: [
          {
            id: 'summary',
            type: 'summary',
            title: '个人总结',
            visible: true,
            items: [
              {
                id: 'summary-item',
                title: '',
                subtitle: '',
                period: '',
                location: '',
                content: '<p>导出服务集成测试通过。</p>',
                bullets: [],
              },
            ],
          },
        ],
      }),
    })
    const pdf = Buffer.from(await response.arrayBuffer())
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/pdf')
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    // 只断言魔数是不够的：空白 PDF、中文丢失、分页炸掉都能通过。
    const { text, pages } = await extractPdfText(pdf)
    expect(pages).toBe(1)
    expect(text.replace(/\s/g, '')).toContain('导出服务集成测试通过')
  }, 30_000)

  it('returns a DOCX package for a valid resume document', async () => {
    const response = await fetch(`${baseUrl}/api/export/docx`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'docx-resume',
        title: 'DOCX 测试简历',
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
          fontFamily: 'Arial, sans-serif',
          fontSize: 12.5,
          lineHeight: 1.65,
          pageMargin: 18,
          sectionGap: 18,
          accentColor: '#315D8C',
          showPageNumber: false,
        },
        sections: [
          {
            id: 'summary',
            type: 'summary',
            title: '个人总结',
            visible: true,
            items: [
              {
                id: 'summary-item',
                title: '',
                subtitle: '',
                period: '',
                location: '',
                content: '<p>DOCX 导出测试通过。</p>',
                bullets: [],
              },
            ],
          },
        ],
      }),
    })
    const docx = Buffer.from(await response.arrayBuffer())
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('wordprocessingml.document')
    expect(docx.subarray(0, 2).toString()).toBe('PK')
  }, 30_000)

  it('paginates a long resume into multiple A4 pages without losing the tail', async () => {
    const sections = Array.from({ length: 6 }, (_, sectionIndex) => ({
      id: `section-${sectionIndex}`,
      type: 'experience',
      title: `工作经历 ${sectionIndex + 1}`,
      visible: true,
      items: Array.from({ length: 3 }, (_, itemIndex) => ({
        id: `item-${sectionIndex}-${itemIndex}`,
        title: `公司 ${sectionIndex + 1}-${itemIndex + 1}`,
        subtitle: '后端开发工程师',
        period: '2022.01 - 2023.01',
        location: '西安',
        content: `<p>${'负责核心模块设计、开发与线上问题处理，并持续优化交付流程。'.repeat(6)}</p>`,
        bullets: ['推动公共组件抽取，减少重复代码并提升交付效率'],
      })),
    }))

    const response = await fetch(`${baseUrl}/api/export/pdf`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'long-resume',
        title: '多页简历',
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
        sections,
      }),
    })

    const pdf = Buffer.from(await response.arrayBuffer())
    expect(response.status).toBe(200)
    const { text, pages } = await extractPdfText(pdf)
    expect(pages).toBeGreaterThan(1)
    // 最后一节必须还在，否则就是「分页把内容切丢了」
    expect(text.replace(/\s/g, '')).toContain('工作经历6')
  }, 30_000)

  /** 同一份「自然会有两三页」的长简历，只改固定页数。 */
  const buildLongResume = (targetPages?: number) => ({
    id: `long-${targetPages ?? 'auto'}`,
    title: '多页简历',
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
      ...(targetPages ? { targetPages } : {}),
      fontFamily: 'Arial, sans-serif',
      fontSize: 12.5,
      lineHeight: 1.65,
      pageMargin: 18,
      sectionGap: 18,
      accentColor: '#315D8C',
      showPageNumber: true,
    },
    sections: Array.from({ length: 6 }, (_, sectionIndex) => ({
      id: `section-${sectionIndex}`,
      type: 'experience',
      title: `工作经历 ${sectionIndex + 1}`,
      visible: true,
      items: Array.from({ length: 3 }, (_, itemIndex) => ({
        id: `item-${sectionIndex}-${itemIndex}`,
        title: `公司 ${sectionIndex + 1}-${itemIndex + 1}`,
        subtitle: '后端开发工程师',
        period: '2022.01 - 2023.01',
        location: '西安',
        content: `<p>${'负责核心模块设计、开发与线上问题处理，并持续优化交付流程。'.repeat(6)}</p>`,
        bullets: ['推动公共组件抽取，减少重复代码并提升交付效率'],
      })),
    })),
  })

  const exportPdf = async (payload: unknown): Promise<{ pages: number; text: string }> => {
    const response = await fetch(`${baseUrl}/api/export/pdf`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    expect(response.status).toBe(200)
    const { text, pages } = await extractPdfText(Buffer.from(await response.arrayBuffer()))
    return { pages, text }
  }

  it('honours a fixed page count exactly, without losing content', async () => {
    const { pages, text } = await exportPdf(buildLongResume(2))
    expect(pages).toBe(2)
    expect(text.replace(/\s/g, '')).toContain('工作经历6')
  }, 90_000)

  it('shrinks without a floor when a single page is forced', async () => {
    // 自然两三页的内容强制压成一页：允许一直缩小，只要结果是 1 页且内容没被截断
    const { pages, text } = await exportPdf(buildLongResume(1))
    expect(pages).toBe(1)
    expect(text.replace(/\s/g, '')).toContain('工作经历6')
  }, 90_000)

  it('rejects malformed documents', async () => {
    const response = await fetch(`${baseUrl}/api/export/pdf`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'invalid' }),
    })
    expect(response.status).toBe(400)
  })
})
