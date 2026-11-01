<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'

const props = defineProps<{
  modelValue: string
  ariaLabel: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

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
})

watch(
  () => props.modelValue,
  (value) => {
    if (editor.value && value !== editor.value.getHTML())
      editor.value.commands.setContent(value, { emitUpdate: false })
  },
)

onBeforeUnmount(() => editor.value?.destroy())
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
    </div>
    <EditorContent :editor="editor" />
  </div>
</template>
