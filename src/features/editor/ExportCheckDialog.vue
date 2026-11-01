<script setup lang="ts">
import { computed } from 'vue'
import type { ExportCheckIssue, ResumeLayoutStatus } from '@/domain/resume/checks'
import { checkResumeBeforeExport } from '@/domain/resume/checks'
import type { ResumeDocument } from '@/domain/resume/model'

const props = defineProps<{
  document: ResumeDocument
  layout: ResumeLayoutStatus
  format: 'pdf' | 'docx'
}>()

const emit = defineEmits<{
  close: []
  confirm: []
}>()

const issues = computed<ExportCheckIssue[]>(() =>
  checkResumeBeforeExport(props.document, props.layout),
)
const hasErrors = computed(() => issues.value.some((issue) => issue.severity === 'error'))
const summary = computed(() => {
  const errors = issues.value.filter((issue) => issue.severity === 'error').length
  const warnings = issues.value.filter((issue) => issue.severity === 'warning').length
  if (errors > 0) return `${errors} 项问题需要修改`
  if (warnings > 0) return `${warnings} 项提醒，仍可继续导出`
  return '可以导出'
})
</script>

<template>
  <div class="dialog-backdrop" @click.self="emit('close')">
    <section
      class="export-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-check-title"
    >
      <header class="export-dialog__header">
        <div>
          <span class="eyebrow">EXPORT CHECK</span>
          <h2 id="export-check-title">导出前检查</h2>
        </div>
        <button type="button" class="icon-button" title="关闭检查" @click="emit('close')">×</button>
      </header>

      <div class="export-dialog__summary" :class="{ blocked: hasErrors }">
        <strong>{{ summary }}</strong>
        <span
          >{{ layout.pageCount }} 页 ·
          {{
            document.theme.pageMode === 'one-page-strict'
              ? '一页模式'
              : document.theme.pageMode === 'one-page-preferred'
                ? '一页优先'
                : '标准模式'
          }}</span
        >
      </div>

      <ul class="check-list">
        <li v-for="issue in issues" :key="issue.code" :class="`check-list__${issue.severity}`">
          <span class="check-list__mark">{{
            issue.severity === 'success' ? '✓' : issue.severity === 'error' ? '!' : 'i'
          }}</span>
          <span>{{ issue.message }}</span>
        </li>
      </ul>

      <footer class="export-dialog__actions">
        <button type="button" class="button button--secondary" @click="emit('close')">
          返回修改
        </button>
        <button
          type="button"
          class="button button--primary"
          :disabled="hasErrors"
          @click="emit('confirm')"
        >
          导出 {{ format === 'docx' ? 'Word' : 'PDF' }}
        </button>
      </footer>
    </section>
  </div>
</template>
