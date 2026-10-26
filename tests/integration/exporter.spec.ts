// @vitest-environment node

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import 'dotenv/config'

const port = 4180
const baseUrl = `http://127.0.0.1:${port}`
const fixturePath = process.env.RESUME_FIXTURE_PDF
let serverProcess: ChildProcess | undefined

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
  const tsxPath = path.resolve('node_modules/.bin/tsx')
  serverProcess = spawn(process.execPath, [tsxPath, 'server/index.ts'], {
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
  }, 30_000)

  it('returns a DOCX package for a valid resume document', async () => {
    const response = await fetch(`${baseUrl}/api/export/docx`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'docx-resume',
        title: 'DOCX 测试简历',
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

  it('rejects malformed documents', async () => {
    const response = await fetch(`${baseUrl}/api/export/pdf`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'invalid' }),
    })
    expect(response.status).toBe(400)
  })
})
