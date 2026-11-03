import { TYPE_RATIO, sizeExpr } from './typography.js'
import { emphasizeLeadInHtml } from './leadIn.js'
import { getEffectiveTheme } from './pagination.js'
import { stripHtml } from './validation.js'
import type { ResumeDocument, ResumeProfile, ResumeSection, ResumeTheme } from './model.js'

/**
 * 简历 HTML 渲染器（PDF 导出专用）。
 *
 * 生成一份独立的、内联全部样式的 A4 HTML 文档，交由 Playwright Chromium 渲染为 PDF。
 * 它不依赖前端运行时，因此在 Node 服务端同样可用。
 *
 * 注意：模板视觉样式集中在本文件的 {@link RESUME_CONTENT_CSS}，预览会注入同一份，
 * 因此不存在「预览改了一处、导出忘了一处」的漂移。新增模板样式请只改这里。
 */

/**
 * 富文本清洗器入口。
 *
 * 默认用 `sanitize.ts` 里的零依赖词法解析（浏览器预览走它，避免把 sanitize-html
 * 这类大依赖打进前端包）。服务端导出启动时通过 {@link configureRichHtmlSanitizer}
 * 换成 `server/services/sanitizeRichHtml.ts` 的 sanitize-html 实现；两个实现白名单一致，
 * 对合法内容输出相同，不会造成预览/导出漂移。
 */
import { sanitizeRichHtml as sanitizeRichHtmlLexical } from './sanitize.js'

let sanitizeRichHtmlImpl: (value: string) => string = sanitizeRichHtmlLexical

/** 服务端导出前调用一次，把清洗器换成 sanitize-html 实现。 */
export const configureRichHtmlSanitizer = (impl: (value: string) => string): void => {
  sanitizeRichHtmlImpl = impl
}

export const sanitizeRichHtml = (value: string): string => sanitizeRichHtmlImpl(value)

/** HTML 转义，防止用户输入的内容破坏文档结构或注入脚本。 */
const escapeHtml = (value: string): string => {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

/** 收集个人联系方式字段（电话、邮箱、地点、网站），过滤空值。 */
const profileFields = (document: ResumeDocument): string[] => {
  return [
    document.profile.phone,
    document.profile.email,
    document.profile.location,
    document.profile.website,
  ].filter(Boolean)
}

/**
 * 头部是否走「紧凑」版式。
 *
 * 显式设置优先：`headerLayout: 'stacked'` 时即使存在 `displayTitle`/`detail`
 * 也按分层版式渲染，用户才能把导入的紧凑头部改回去；未设置时沿用导入器的推断
 * （带展示标题/简介即紧凑）。
 */
export const usesCompactHeader = (profile: ResumeProfile): boolean =>
  profile.headerLayout === 'compact' ||
  (profile.headerLayout !== 'stacked' && Boolean(profile.displayTitle || profile.detail))

/**
 * 渲染简历头部。根据 {@link usesCompactHeader} 决定采用「紧凑」还是「堆叠」版式：
 * - 紧凑（compact）：将职位标题与姓名合并为一行，适合带 `displayTitle`/`detail` 的导入结果；
 * - 堆叠（stacked，默认）：姓名、目标职位、联系方式分层居中展示。
 */
const renderProfileHeader = (document: ResumeDocument): string => {
  const profile = document.profile
  if (usesCompactHeader(profile)) {
    return `<header class="resume-header resume-header--compact"><h1>${escapeHtml([profile.displayTitle, profile.name].filter(Boolean).join(' ') || '未填写姓名')}</h1><p class="resume-header__meta">${profileFields(document).map(escapeHtml).join('  |  ')}</p>${profile.detail ? `<p class="resume-header__detail">${escapeHtml(profile.detail)}</p>` : ''}<p class="resume-header__headline">${escapeHtml(profile.headline || '目标职位')}</p></header>`
  }
  return `<header class="resume-header"><h1>${escapeHtml(profile.name || '未填写姓名')}</h1><p class="resume-header__headline">${escapeHtml(profile.headline || '目标职位')}</p><p class="resume-header__meta">${profileFields(document).map(escapeHtml).join('  |  ')}</p></header>`
}

/**
 * 渲染单条经历（内容块）。标题与时间并排展示，副标题与地点并排展示，
 * 正文富文本经过清洗，要点列表以 `<ul>` 呈现。空字段会自动省略对应行。
 */
const renderItem = (
  item: ResumeDocument['sections'][number]['items'][number],
  measureKey?: string,
): string => {
  const bullets = item.bullets.length
    ? `<ul class="resume-bullets">${item.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join('')}</ul>`
    : ''
  const content = stripHtml(item.content)
    ? `<div class="resume-rich-text">${emphasizeLeadInHtml(sanitizeRichHtml(item.content))}</div>`
    : ''
  return `<div class="resume-item"${measureKey ? ` data-measure-item="${escapeHtml(measureKey)}"` : ''}>
    ${item.title || item.period ? `<div class="resume-item__heading"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.period)}</span></div>` : ''}
    ${item.subtitle || item.location ? `<div class="resume-item__subheading"><span>${escapeHtml(item.subtitle)}</span><span>${escapeHtml(item.location)}</span></div>` : ''}
    ${content}${bullets}
  </div>`
}

