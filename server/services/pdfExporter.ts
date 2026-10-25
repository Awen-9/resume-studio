import { existsSync } from 'node:fs'
import { chromium } from 'playwright'
import { renderResumeHtml } from '../../src/domain/resume/renderer.js'
import type { ResumeDocument } from '../../src/domain/resume/model.js'

export const renderResumePdf = async (
  resumeDocument: ResumeDocument,
  chromePath: string,
): Promise<Buffer> => {
  const browser = await chromium.launch({
    headless: true,
    ...(chromePath && existsSync(chromePath) ? { executablePath: chromePath } : {}),
  })

  try {
    const page = await browser.newPage({
      viewport: { width: 794, height: 1123 },
      deviceScaleFactor: 1,
    })
    await page.setContent(renderResumeHtml(resumeDocument), { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(() => {
      const reflow = (window as unknown as { __resumeReflow?: () => void }).__resumeReflow
      reflow?.()
    })
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    })
  } finally {
    await browser.close()
  }
}
