import { escapeHtml, sanitizeRichHtml, stripHtml } from './html.js'
import { getEffectiveTheme, paginateSections } from './pagination.js'
import type { ResumeDocument } from './model.js'
import { RESUME_TEMPLATE_CSS } from './templateStyles.js'

/**
 * 简历 HTML 渲染器（PDF 导出专用）。
 *
 * 生成一份独立的、内联全部样式的 A4 HTML 文档，交由 Playwright Chromium 渲染为 PDF。
 * 它不依赖前端运行时，因此在 Node 服务端同样可用。
 *
 * 模板视觉样式来自 `templateStyles.ts`，与前端预览共用同一份定义。
 */

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
 * 渲染简历头部。根据 `headerLayout` 决定采用「紧凑」还是「堆叠」版式：
 * - 紧凑（compact）：将职位标题与姓名合并为一行，适合带 `displayTitle`/`detail` 的导入结果；
 * - 堆叠（stacked，默认）：姓名、目标职位、联系方式分层居中展示。
 */
const renderProfileHeader = (document: ResumeDocument): string => {
  const profile = document.profile
  if (profile.headerLayout === 'compact' || profile.displayTitle || profile.detail) {
    return `<header class="resume-header resume-header--compact"><h1>${escapeHtml([profile.displayTitle, profile.name].filter(Boolean).join(' ') || '未填写姓名')}</h1><p class="resume-header__meta">${profileFields(document).map(escapeHtml).join('  |  ')}</p>${profile.detail ? `<p class="resume-header__detail">${escapeHtml(profile.detail)}</p>` : ''}<p class="resume-header__headline">${escapeHtml(profile.headline || '目标职位')}</p></header>`
  }
  return `<header class="resume-header"><h1>${escapeHtml(profile.name || '未填写姓名')}</h1><p class="resume-header__headline">${escapeHtml(profile.headline || '目标职位')}</p><p class="resume-header__meta">${profileFields(document).map(escapeHtml).join('  |  ')}</p></header>`
}

/**
 * 渲染单条经历（内容块）。标题与时间并排展示，副标题与地点并排展示，
 * 正文富文本经过清洗，要点列表以 `<ul>` 呈现。空字段会自动省略对应行。
 */
const renderItem = (item: ResumeDocument['sections'][number]['items'][number]): string => {
  const bullets = item.bullets.length
    ? `<ul class="resume-bullets">${item.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join('')}</ul>`
    : ''
  const content = stripHtml(item.content)
    ? `<div class="resume-rich-text">${sanitizeRichHtml(item.content)}</div>`
    : ''
  return `<div class="resume-item">
    ${item.title || item.period ? `<div class="resume-item__heading"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.period)}</span></div>` : ''}
    ${item.subtitle || item.location ? `<div class="resume-item__subheading"><span>${escapeHtml(item.subtitle)}</span><span>${escapeHtml(item.location)}</span></div>` : ''}
    ${content}${bullets}
  </div>`
}

/**
 * 将简历文档渲染为完整的 A4 HTML 文档（供 PDF 导出）。
 *
 * 步骤：
 * 1. 应用一页模式的压缩主题（`getEffectiveTheme`）；
 * 2. 分页（`paginateSections`）；
 * 3. 逐页渲染头部（仅首页）、模块、条目与页码；
 * 4. 附上一段前端脚本 `__resumeReflow`，在渲染后对溢出页面做二次拆分兜底。
 */
export const renderResumeHtml = (resumeDocument: ResumeDocument): string => {
  const theme = getEffectiveTheme(resumeDocument.theme)
  const pages = paginateSections(resumeDocument.sections, theme)
  const pagesHtml = pages
    .map((page) => {
      const header = page.index === 1 ? renderProfileHeader(resumeDocument) : ''
      const sections = page.sections
        .map(
          (section) =>
            `<section class="resume-section"><h2>${escapeHtml(section.title || '未命名模块')}</h2>${section.items.map(renderItem).join('')}</section>`,
        )
        .join('')
      const footer = resumeDocument.theme.showPageNumber
        ? `<footer class="resume-page__number">${page.index}</footer>`
        : ''
      return `<article class="resume-page template-${theme.templateId} page-mode-${theme.pageMode ?? 'standard'}" style="--resume-font-family:${escapeHtml(theme.fontFamily)};--resume-font-size:${theme.fontSize}px;--resume-line-height:${theme.lineHeight};--resume-page-margin:${theme.pageMargin}mm;--resume-section-gap:${theme.sectionGap}px;--resume-accent:${escapeHtml(theme.accentColor)}">${header}${sections}${footer}</article>`
    })
    .join('')

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; }
    .paper-stack { display: flex; flex-direction: column; gap: 0; }
    .resume-page { page-break-after: always; }
    ${RESUME_TEMPLATE_CSS}
  </style></head><body><div class="paper-stack">${pagesHtml}</div><script>
    window.__resumeReflow = function () {
      const stack = document.querySelector('.paper-stack');
      if (!stack) return;
      let guard = 0;
      while (guard++ < 40) {
        const pages = Array.from(stack.querySelectorAll('.resume-page'));
        let moved = false;
        for (let index = 0; index < pages.length; index += 1) {
          const page = pages[index];
          const sections = Array.from(page.querySelectorAll(':scope > .resume-section'));
          if (page.scrollHeight <= page.clientHeight + 1 || sections.length <= 1) continue;
          const movedSection = sections[sections.length - 1];
          let next = pages[index + 1];
          if (!next) {
            next = page.cloneNode(false);
            next.innerHTML = '';
            stack.appendChild(next);
          }
          next.insertBefore(movedSection, next.querySelector('.resume-page__number'));
          moved = true;
          break;
        }
        if (!moved) break;
      }
    };
  </script></body></html>`
}

export const getResumeProfileFields = profileFields