interface RenderSectionOptions {
  /** 只渲染这一部分条目（跨页切开时用）；缺省为整个模块。 */
  items?: ResumeDocument['sections'][number]['items']
  /** 测量页需要给标题与条目打上标记，供 Chromium 量高度。 */
  measure?: boolean
}

const renderSection = (section: ResumeSection, options: RenderSectionOptions = {}): string => {
  const items = options.items ?? section.items
  const headingAttr = options.measure ? ' data-measure-heading' : ''
  const sectionAttr = options.measure ? ` data-measure-section="${escapeHtml(section.id)}"` : ''
  const itemsHtml = items
    .map((item, index) => renderItem(item, options.measure ? `${section.id}:${index}` : undefined))
    .join('')
  return `<section class="resume-section"${sectionAttr}><h2${headingAttr}>${escapeHtml(section.title || '未命名模块')}</h2>${itemsHtml}</section>`
}

/**
 * 纸张盒模型（仅导出使用）。
 *
 * 预览里的 `.resume-page` 是「最小高度 297mm、超出就长高」的展示盒（见 `styles.css`），
 * 因为界面上不该把用户内容裁掉；导出则必须严格一页一张。两者的**内容排版**共用
 * 下面的 {@link RESUME_CONTENT_CSS}，所以行距、字号、间距不会各写一份。
 */
export const RESUME_PAGE_CSS = `
  .resume-page {
    position: relative;
    width: 210mm;
    height: 297mm;
    overflow: hidden;
    padding: var(--resume-page-margin);
    page-break-after: always;
    font-family: var(--resume-font-family);
    font-size: var(--resume-font-size);
    line-height: var(--resume-line-height);
  }
`

/**
 * 纸张内部的模板样式：预览注入、导出内联，是这类样式的唯一来源。
 *
 * 新增/修改模板样式只改这里；`styles.css` 只保留编辑器外壳（页面投影、选中高亮等）。
 * 字号全部按 {@link TYPE_RATIO} 的倍数计算，保证「栏目 > 项目 > 副标题 > 正文」
 * 在任何基准字号下都成立；前三级加粗，正文保持常规字重。
 */
export const RESUME_CONTENT_CSS = `
  .resume-header { padding: 6px 0 24px; text-align: center; }
  .resume-header h1 { margin: 0; font-size: ${sizeExpr(TYPE_RATIO.name)}; font-weight: 700; line-height: 1.25; }
  .resume-header__headline { margin: 7px 0 0; font-size: ${sizeExpr(TYPE_RATIO.headline)}; }
  .resume-header__meta { margin: 5px 0 0; color: #535353; font-size: ${sizeExpr(TYPE_RATIO.contact)}; }
  .resume-header--compact { padding-bottom: 18px; }
  .resume-header--compact h1 { font-size: ${sizeExpr(TYPE_RATIO.nameCompact)}; }
  .resume-header--compact .resume-header__meta { margin-top: 6px; }
  .resume-header__detail { margin: 4px 0 0; font-size: ${sizeExpr(TYPE_RATIO.detail)}; }
  .resume-header--compact .resume-header__headline { margin-top: 4px; font-size: ${sizeExpr(TYPE_RATIO.headlineCompact)}; }
  .resume-section { margin-top: calc(var(--resume-section-gap) + var(--resume-stretch, 0px)); }
  .resume-section:first-of-type { margin-top: 0; }
  .resume-section h2 { display: flex; align-items: center; gap: 12px; margin: 0 0 9px; font-size: ${sizeExpr(TYPE_RATIO.section)}; font-weight: 700; line-height: 1.4; }
  .resume-section h2::after { flex: 1; height: 1px; background: currentColor; content: ''; opacity: .68; }
  .template-accent .resume-section h2 { color: var(--resume-accent); }
  .template-compact .resume-section { margin-top: calc(var(--resume-section-gap) * .72 + var(--resume-stretch, 0px)); }
  .resume-page.template-compact .resume-header { padding-bottom: 13px; border-bottom: 2px solid #20262d; text-align: left; }
  .resume-page.template-compact .resume-header h1 { font-size: ${sizeExpr(TYPE_RATIO.nameCompact)}; }
  .resume-page.template-compact .resume-header__headline { margin-top: 4px; font-size: ${sizeExpr(TYPE_RATIO.headlineCompact)}; }
  .resume-page.template-compact .resume-section h2 { font-size: ${sizeExpr(TYPE_RATIO.sectionCompact)}; }
  .resume-page.template-compact .resume-section h2::after { background: #8b949c; }
  .resume-page.template-accent { border-top: 7px solid var(--resume-accent); }
  .resume-page.template-accent .resume-header { padding-left: 12px; border-left: 4px solid var(--resume-accent); text-align: left; }
  .resume-page.template-accent .resume-header h1 { color: var(--resume-accent); }
  .resume-page.template-accent .resume-section h2::before { width: 5px; height: 18px; background: var(--resume-accent); content: ''; }
  .resume-item + .resume-item { margin-top: calc(12px + var(--resume-stretch, 0px)); }
  .resume-item__heading, .resume-item__subheading { display: flex; justify-content: space-between; gap: 14px; }
  .resume-item__heading { font-size: ${sizeExpr(TYPE_RATIO.itemTitle)}; font-weight: 700; }
  .resume-item__heading strong { font-weight: 700; }
  .resume-item__subheading { color: #3d4650; font-size: ${sizeExpr(TYPE_RATIO.itemSubtitle)}; font-weight: 600; }
  .resume-rich-text p { margin: 4px 0 0; }
  .resume-bullets { margin: 4px 0 0; padding-left: 18px; }
  .resume-bullets li + li { margin-top: 2px; }
  .resume-page__number { position: absolute; right: var(--resume-page-margin); bottom: 8mm; color: #777; font-size: 10px; }
`

