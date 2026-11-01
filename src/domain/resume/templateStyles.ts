/**
 * 简历页面与模板的视觉样式，预览和 PDF 导出共用这一份定义。
 *
 * 前端预览把它注入到页面 `<head>`，导出渲染器把它内联进 HTML 文档，
 * 因此修改模板配色、间距或字号只需要改这里。规则全部限定在 `.resume-page`
 * 内部，并显式写出外边距，不依赖应用自身的样式重置。
 * 预览专属的装饰（纸张阴影、选中高亮）留在 `src/app/styles.css`。
 */
export const RESUME_TEMPLATE_CSS = `
.resume-page { position: relative; box-sizing: border-box; width: 210mm; height: 297mm; overflow: hidden; padding: var(--resume-page-margin); color: #202020; background: #fff; font-family: var(--resume-font-family); font-size: var(--resume-font-size); line-height: var(--resume-line-height); }
.resume-page *, .resume-page *::before, .resume-page *::after { box-sizing: border-box; }
.resume-page h1, .resume-page h2 { font-weight: 700; letter-spacing: 0; }
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
`
