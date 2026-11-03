import { onMounted, ref } from 'vue'
import { fetchAiStatus, type AiStatus } from '@/infrastructure/api/localResumeApi'

/**
 * 本机模型可用性。
 *
 * 同一个页面可能有多个入口（AI 改写、JD 体检），每次挂载都去探测一遍没有意义，
 * 因此模块级缓存一次结果；页面重新挂载时用缓存值，不闪烁也不重复请求。
 */
let cached: AiStatus | null = null
let pending: Promise<AiStatus> | null = null

const probe = (): Promise<AiStatus> => {
  pending ??= fetchAiStatus().then((status) => {
    cached = status
    pending = null
    return status
  })
  return pending
}

export const useAiStatus = () => {
  const status = ref<AiStatus | null>(cached)
  const loading = ref(cached === null)

  const refresh = async (): Promise<void> => {
    loading.value = true
    status.value = await probe()
    loading.value = false
  }

  onMounted(() => {
    if (!cached) void refresh()
  })

  return { status, loading, refresh }
}
