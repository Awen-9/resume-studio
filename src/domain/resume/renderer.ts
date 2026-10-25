import { getEffectiveTheme, paginateSections } from './pagination.js'
import { stripHtml } from './validation.js'
import type { ResumeDocument } from './model.js'

export const sanitizeRichHtml = (value: string): string => {
  return value
    .replace(/<(?!\/?(?:p|strong|em|ul|ol|li|br)\b)[^>]*>/gi, '')
    .replace(/\s(?:on\w+|style|href|src)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
}

const escapeHtml = (value: string): string => {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

const profileFields = (document: ResumeDocument): string[] => {
  return [
    document.profile.phone,
    document.profile.email,
    document.profile.location,
    document.profile.website,
  ].filter(Boolean)
}

const renderProfileHeader = (document: ResumeDocument): string => {
  const profile = document.profile
  if (profile.headerLayout === 'compact' || profile.displayTitle || profile.detail) {
    return `<header class="resume-header resume-header--compact"><h1>${escapeHtml([profile.displayTitle, profile.name].filter(Boolean).join(' ') || '未填写姓名')}</h1><p class="resume-header__meta">${profileFields(document).map(escapeHtml).join('  |  ')}</p>${profile.detail ? `<p class="resume-header__detail">${escapeHtml(profile.detail)}</p>` : ''}<p class="resume-header__headline">${escapeHtml(profile.headline || '目标职位')}</p></header>`
  }
  return `<header class="resume-header"><h1>${escapeHtml(profile.name || '未填写姓名')}</h1><p class="resume-header__headline">${escapeHtml(profile.headline || '目标职位')}</p><p class="resume-header__meta">${profileFields(document).map(escapeHtml).join('  |  ')}</p></header>`
}

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
    body { font-family: var(--resume-font-family); color: #202020; font-size: var(--resume-font-size); line-height: var(--resume-line-height); }
    .paper-stack { display: flex; flex-direction: column; gap: 0; }
    .resume-page { position: relative; width: 210mm; height: 297mm; overflow: hidden; padding: var(--resume-page-margin); page-break-after: always; font-family: var(--resume-font-family); font-size: var(--resume-font-size); line-height: var(--resume-line-height); }
    .resume-header { padding: 6px 0 24px; text-align: center; }
    .resume-header h1 { margin: 0; font-size: 25px; line-height: 1.25; }
    .resume-header__headline { margin: 7px 0 0; font-size: 15px; }
    .resume-header__meta { margin: 5px 0 0; color: #535353; font-size: 10.5px; }
    .resume-header--compact { padding-bottom: 18px; }
    .resume-header--compact h1 { font-size: 20px; }
    .resume-header--compact .resume-header__meta { margin-top: 6px; }
    .resume-header__detail { margin: 4px 0 0; font-size: 11.5px; }
    .resume-header--compact .resume-header__headline { margin-top: 4px; font-size: 13px; }
    .resume-section { margin-top: var(--resume-section-gap); }
    .resume-section:first-of-type { margin-top: 0; }
    .resume-section h2 { display: flex; align-items: center; gap: 12px; margin: 0 0 9px; font-size: 15px; line-height: 1.4; }
    .resume-section h2::after { flex: 1; height: 1px; background: currentColor; content: ''; opacity: .68; }
    .template-accent .resume-section h2 { color: var(--resume-accent); }
    .template-compact .resume-section { margin-top: calc(var(--resume-section-gap) * .72); }
    .resume-page.template-compact .resume-header { padding-bottom: 13px; border-bottom: 2px solid #20262d; text-align: left; }
    .resume-page.template-compact .resume-header h1 { font-size: 22px; }
    .resume-page.template-compact .resume-header__headline { margin-top: 4px; font-size: 12px; }
    .resume-page.template-compact .resume-section h2 { font-size: 13px; }
    .resume-page.template-compact .resume-section h2::after { background: #8b949c; }
    .resume-page.template-accent { border-top: 7px solid var(--resume-accent); }
    .resume-page.template-accent .resume-header { padding-left: 12px; border-left: 4px solid var(--resume-accent); text-align: left; }
    .resume-page.template-accent .resume-header h1 { color: var(--resume-accent); }
    .resume-page.template-accent .resume-section h2::before { width: 5px; height: 18px; background: var(--resume-accent); content: ''; }
    .resume-item + .resume-item { margin-top: 12px; }
    .resume-item__heading, .resume-item__subheading { display: flex; justify-content: space-between; gap: 14px; }
    .resume-item__heading { font-size: 12.5px; }
    .resume-item__subheading { color: #454545; font-size: 11.5px; }
    .resume-rich-text p { margin: 4px 0 0; }
    .resume-bullets { margin: 4px 0 0; padding-left: 18px; }
    .resume-bullets li + li { margin-top: 2px; }
    .resume-page__number { position: absolute; right: var(--resume-page-margin); bottom: 8mm; color: #777; font-size: 10px; }
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
