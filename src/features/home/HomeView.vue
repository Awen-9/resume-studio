<script setup lang="ts">
import { TEMPLATE_LABELS } from '@/domain/resume/model'
import type { ResumeSummary, TemplateId } from '@/domain/resume/model'

defineProps<{
  documents: ResumeSummary[]
}>()

const emit = defineEmits<{
  open: [id: string]
  create: [templateId: TemplateId]
  remove: [id: string]
  backup: []
  restore: [file: File]
  importPdf: [file: File]
}>()

const formatDate = (value: string): string => {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

const onRestore = (event: Event): void => {
  const input = event.target as HTMLInputElement
  if (input.files?.[0]) emit('restore', input.files[0])
  input.value = ''
}

const onPdfImport = (event: Event): void => {
  const input = event.target as HTMLInputElement
  if (input.files?.[0]) emit('importPdf', input.files[0])
  input.value = ''
}
</script>

<template>
  <main class="home-view">
    <header class="home-header">
      <div>
        <span class="eyebrow">LOCAL RESUME STUDIO</span>
        <h1>我的简历</h1>
        <p>内容保存在本机，打开就能继续编辑。</p>
      </div>
      <div class="home-actions">
        <button type="button" class="button button--secondary" @click="emit('backup')">
          导出备份
        </button>
        <label class="button button--secondary" for="restore-file"
          >导入备份<input
            id="restore-file"
            type="file"
            accept="application/json"
            hidden
            @change="onRestore"
        /></label>
        <label class="button button--secondary" for="import-pdf"
          >导入 PDF<input
            id="import-pdf"
            type="file"
            accept="application/pdf,.pdf"
            hidden
            @change="onPdfImport"
        /></label>
        <button type="button" class="button button--primary" @click="emit('create', 'classic')">
          + 新建简历
        </button>
      </div>
    </header>

    <section class="home-section">
      <div class="section-heading-row">
        <div>
          <span class="eyebrow">DOCUMENTS</span>
          <h2>最近编辑</h2>
        </div>
        <span class="muted-text">{{ documents.length }} 份本地简历</span>
      </div>
      <div class="document-grid">
        <button
          v-for="document in documents"
          :key="document.id"
          type="button"
          class="document-card"
          @click="emit('open', document.id)"
        >
          <span class="document-card__preview" :class="`template-${document.templateId}`"
            ><span></span><span></span><span></span><span></span
          ></span>
          <span class="document-card__body"
            ><strong>{{ document.title }}</strong
            ><small
              >{{ TEMPLATE_LABELS[document.templateId] }} ·
              {{ formatDate(document.updatedAt) }}</small
            ></span
          >
          <span
            class="document-card__delete"
            title="删除简历"
            @click.stop="emit('remove', document.id)"
            >×</span
          >
        </button>
        <button
          type="button"
          class="document-card document-card--new"
          @click="emit('create', 'classic')"
        >
          <span class="document-card--new__icon">+</span><strong>创建一份新简历</strong
          ><small>从经典黑白模板开始</small>
        </button>
      </div>
    </section>

    <section class="home-section template-section">
      <div class="section-heading-row">
        <div>
          <span class="eyebrow">TEMPLATES</span>
          <h2>选择一个起点</h2>
        </div>
      </div>
      <div class="template-grid">
        <button
          v-for="template in ['classic', 'compact', 'accent'] as TemplateId[]"
          :key="template"
          type="button"
          class="template-card"
          @click="emit('create', template)"
        >
          <span class="document-card__preview" :class="`template-${template}`"
            ><span></span><span></span><span></span><span></span
          ></span>
          <span
            ><strong>{{ TEMPLATE_LABELS[template] }}</strong
            ><small>新建并开始编辑</small></span
          >
        </button>
      </div>
    </section>
  </main>
</template>
