/**
 * 意外错误的上报通道。
 *
 * Vue 的 `errorHandler` 和 `unhandledrejection` 都走这里：界面在 App 里订阅一次，
 * 统一弹提示。没有这层的话，组件里抛错只会进 console——用户看到的是「点了没反应」。
 */
type Listener = (message: string) => void

const listeners = new Set<Listener>()

/** 用户主动取消（AbortError）不是故障，不该弹提示。 */
const isCancellation = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'AbortError' || error.name === 'CanceledError')

export const onUnexpectedError = (listener: Listener): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const reportUnexpectedError = (error: unknown, context = ''): void => {
  if (isCancellation(error)) return
  // 控制台保留完整堆栈，界面上只说一句人话
  console.error(`[unexpected${context ? `:${context}` : ''}]`, error)
  const message = error instanceof Error && error.message ? error.message : '未知错误'
  for (const listener of listeners) listener(message)
}
