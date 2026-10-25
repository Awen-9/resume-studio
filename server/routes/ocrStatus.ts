import type { FastifyInstance } from 'fastify'

export const registerOcrStatusRoute = (server: FastifyInstance): void => {
  server.get('/api/ocr/status', async () => ({
    available: false,
    engine: 'tesseract',
    message:
      '当前环境未安装 OCR 引擎。安装 Tesseract 并设置 TESSERACT_CMD 后可接入扫描版 PDF 识别。',
  }))
}
