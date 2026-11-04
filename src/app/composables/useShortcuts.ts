import { computed, onMounted, onUnmounted, type ComputedRef } from 'vue'
import type { useResumeStore } from '@/infrastructure/state/resumeStore'
import {
  activeEditor,
  textRedoAvailable,
  textUndoAvailable,
  touchEditor,
} from '@/shared/ui/activeEditor'
import type { ShowNotice } from './useBackup'

export interface ShortcutsOptions {
  store: ReturnType<typeof useResumeStore>
  showNotice: ShowNotice
}

export interface ShortcutsApi {
  canUndo: ComputedRef<boolean>
  canRedo: ComputedRef<boolean>
  undo: () => void
  redo: () => void
}

/** 输入框和正文编辑器里已经有原生/编辑器级撤销，别再插一手。 */
const isTextEntryFocused = (): boolean =>
  Boolean(document.activeElement?.closest('[contenteditable="true"], input, textarea, select'))

/**
 * 撤销/重做与全局快捷键。
 *
 * 撤销只有一个入口，粒度按焦点决定：
 * - 焦点在正文编辑器或输入框里 → 交给编辑器/浏览器自己的历史（按字符、按段）；
 * - 否则 → 走应用历史栈（按保存点，覆盖加模块、删条目、换版式这类结构修改）。
 *
 * 这样用户不需要记「哪个按钮是哪套语义」：Ctrl+Z 永远撤销刚才那一步。
 */
export const useShortcuts = (options: ShortcutsOptions): ShortcutsApi => {
  const { store, showNotice } = options

  const canUndo = computed(() => textUndoAvailable() || store.canUndo)
  const canRedo = computed(() => textRedoAvailable() || store.canRedo)

  const undo = (): void => {
    const editor = activeEditor.value
    if (editor?.can().undo()) {
      editor.commands.undo()
      touchEditor()
      return
    }
    void store.undo()
  }

  const redo = (): void => {
    const editor = activeEditor.value
    if (editor?.can().redo()) {
      editor.commands.redo()
      touchEditor()
      return
    }
    void store.redo()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!(event.metaKey || event.ctrlKey)) return
    const key = event.key.toLowerCase()
    if (key === 's') {
      event.preventDefault()
      void store.save()
      showNotice('已保存到本机')
      return
    }
    if (key === 'z' && !isTextEntryFocused()) {
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeyDown))
  onUnmounted(() => window.removeEventListener('keydown', onKeyDown))

  return { canUndo, canRedo, undo, redo }
}
