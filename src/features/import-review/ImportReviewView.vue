<script setup lang="ts">
import { ref } from 'vue'
import ResumePreview from '@/features/editor/ResumePreview.vue'
import { createId } from '@/domain/resume/defaults'
import type { ResumeImportResult } from '@/domain/resume/importParser'

const definePropsResult = defineProps<{
  result: ResumeImportResult
  sourceUrl: string
}>()
const result = definePropsResult.result
const sourceUrl = definePropsResult.sourceUrl

const emit = defineEmits<{
  cancel: []
  confirm: []
}>()

const selectedSectionId = ref(definePropsResult.result.document.sections[0]?.id ?? '')

const moveSection = (sectionId: string, direction: -1 | 1): void => {
  const sections = definePropsResult.result.document.sections
  const index = sections.findIndex((section) => section.id === sectionId)
  const target = index + direction
  if (index < 0 || target < 0 || target >= sections.length) return
  ;[sections[index], sections[target]] = [sections[target], sections[index]]
}

const removeSection = (sectionId: string): void => {
  if (definePropsResult.result.document.sections.length <= 1) return
  definePropsResult.result.document.sections = definePropsResult.result.document.sections.filter(
    (section) => section.id !== sectionId,
  )
  if (selectedSectionId.value === sectionId)
    selectedSectionId.value = definePropsResult.result.document.sections[0]?.id ?? ''
}

const addCustomSection = (): void => {
  const section = {
    id: createId('import-section'),
    type: 'custom' as const,
    title: '新模块',
    visible: true,
    items: [
      {
        id: createId('import-item'),
        title: '',
        subtitle: '',
        period: '',
        location: '',
        content: '',
        bullets: [],
      },
    ],
  }
  definePropsResult.result.document.sections.push(section)
  selectedSectionId.value = section.id
}
</script>

<template>
  <main class="import-review">
    <header class="import-review__toolbar">
      <div class="editor-toolbar__left">
        <button type="button" class="icon-button" title="取消导入" @click="emit('cancel')">
          ←
        </button>
        <div class="document-name">
          <strong>确认导入内容</strong>
          <span>解析结果不会自动覆盖已有简历</span>
        </div>
      </div>
      <div class="editor-toolbar__actions">
        <button type="button" class="button button--secondary" @click="emit('cancel')">取消</button>
        <button type="button" class="button button--primary" @click="emit('confirm')">
          导入并开始编辑
        </button>
      </div>
    </header>

    <div class="import-review__workspace">
      <aside class="import-review__panel">
        <span class="eyebrow">IMPORT REVIEW</span>
        <h1>{{ result.document.title }}</h1>
        <p class="import-review__lead">请先确认识别结果，再写入本地简历。</p>

        <section class="review-block">
          <div class="review-block__title">个人信息</div>
          <dl class="review-fields">
            <div>
              <dt>姓名</dt>
              <dd><input v-model="result.document.profile.name" aria-label="导入姓名" /></dd>
            </div>
            <div>
              <dt>目标职位</dt>
              <dd>
                <input v-model="result.document.profile.headline" aria-label="导入目标职位" />
              </dd>
            </div>
            <div>
              <dt>电话</dt>
              <dd><input v-model="result.document.profile.phone" aria-label="导入电话" /></dd>
            </div>
            <div>
              <dt>邮箱</dt>
              <dd><input v-model="result.document.profile.email" aria-label="导入邮箱" /></dd>
            </div>
          </dl>
        </section>

        <section class="review-block">
          <div class="review-block__title">识别到的模块</div>
          <div class="review-modules">
            <div
              v-for="section in result.document.sections"
              :key="section.id"
              class="review-module-row"
            >
              <button
                type="button"
                :class="{ selected: selectedSectionId === section.id }"
                @click="selectedSectionId = section.id"
              >
                <span>{{ section.title }}</span
                ><small>{{ section.items.length }} 条</small>
              </button>
              <div v-if="selectedSectionId === section.id" class="review-module-actions">
                <button type="button" title="上移模块" @click="moveSection(section.id, -1)">
                  ↑
                </button>
                <button type="button" title="下移模块" @click="moveSection(section.id, 1)">
                  ↓
                </button>
                <button type="button" title="删除模块" @click="removeSection(section.id)">
                  删除
                </button>
              </div>
            </div>
          </div>
          <button type="button" class="text-button import-add-module" @click="addCustomSection">
            + 添加自定义模块
          </button>
        </section>

        <section v-if="result.warnings.length" class="review-block review-block--warning">
          <div class="review-block__title">需要确认</div>
          <ul>
            <li v-for="warning in result.warnings" :key="warning">{{ warning }}</li>
          </ul>
        </section>

        <p class="import-review__meta">已提取 {{ result.extractedLines }} 行文字</p>
      </aside>

      <section class="import-source">
        <div class="import-column-heading">
          <strong>PDF 原文</strong>
          <a :href="sourceUrl" target="_blank" rel="noopener">打开原文件</a>
        </div>
        <pre class="import-source__text">{{ result.sourceText || '没有可显示的文字内容。' }}</pre>
      </section>

      <section class="import-result">
        <div class="import-column-heading">
          <strong>模板结果</strong>
          <span>点击模块可核对归类</span>
        </div>
        <ResumePreview
          :document="result.document"
          :selected-section-id="selectedSectionId"
          @select="selectedSectionId = $event"
        />
      </section>
    </div>
  </main>
</template>
