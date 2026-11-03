import { existsSync } from 'node:fs'
import type { Browser } from 'playwright'
import { planFragments, type SectionMetrics } from '../../src/domain/resume/layout.js'
import type { ResumeDocument } from '../../src/domain/resume/model.js'
import {
  getEffectiveTheme,
  applyItemSplits,
  computeItemSplits,
  nextFitFactor,
  prepareSections,
  scaleTheme,
} from '../../src/domain/resume/pagination.js'
import {
  configureRichHtmlSanitizer,
  renderMeasureHtml,
  renderResumeHtml,
} from '../../src/domain/resume/renderer.js'
import { sanitizeRichHtml } from './sanitizeRichHtml.js'

// 服务端导出换用 sanitize-html 清洗富文本；只在服务端模块里接线，不进入前端包。
configureRichHtmlSanitizer(sanitizeRichHtml)

interface PageMeasurement {
  /** 一页可放内容的净高度（已扣除页边距）。 */
  contentHeight: number
  /** 首页头部占用的高度，只从第 1 页的容量里扣。 */
  headerHeight: number
  sections: SectionMetrics[]
}

/** 懒加载的单例 Chromium：多次导出复用同一个浏览器进程，只在首次导出时启动。 */
let browserPromise: Promise<Browser> | null = null

/**
 * 获取（或启动）单例 Chromium。
 *
 * 启动失败或浏览器被意外关闭时把单例清空，下次导出重新拉起，避免后续导出
 * 一直拿到一个已经失败/断开的实例。
 */
const getBrowser = (chromePath: string): Promise<Browser> => {
  if (browserPromise) return browserPromise
  const promise = (async (): Promise<Browser> => {
    // 延迟加载 playwright，避免服务启动阶段就初始化 Chromium 驱动；
    // 桌面端子进程在 GUI 沙箱环境下加载 Chromium 可能触发系统权限拦截。
    const { chromium } = await import('playwright')
    const browser = await chromium.launch({
      headless: true,
      ...(chromePath && existsSync(chromePath) ? { executablePath: chromePath } : {}),
    })
    // 浏览器意外退出时重置单例，只重置自己对应的实例
    browser.on('disconnected', () => {
      if (browserPromise === promise) browserPromise = null
    })
    return browser
  })()
  browserPromise = promise
  void promise.catch(() => {
    if (browserPromise === promise) browserPromise = null
  })
  return promise
}

/** 关闭单例浏览器（服务关闭时调用，避免残留 Chromium 进程）。 */
export const closePdfBrowser = async (): Promise<void> => {
  const pending = browserPromise
  browserPromise = null
  if (!pending) return
  try {
    const browser = await pending
    await browser.close()
  } catch {
    // 浏览器可能已经断开（disconnected 已触发），忽略关闭失败
  }
}

/**
 * 导出 PDF。
 *
 * 分两步：先用一张「测量页」在 Chromium 里量出每个模块标题与每条内容的高度，
 * 再用 `layout.ts` 的同一份装箱算法决定页归属，最后按结果渲染并打印。
 *
 * 这和预览是同一套决策：预览用 DOM 量、导出用无头 Chromium 量，但「怎么分页」
 * 只有 `planFragments` 一份实现。历史上这里塞过一段 `__resumeReflow` 脚本边打印边搬块，
 * 那正是预览/导出漂移的来源。
 */
