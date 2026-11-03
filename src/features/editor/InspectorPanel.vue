<script setup lang="ts">
import PersonalInfoSection from './inspector/PersonalInfoSection.vue'
import PageStyleSection from './inspector/PageStyleSection.vue'
import SectionContentEditor from './inspector/SectionContentEditor.vue'
import type { ResumeDocument } from '@/domain/resume/model'

/**
 * 属性面板的壳：只负责编排三个分区，不承载任何表单逻辑。
 *
 * 拆分前这里是 500 行的单体组件，改一处页面样式要在一屏模板里翻找；
 * 现在「个人信息 / 页面样式 / 模块内容」各自独立，新增字段时也更容易定位。
 */
defineProps<{
  document: ResumeDocument
  selectedSectionId: string
  /** 预览实测出的页数，给「页数」控件一个真实反馈。 */
  pageCount: number
}>()

const emit = defineEmits<{
  change: []
  removeSection: [id: string]
  removeItem: [sectionId: string, itemId: string]
  moveItem: [sectionId: string, itemId: string, direction: -1 | 1]
}>()
</script>

<template>
  <aside class="inspector-panel">
    <div class="panel-heading">
      <div>
        <span class="eyebrow">INSPECTOR</span>
        <h2>属性面板</h2>
      </div>
    </div>

    <PersonalInfoSection :document="document" @change="emit('change')" />
    <PageStyleSection :document="document" :page-count="pageCount" @change="emit('change')" />
    <SectionContentEditor
      :document="document"
      :selected-section-id="selectedSectionId"
      @change="emit('change')"
      @remove-section="emit('removeSection', $event)"
      @remove-item="(sectionId, itemId) => emit('removeItem', sectionId, itemId)"
      @move-item="(sectionId, itemId, direction) => emit('moveItem', sectionId, itemId, direction)"
    />
  </aside>
</template>
