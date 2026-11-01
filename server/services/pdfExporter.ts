import { existsSync } from 'node:fs'
import type { Browser } from 'playwright'
import { renderResumeHtml } from '../../src/domain/resume/renderer.js'
import type { ResumeDocument } from '../../src/domain/resume/model.js'

/**
 * 进程内复用的 Chromium 实例。启动一次浏览器约需 1 到 2 秒，
 * 每次导出只新建一个隔离的 context，导出完即关闭。
 */
let browserPromise: Promise<Browser> | null = null

const getBrowser = (chromePath: string): Promise<Browser> => {
  browserPromise ??= (async () => {
    // 延迟加载 playwright，避免服务启动阶段就初始化 Chromium 驱动；
    // 桌面端子进程在 GUI 沙箱环境下加载 Chromium 可能触发系统权限拦截。
    const { chromium } = await import('playwright')
    const browser = await chromium.launch({
      headless: true,
      ...(chromePath && existsSync(chromePath) ? { executablePath: chromePath } : {}),
    })
    // 浏览器意外退出后清空缓存，下次导出时重新启动。
    browser.on('disconnected', () => {
      browserPromise = null
    })
    return browser
  })().catch((error: unknown) => {
    browserPromise = null
    throw error
  })
  return browserPromise
}

/** 关闭复用的浏览器，供服务关闭时调用。 */
export const closePdfBrowser = async (): Promise<void> => {
  const pending = browserPromise
  browserPromise = null
  if (pending) await (await pending.catch(() => null))?.close()
}

export const renderResumePdf = async (
  resumeDocument: ResumeDocument,
  chromePath: string,
): Promise<Buffer> => {
  const browser = await getBrowser(chromePath)
  const context = await browser.newContext({
    viewport: { width: 794, height: 1123 },
    deviceScaleFactor: 1,
    // 简历 HTML 是自包含的，导出时不需要访问任何网络资源。
    offline: true,
  })

  try {
    const page = await context.newPage()
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
    await context.close()
  }
}
