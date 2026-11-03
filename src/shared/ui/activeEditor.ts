import { ref, shallowRef } from 'vue'

/**
 * 当前获得焦点的富文本编辑器。
 *
 * 撤销有两套天然的粒度：文本编辑要「按字符/按段」，结构修改（加模块、删条目、
 * 换版式）只能「按保存点」。与其让两个按钮各走一套、用户猜不到会发生什么，
 * 不如按焦点路由：焦点在正文编辑器里就交给它自己的历史，否则走应用的历史栈。
 *
 * 这里不引入 Tiptap 的类型依赖，只描述用得到的那几个方法，避免 UI 层被编辑器库绑死。
 */
export interface UndoableEditor {
  can: () => { undo: () => boolean; redo: () => boolean }
  commands: { undo: () => void; redo: () => void }
}

export const activeEditor = shallowRef<UndoableEditor | null>(null)

/** 编辑器每次事务后自增，让依赖它的按钮禁用态能重新计算。 */
export const editorRevision = ref(0)

export const setActiveEditor = (editor: UndoableEditor): void => {
  activeEditor.value = editor
  editorRevision.value += 1
}

/** 只清理自己：A 失焦后 B 才拿到焦点时，不能把 B 的注册抹掉。 */
export const clearActiveEditor = (editor?: UndoableEditor): void => {
  if (editor && activeEditor.value !== editor) return
  activeEditor.value = null
  editorRevision.value += 1
}

export const touchEditor = (): void => {
  editorRevision.value += 1
}

/** 读取时顺手消费 revision，保证在 computed 里是响应式的。 */
export const textUndoAvailable = (): boolean => {
  void editorRevision.value
  return activeEditor.value?.can().undo() ?? false
}

export const textRedoAvailable = (): boolean => {
  void editorRevision.value
  return activeEditor.value?.can().redo() ?? false
}
