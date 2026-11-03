import { nextTick, onBeforeUnmount, onMounted, watch, type Ref } from 'vue'

/** 可聚焦元素的选择器：够用即可，不要为了覆盖边角情况把规则写成一团。 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

interface DialogA11yOptions {
  /** 对话框当前是否可见；`v-show` 隐藏时不应继续劫持键盘。 */
  isOpen: () => boolean
  onClose: () => void
}

/**
 * 对话框的基础可访问性行为：Esc 关闭、打开时聚焦第一个可聚焦元素、
 * Tab / Shift+Tab 在对话框内循环、关闭后把焦点还给触发它的元素。
 *
 * 之前两个弹窗只有 `role="dialog"`，键盘用户按 Esc 没反应、Tab 会跑到背后的
 * 编辑器里、关闭后焦点丢到 body 上。行为集中在这里，避免每个弹窗各写一遍还漏。
 */
export const useDialogA11y = (
  container: Ref<HTMLElement | null>,
  { isOpen, onClose }: DialogA11yOptions,
): void => {
  let previousFocus: HTMLElement | null = null

  const focusables = (): HTMLElement[] => {
    const nodes = container.value?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    if (!nodes) return []
    // 过滤掉 display:none / hidden 的元素，否则会把焦点扔进不可见控件
    return Array.from(nodes).filter((element) => element.offsetParent !== null)
  }

  const focusFirst = async (): Promise<void> => {
    await nextTick()
    const [first] = focusables()
    first?.focus()
  }

  const onKeydown = (event: KeyboardEvent): void => {
    if (!isOpen()) return
    // 中文输入法组词时 Esc 属于「取消组词」，不应该顺带关掉对话框
    if (event.key === 'Escape' && !event.isComposing) {
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const items = focusables()
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    const inside = container.value?.contains(active) ?? false
    if (event.shiftKey && (!inside || active === first)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  onMounted(() => {
    document.addEventListener('keydown', onKeydown, true)
    if (isOpen()) {
      previousFocus = document.activeElement as HTMLElement | null
      void focusFirst()
    }
  })

  watch(
    isOpen,
    (open) => {
      if (open) {
        previousFocus = document.activeElement as HTMLElement | null
        void focusFirst()
        return
      }
      previousFocus?.focus?.()
      previousFocus = null
    },
    { flush: 'post' },
  )

  onBeforeUnmount(() => {
    document.removeEventListener('keydown', onKeydown, true)
    previousFocus?.focus?.()
  })
}