const pageStyleVars = (theme: ResumeTheme): string =>
  `--resume-font-family:${escapeHtml(theme.fontFamily)};--resume-font-size:${theme.fontSize}px;--resume-line-height:${theme.lineHeight};--resume-page-margin:${theme.pageMargin}mm;--resume-section-gap:${theme.sectionGap}px;--resume-accent:${escapeHtml(theme.accentColor)}`

interface RenderFragment {
  section: ResumeSection
  start: number
  end: number
}

const renderPage = (
  document: ResumeDocument,
  theme: ResumeTheme,
  fragments: RenderFragment[],
  pageNumber: number,
  options: { withHeader: boolean; measure?: boolean; stretch?: number },
): string => {
  const header = options.withHeader ? renderProfileHeader(document) : ''
  const footer =
    document.theme.showPageNumber && !options.measure
      ? `<footer class="resume-page__number">${pageNumber}</footer>`
      : ''
  const classes = [
    'resume-page',
    `template-${theme.templateId}`,
    `page-mode-${theme.pageMode ?? 'standard'}`,
    options.measure ? 'resume-page--measure' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const body = fragments
    .map((fragment) =>
      renderSection(fragment.section, {
        items: fragment.section.items.slice(fragment.start, fragment.end),
        measure: options.measure,
      }),
    )
    .join('')
  // 固定页数时把页底剩余空间摊到条目之间，让每页都是满的
  const stretch = options.stretch ? `;--resume-stretch:${options.stretch}px` : ''
  return `<article class="${classes}" style="${pageStyleVars(theme)}${stretch}">${header}${body}${footer}</article>`
}

const htmlDocument = (body: string): string =>
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; }
    body { font-family: var(--resume-font-family); color: #202020; font-size: var(--resume-font-size); line-height: var(--resume-line-height); }
    .paper-stack { display: flex; flex-direction: column; gap: 0; }
    ${RESUME_PAGE_CSS}
    ${RESUME_CONTENT_CSS}
    /* 测量页不能裁剪：内容超出 297mm 时仍要让浏览器把真实高度算出来 */
    .resume-page--measure { overflow: visible; }
    .resume-page--measure .resume-page__number { display: none; }
  </style></head><body><div class="paper-stack">${body}</div></body></html>`

/**
 * 测量用 HTML：把所有模块放进同一张「测量页」，由 Chromium 量出真实高度。
 *
 * 导出分两步——先量后分——而不是在页面里塞一段重排脚本：这样「怎么分页」由
 * `layout.ts` 的同一份算法决定，和预览保持一致，也不会出现脚本还没跑就打印的情况。
 */
export const renderMeasureHtml = (
  document: ResumeDocument,
  sections: ResumeSection[],
  theme: ResumeTheme = getEffectiveTheme(document.theme),
): string => {
  const fragments = sections.map((section) => ({ section, start: 0, end: section.items.length }))
  return htmlDocument(
    renderPage(document, theme, fragments, 1, { withHeader: true, measure: true }),
  )
}

/**
 * 最终导出 HTML：按给定的分页结果逐页渲染，不再有任何运行时重排。
 *
 * 每页是「片段列表 + 撑开间距」：同一个模块可能跨页出现多次，每次只渲染它在这一页的
 * 那部分条目，标题会重复出现在续页顶部；`stretch` 用于固定页数时把页底空白摊平。
 */
export interface RenderPage {
  fragments: Array<{ section: ResumeSection; start: number; end: number }>
  /** 额外撑开的间距（px）。 */
  stretch?: number
}

export const renderResumeHtml = (
  document: ResumeDocument,
  pages: RenderPage[],
  theme: ResumeTheme = getEffectiveTheme(document.theme),
): string => {
  const effectivePages: RenderPage[] = pages.length > 0 ? pages : [{ fragments: [] }]
  return htmlDocument(
    effectivePages
      .map((page, index) =>
        renderPage(document, theme, page.fragments, index + 1, {
          withHeader: index === 0,
          stretch: page.stretch,
        }),
      )
      .join(''),
  )
}

export const getResumeProfileFields = profileFields
