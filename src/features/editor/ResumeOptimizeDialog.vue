<script setup lang="ts">
import { computed, ref } from 'vue'
import { resumeToPlainText } from '@/domain/interview'
import type { ResumeDocument } from '@/domain/resume/model'
import { applyResumeEdits, type ResumeEdit } from '@/domain/resume/applyEdits'
import { optimizeResume } from '@/infrastructure/api/localResumeApi'
import { useDialogA11y } from '@/shared/ui/useDialogA11y'

const props = defineProps<{ document: ResumeDocument }>()
const emit = defineEmits<{ close: []; change: [] }>()

const jd = ref('')
const summary = ref('')
const edits = ref<Array<ResumeEdit & { applied?: boolean }>>([])
const generating = ref(false)
const errorMessage = ref('')
const appliedCount = ref(0)

const dialogRef = ref<HTMLElement | null>(null)
useDialogA11y(dialogRef, { isOpen: () => true, onClose: () => emit('close') })

const canGenerate = computed(() => !generating.value && jd.value.trim().length >= 10)
const remaining = computed(() => edits.value.filter((edit) => !edit.applied))

const generate = async (): Promise<void> => {
  if (!canGenerate.value) return
  generating.value = true
  errorMessage.value = ''
  summary.value = ''
  edits.value = []
  appliedCount.value = 0
  try {
    const result = await optimizeResume({
      jd: jd.value.trim(),
      resume: resumeToPlainText(props.document),
    })
    summary.value = result.summary
    edits.value = result.edits.map((edit) => ({ ...edit, applied: false }))
    if (edits.value.length === 0) {
      errorMessage.value = '没有发现值得改的地方，这份简历已经很贴合 JD 了。'
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '生成建议失败'
  } finally {
    generating.value = false
  }
}

const adopt = (edit: ResumeEdit & { applied?: boolean }): void => {
  const result = applyResumeEdits(props.document, [edit])
  if (result.applied > 0) {
    edit.applied = true
    appliedCount.value += 1
    emit('change')
  }
}

const adoptAll = (): void => {
  const pending = remaining.value
  const result = applyResumeEdits(props.document, pending)
  appliedCount.value += result.applied
  for (const edit of pending) {
    edit.applied = !result.failed.some((failed) => failed.before === edit.before)
  }
  if (result.applied > 0) emit('change')
}
</script>

<template>
  <div class="dialog-backdrop" @click.self="emit('close')">
    <section
      ref="dialogRef"
      class="optimize-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="AI 改简历"
    >
      <header class="export-dialog__header">
        <div>
          <span class="eyebrow">AI RESUME</span>
          <h2>AI 改简历</h2>
        </div>
        <button type="button" class="icon-button" aria-label="关闭" @click="emit('close')">
          ×
        </button>
      </header>

      <div class="optimize-body">
        <label class="optimize-jd">
          <span>粘贴岗位描述（JD）</span>
          <textarea
            v-model="jd"
            rows="6"
            placeholder="把目标岗位的 JD 粘进来，AI 会据此给出改写建议。"
          />
        </label>

        <div class="optimize-actions">
          <button
            type="button"
            class="button button--primary"
            :disabled="!canGenerate"
            @click="generate"
          >
            {{ generating ? '分析中…' : '生成建议' }}
          </button>
          <button
            v-if="remaining.length > 0"
            type="button"
            class="button button--secondary"
            @click="adoptAll"
          >
            全部采用（{{ remaining.length }}）
          </button>
          <span v-if="appliedCount > 0" class="interview-hint">已采用 {{ appliedCount }} 条</span>
        </div>

        <p v-if="summary" class="optimize-summary">{{ summary }}</p>
        <p v-if="errorMessage" class="control-note control-note--warn">{{ errorMessage }}</p>

        <ul class="optimize-edits">
          <li v-for="(edit, index) in edits" :key="index" :class="{ applied: edit.applied }">
            <p class="optimize-edit__before">原文：{{ edit.before }}</p>
            <p class="optimize-edit__after">改为：{{ edit.after }}</p>
            <p class="optimize-edit__reason">{{ edit.reason }}</p>
            <button v-if="!edit.applied" type="button" class="text-button" @click="adopt(edit)">
              采用
            </button>
            <span v-else class="optimize-edit__applied">已采用 ✓</span>
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>
