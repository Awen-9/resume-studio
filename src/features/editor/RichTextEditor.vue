<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { rewriteResumeTextStream } from '@/infrastructure/api/localResumeApi'
import { clearActiveEditor, setActiveEditor, touchEditor } from '@/shared/ui/activeEditor'
import { useAiStatus } from '@/shared/ui/useAiStatus'

const props = defineProps<{
  modelValue: string
  ariaLabel: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const rewriting = ref(false)
const aiError = ref('')
/**
 * 本机模型不可用时直接禁用入口，并把原因写在按钮旁边。
 * 之前是「点了才知道 502」，用户以为是自己操作错了。
 */
const { status: aiStatus } = useAiStatus()
const aiUnavailable = computed(() => aiStatus.value !== null && !aiStatus.value.available)
const aiButtonTitle = computed(() =>
  aiUnavailable.value
    ? '本机模型未就绪：请先启动 Ollama 并导入配置的模型'
    : '用本机模型改写：选中则改选中内容，未选中则改写当前段落',
)
/** 流式增量文本：生成过程中先给个即时反馈。 */
const streamText = ref('')
/** 生成完成后待确认的 HTML（保留原文的块类型与行内样式）。 */
const pendingHtml = ref('')
const pendingRange = ref<{ from: number; to: number } | null>(null)

interface RewriteTarget {
  from: number
  to: number
  bulletList: boolean
  orderedList: boolean
  /** 是否需要在结果外面补一层 <ul>/<ol>（单条列表整体替换时需要，多条的就不能再套）。 */
  wrapList: boolean
  bold: boolean
  italic: boolean
}

const editor = useEditor({
  content: props.modelValue,
  extensions: [StarterKit],
  editorProps: {
    attributes: {
      class: 'rich-editor__content',
      'aria-label': props.ariaLabel,
    },
  },
  onUpdate: ({ editor: currentEditor }) => {
    emit('update:modelValue', currentEditor.getHTML())
  },
  // 焦点进出用于路由撤销：在正文里按 Ctrl+Z 走编辑器历史，在外面走应用历史
  onFocus: ({ editor: currentEditor }) => setActiveEditor(currentEditor),
  onBlur: ({ editor: currentEditor }) => clearActiveEditor(currentEditor),
  onTransaction: () => touchEditor(),
})

watch(
  () => props.modelValue,
  (value) => {
    if (editor.value && value !== editor.value.getHTML())
      editor.value.commands.setContent(value, { emitUpdate: false })
  },
)

onBeforeUnmount(() => {
  clearActiveEditor()
  editor.value?.destroy()
})

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 模型返回的是「- 要点」纯文本；按原段落的块类型与行内样式还原，避免改写后排版走样。 */
const buildHtml = (text: string, target: RewriteTarget): string => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*•]\s*/, '').trim())
    .filter((line) => line.length > 0)

  const inline = (line: string): string => {
    let inner = escapeHtml(line)
    if (target.italic) inner = `<em>${inner}</em>`
    if (target.bold) inner = `<strong>${inner}</strong>`
    return inner
  }

  const isList = target.bulletList || target.orderedList
  if (isList && target.wrapList) {
    const tag = target.bulletList ? 'ul' : 'ol'
    return `<${tag}>${lines.map((line) => `<li><p>${inline(line)}</p></li>`).join('')}</${tag}>`
  }
  // 列表里只替换当前条目内容时不能再套一层列表，否则会变成嵌套列表
  return lines.map((line) => `<p>${inline(line)}</p>`).join('')
}

const captureTarget = (current: NonNullable<typeof editor.value>): RewriteTarget => {
  const { from, to, empty, $from } = current.state.selection
  // 没选中时只改「光标所在段落」，而不是整段描述
  let range = empty ? { from: $from.start($from.depth), to: $from.end($from.depth) } : { from, to }

  const bulletList = current.isActive('bulletList')
  const orderedList = current.isActive('orderedList')
  let wrapList = false

  if (empty && (bulletList || orderedList)) {
    // 找到所在列表节点：只有一条时整体替换，多条时只替换当前条目，避免误删别的要点
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const node = $from.node(depth)
      if (node.type.name !== 'bulletList' && node.type.name !== 'orderedList') continue
      if (node.childCount === 1) {
        range = { from: $from.before(depth), to: $from.after(depth) }
        wrapList = true
      }
      break
    }
  }

  return {
    ...range,
    bulletList,
    orderedList,
    wrapList,
    bold: current.isActive('bold'),
    italic: current.isActive('italic'),
  }
}