export const renderResumePdf = async (
  resumeDocument: ResumeDocument,
  chromePath: string,
): Promise<Buffer> => {
  const browser = await getBrowser(chromePath)
  // 每次导出用独立的 context 隔离，结束后只关 context，复用浏览器进程
  const context = await browser.newContext({
    viewport: { width: 794, height: 1123 },
    deviceScaleFactor: 1,
  })

  try {
    const page = await context.newPage()

    // 网络隔离：渲染内容完全内联，只放行 data:/about:，其余请求一律 abort，
    // 避免恶意内容（或将来引入的外部字体/图片）在无头 Chromium 里发起外联请求。
    await page.route('**/*', (route) => {
      const url = route.request().url()
      if (url.startsWith('data:') || url.startsWith('about:')) return route.continue()
      return route.abort()
    })

    const baseTheme = getEffectiveTheme(resumeDocument.theme)
    let theme = baseTheme
    let sections = prepareSections(resumeDocument.sections, baseTheme)

    // 测量页 → 量高度；某条内容比整页还高时按实测结果再切一次、重新量
    const measureOnce = async (): Promise<PageMeasurement | null> => {
      await page.setContent(renderMeasureHtml(resumeDocument, sections, theme), {
        waitUntil: 'load',
      })
      await page.evaluate(() => document.fonts.ready)
      return page.evaluate((): PageMeasurement | null => {
        const pageElement = document.querySelector<HTMLElement>('.resume-page--measure')
        if (!pageElement) return null
        const style = getComputedStyle(pageElement)
        const contentHeight =
          pageElement.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
        const header = pageElement.querySelector<HTMLElement>('.resume-header')

        // 注意：这里不要抽局部函数。tsx/esbuild 会给具名函数加 __name 辅助调用，
        // 而 page.evaluate 的代码是在浏览器里执行的，没有那个辅助函数会直接 ReferenceError。
        const sections = Array.from(
          pageElement.querySelectorAll<HTMLElement>('[data-measure-section]'),
        ).map((element) => {
          const heading = element.querySelector<HTMLElement>('[data-measure-heading]')
          const items = Array.from(element.querySelectorAll<HTMLElement>('[data-measure-item]'))
          return {
            sectionId: element.dataset.measureSection ?? '',
            // 模块间距挂在 section 上，量标题时一并计入
            headingHeight:
              (heading ? heading.getBoundingClientRect().height : 0) +
              (parseFloat(getComputedStyle(element).marginTop) || 0),
            itemHeights: items.map(
              (item) =>
                item.getBoundingClientRect().height +
                (parseFloat(getComputedStyle(item).marginTop) || 0),
            ),
          }
        })

        return {
          contentHeight,
          headerHeight: header ? header.getBoundingClientRect().height : 0,
          sections,
        }
      })
    }

    let measurement = await measureOnce()
    if (!measurement) throw new Error('简历测量页没有渲染出来')

    const target = resumeDocument.theme.targetPages ?? null
    let fitFactor = 1

    // 最多八轮：单条过高就切开，固定页数不符就缩放排版参数，然后重测。
    // 「强制」意味着不设人工下限：内容多就一路缩，直到放得下（或触到 MIN_FIT_FACTOR）。
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const splits = computeItemSplits(measurement.sections, measurement.contentHeight)
      if (splits.length > 0) {
        sections = applyItemSplits(sections, splits)
        const remeasured = await measureOnce()
        if (!remeasured) throw new Error('切分后的测量页没有渲染出来')
        measurement = remeasured
        continue
      }

      if (!target) break

      const checkCapacities = [
        measurement.contentHeight - measurement.headerHeight,
        measurement.contentHeight,
      ]
      const natural = planFragments(measurement.sections, checkCapacities, null)
      const available = checkCapacities[0] + (target - 1) * checkCapacities[1]
      const total = measurement.sections.reduce(
        (sum, section) =>
          sum + section.headingHeight + section.itemHeights.reduce((a, b) => a + b, 0),
        0,
      )
      const next = nextFitFactor(fitFactor, natural.pages.length, target, total, available)
      if (next === null) break

      fitFactor = next
      theme = scaleTheme(baseTheme, fitFactor)
      sections = prepareSections(resumeDocument.sections, theme)
      const remeasured = await measureOnce()
      if (!remeasured) throw new Error('缩放后的测量页没有渲染出来')
      measurement = remeasured
    }

    // 第 1 页要给头部让位；后续页用满整页容量
    const capacities = [
      measurement.contentHeight - measurement.headerHeight,
      ...Array.from({ length: 200 }, () => measurement.contentHeight),
    ]
    const plan = planFragments(measurement.sections, capacities, target)

    const sectionById = new Map(sections.map((section) => [section.id, section]))
    const pages = plan.pages.map((fragments, index) => ({
      fragments: fragments.flatMap((fragment) => {
        const section = sectionById.get(fragment.sectionId)
        if (!section) return []
        return [{ section, start: fragment.start, end: fragment.end }]
      }),
      stretch: plan.stretch[index] ?? 0,
    }))

    await page.setContent(renderResumeHtml(resumeDocument, pages, theme), { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready)

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
