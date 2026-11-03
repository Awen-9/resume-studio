/**
 * 上传相关的公共判断。
 *
 * `@fastify/multipart` 超限时抛的错在不同版本里 code/name 不一致，
 * 两处导入路由都要识别，放在这里避免各写一份。
 */
export const isFileTooLarge = (error: unknown): boolean => {
  const candidate = error as { code?: string; name?: string; message?: string }
  return (
    candidate?.code === 'FST_REQ_FILE_TOO_LARGE' ||
    candidate?.name === 'RequestFileTooLargeError' ||
    /file too large|limit.*fileSize/i.test(candidate?.message ?? '')
  )
}

/** 单文件上限，与 `app.ts` 里 multipart 的 fileSize 保持一致。 */
export const MAX_UPLOAD_MB = 15
