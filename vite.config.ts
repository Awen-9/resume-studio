import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    watch: {
      // 编辑器的原子保存（临时目录 + 重命名）、测试产物、系统缩略图都可能被监听到；
      // Windows 上删除中的临时目录会抛 EBUSY，直接把 dev server 崩掉，所以一并忽略。
      ignored: [
        '**/playwright-report/**',
        '**/test-results/**',
        '**/*.tmpdir',
        '**/*.tmpdir/**',
        '**/.*.tmp*',
        '**/.~lock.*',
        // DOCX 导出会在仓库根写临时目录（tmp-docx/…），解压出来的 XML 被占用时
        // Vite 的文件监听会抛 EBUSY 并直接退出——忽略整个产物目录，别让它崩。
        '**/tmp-*/**',
        '**/tmp-*',
        '**/dist/**',
        '**/dist-server/**',
      ],
    },
    proxy: {
      '/api': 'http://127.0.0.1:4173',
    },
  },
})
