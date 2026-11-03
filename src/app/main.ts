import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles.css'
import './styles/features.css'
import { RESUME_CONTENT_CSS } from '@/domain/resume/renderer'
import { reportUnexpectedError } from '@/shared/ui/errorBus'

/**
 * 注入简历纸张的模板样式。
 *
 * 这份 CSS 与 PDF 导出内联的是同一个常量（`RESUME_CONTENT_CSS`），
 * 所以预览里看到的行距、字号、模块间距就是导出后打印出来的样子。
 * 编辑器外壳（页面投影、选中高亮）仍由 `styles.css` 负责。
 */
const templateStyle = document.createElement('style')
templateStyle.dataset.resumeTemplate = 'true'
templateStyle.textContent = RESUME_CONTENT_CSS
document.head.appendChild(templateStyle)

const app = createApp(App)

/**
 * 兜住三类「用户看不见」的失败：
 * 组件渲染/事件里抛的错、没 catch 的 promise、以及资源加载错误。
 * 之前这些都只进 console，界面上表现为「点了没反应」。
 */
app.config.errorHandler = (error, _instance, info) => {
  reportUnexpectedError(error, info)
}
window.addEventListener('unhandledrejection', (event) => {
  reportUnexpectedError(event.reason, 'promise')
})
window.addEventListener('error', (event) => {
  reportUnexpectedError(event.error ?? event.message, 'window')
})

app.use(createPinia()).mount('#app')