const rewriteWithAi = async (): Promise<void> => {
  const current = editor.value
  if (!current || rewriting.value) return

  const target = captureTarget(current)
  const source = current.state.doc.textBetween(target.from, target.to, '\n').trim()
  if (!source) {
    aiError.value = '没有可改写的内容'
    return
  }

  rewriting.value = true
  aiError.value = ''
  streamText.value = ''
  pendingHtml.value = ''
  pendingRange.value = null
  try {
    const result = await rewriteResumeTextStream(source, (delta) => {
      streamText.value += delta
    })
    const html = buildHtml(result, target)
    if (!html) throw new Error('模型返回了空内容，请检查 Ollama 是否正常')
    pendingHtml.value = html
    pendingRange.value = { from: target.from, to: target.to }
  } catch (error) {
    aiError.value = error instanceof Error ? error.message : 'AI 改写失败'
  } finally {
    rewriting.value = false
    streamText.value = ''
  }
}

/** 采用预览结果：单次事务替换，Ctrl+Z 可一步撤回。 */
const acceptRewrite = (): void => {
  const current = editor.value
  if (!current || !pendingHtml.value || !pendingRange.value) return
  current.chain().focus().insertContentAt(pendingRange.value, pendingHtml.value).run()
  pendingHtml.value = ''
  pendingRange.value = null
}

const discardRewrite = (): void => {
  pendingHtml.value = ''
  pendingRange.value = null
}
</script>

<template>
  <div class="rich-editor">
    <div
      v-if="editor"
      class="rich-editor__toolbar"
      role="toolbar"
      :aria-label="`${ariaLabel}格式工具`"
    >
      <button
        type="button"
        title="粗体"
        :class="{ active: editor.isActive('bold') }"
        @click="editor.chain().focus().toggleBold().run()"
      >
        B
      </button>
      <button
        type="button"
        title="斜体"
        :class="{ active: editor.isActive('italic') }"
        @click="editor.chain().focus().toggleItalic().run()"
      >
        I
      </button>
      <button
        type="button"
        title="无序列表"
        :class="{ active: editor.isActive('bulletList') }"
        @click="editor.chain().focus().toggleBulletList().run()"
      >
        •
      </button>
      <button
        type="button"
        title="清除格式"
        @click="editor.chain().focus().clearNodes().unsetAllMarks().run()"
      >
        清除
      </button>
      <span class="rich-editor__divider" aria-hidden="true"></span>
      <button
        type="button"
        class="rich-editor__ai"
        :title="aiButtonTitle"
        :disabled="rewriting || Boolean(pendingHtml) || aiUnavailable"
        @click="rewriteWithAi"
      >
        {{ rewriting ? '改写中…' : 'AI 改写' }}
      </button>
      <span v-if="aiUnavailable" class="rich-editor__ai-hint" title="AI 改写依赖本机 Ollama">
        本机模型未就绪
      </span>
      <span v-if="aiError" class="rich-editor__ai-error" :title="aiError">{{ aiError }}</span>
    </div>

    <div v-if="rewriting" class="rich-editor__ai-preview" aria-live="polite">
      <span class="rich-editor__ai-preview-label">生成中</span>
      <span class="rich-editor__ai-preview-text">{{ streamText || '等待模型响应…' }}</span>
    </div>

    <div v-else-if="pendingHtml" class="rich-editor__ai-preview rich-editor__ai-preview--ready">
      <div class="rich-editor__ai-preview-head">
        <span class="rich-editor__ai-preview-label">改写预览 · 格式与原文一致</span>
        <span class="rich-editor__ai-preview-actions">
          <button type="button" class="button button--primary" @click="acceptRewrite">采用</button>
          <button type="button" class="text-button" @click="discardRewrite">放弃</button>
        </span>
      </div>
      <!-- pendingHtml 里的文本已逐行转义，只包含我们自己生成的 <p>/<ul>/<strong> 标签 -->
      <!-- eslint-disable-next-line vue/no-v-html -- 内容经 buildHtml 逐行 escapeHtml -->
      <div class="rich-editor__ai-preview-body" v-html="pendingHtml"></div>
    </div>

    <EditorContent :editor="editor" />
  </div>
</template>
