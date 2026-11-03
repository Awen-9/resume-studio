import { Document, Packer, Paragraph, TextRun } from 'docx'

/**
 * 测试用的最小 Word 简历。
 *
 * 用 `docx` 库现造，避免仓库里塞二进制样本；字段覆盖姓名、联系方式、
 * 三个常见模块，够验证「提取 → 解析 → 分页」这条链路。
 */
export const buildResumeDocx = async (): Promise<Buffer> => {
  const paragraph = (text: string, options: { bold?: boolean } = {}) =>
    new Paragraph({ children: [new TextRun({ text, bold: options.bold })] })

  const document = new Document({
    sections: [
      {
        children: [
          paragraph('张三'),
          paragraph('Java 后端开发工程师'),
          paragraph('13800000000 | zhangsan@example.com | 西安'),
          paragraph('工作经历', { bold: true }),
          paragraph('某某科技有限公司 | 后端开发工程师 | 2022.07 - 至今'),
          paragraph('负责订单系统的稳定性建设与性能优化。'),
          paragraph('教育经历', { bold: true }),
          paragraph('某某大学 | 计算机科学与技术 | 2018.09 - 2022.06'),
          paragraph('专业技能', { bold: true }),
          paragraph('熟悉 Java、Spring Boot、MySQL、Redis。'),
        ],
      },
    ],
  })
  return Packer.toBuffer(document)
}

/** 组装 multipart 请求体，供 Fastify `inject` 使用。 */
export const multipartBody = (
  buffer: Buffer,
  fileName: string,
): { payload: Buffer; headers: Record<string, string> } => {
  const boundary = '----resume-studio-test-boundary'
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      'Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n',
  )
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
  return {
    payload: Buffer.concat([head, buffer, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  }
}
