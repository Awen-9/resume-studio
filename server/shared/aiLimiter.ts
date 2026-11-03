/**
 * 本机模型并发闸门。
 *
 * 单张显卡上同时跑「AI 改写」和「JD 体检」不会更快，只会两个一起变慢，
 * 甚至在 8B 模型上直接抢显存失败。这里把 AI 请求串成队列：
 * 后到的请求排队等待，而不是报错——对本地个人工具来说，等一会儿比失败好。
 */
let tail: Promise<unknown> = Promise.resolve()

export const withAiSlot = async <T>(task: () => Promise<T>): Promise<T> => {
  // 用 then(task, task) 保证前一个任务失败也不堵住队列
  const run = tail.then(task, task)
  tail = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}
