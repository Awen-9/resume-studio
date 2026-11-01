import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { RESUME_TEMPLATE_CSS } from '@/domain/resume/templateStyles'
import './styles.css'

// 简历模板样式与 PDF 导出共用同一份定义，放在应用样式之前，便于预览专属装饰覆盖。
const templateStyle = document.createElement('style')
templateStyle.dataset.resumeTemplate = ''
templateStyle.textContent = RESUME_TEMPLATE_CSS
document.head.prepend(templateStyle)

createApp(App).use(createPinia()).mount('#app')
