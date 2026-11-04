import { onMounted, onUnmounted, ref, type Ref } from 'vue'
import type { useResumeStore } from '@/infrastructure/state/resumeStore'

/** 多标签页协作信号：每次保存写一条，其他标签页通过 storage 事件感知。 */
export const SYNC_KEY_PREFIX = 'resume-studio:saved:'

export interface AutoSaveApi {
  /** 有待写入的编辑（防抖窗口内或保存失败）。 */
  dirty: Ref<boolean>
  scheduleSave: () => void
  /** 立即落盘：导出、返回列表之前调用，避免拿到少一次改动的数据。 */
  flushSave: () => Promise<void>
}

/**
 * 自动保存：350ms 防抖 + 立即落盘。
 *
 * 保存是背景行为，不再每 350ms 弹一次 toast——工具栏已有「已保存 hh:mm」。
 * 组件卸载时清掉定时器和 beforeunload 监听。
 */
export const useAutoSave = (store: ReturnType<typeof useResumeStore>): AutoSaveApi => {
  const dirty = ref(false)
  let saveTimer: number | undefined

  const scheduleSave = (): void => {
    dirty.value = true
    if (saveTimer) window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(async () => {
      try {
        await store.save()
        dirty.value = Boolean(store.storageError)
        // 通知其他标签页：这份简历变了
        window.localStorage.setItem(
          `${SYNC_KEY_PREFIX}${store.currentDocument.id}`,
          String(Date.now()),
        )
      } catch {
        // store.save 内部已记录失败原因并以横幅展示，这里只保住 dirty 状态
        dirty.value = true
      }
    }, 350)
  }

  const flushSave = async (): Promise<void> => {
    if (saveTimer) {
      window.clearTimeout(saveTimer)
      saveTimer = undefined
    }
    await store.save()
  }

  /** 防抖窗口内直接关页面会丢掉最后几次输入，这里拦一下（现代浏览器只看 preventDefault）。 */
  const onBeforeUnload = (event: Event): void => {
    if (!dirty.value) return
    event.preventDefault()
  }

  onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
  onUnmounted(() => {
    window.removeEventListener('beforeunload', onBeforeUnload)
    if (saveTimer) window.clearTimeout(saveTimer)
  })

  return { dirty, scheduleSave, flushSave }
}
