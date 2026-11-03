<script setup lang="ts">
import { computed, ref } from 'vue'
import { SECTION_LABELS } from '@/domain/resume/model'
import type { ResumeSection, SectionType } from '@/domain/resume/model'

defineProps<{
  sections: ResumeSection[]
  selectedSectionId: string
}>()

const emit = defineEmits<{
  select: [id: string]
  toggle: [section: ResumeSection]
  move: [id: string, direction: -1 | 1]
  reorder: [id: string, targetIndex: number]
  remove: [id: string]
  add: [type: SectionType]
}>()

const selectedType = ref<SectionType>('custom')
const draggedId = ref<string | null>(null)
/** 拖到哪一行：给一个落点提示，否则拖动全程没有任何反馈。 */
const dropIndex = ref<number | null>(null)
const sectionTypes = computed(() => Object.entries(SECTION_LABELS) as [SectionType, string][])

const handleDrop = (targetIndex: number): void => {
  if (draggedId.value) emit('reorder', draggedId.value, targetIndex)
  draggedId.value = null
  dropIndex.value = null
}

const endDrag = (): void => {
  draggedId.value = null
  dropIndex.value = null
}
</script>

<template>
  <aside class="outline-panel">
    <div class="panel-heading">
      <div>
        <span class="eyebrow">CONTENT MAP</span>
        <h2>内容结构</h2>
      </div>
      <span class="count-badge">{{ sections.filter((item) => item.visible).length }}</span>
    </div>

    <nav class="section-list" aria-label="简历内容模块">
      <div
        v-for="(section, index) in sections"
        :key="section.id"
        class="section-list__item"
        draggable="true"
        role="button"
        tabindex="0"
        :class="{
          selected: selectedSectionId === section.id,
          hidden: !section.visible,
          'is-dragging': draggedId === section.id,
          'is-drop-target': dropIndex === index && draggedId !== section.id,
        }"
        :aria-current="selectedSectionId === section.id ? 'true' : undefined"
        @click="emit('select', section.id)"
        @keydown.enter.prevent="emit('select', section.id)"
        @keydown.space.prevent="emit('select', section.id)"
        @dragstart="draggedId = section.id"
        @dragend="endDrag"
        @dragover.prevent="dropIndex = index"
        @drop="handleDrop(index)"
      >
        <span class="section-list__index">{{ String(index + 1).padStart(2, '0') }}</span>
        <span class="section-list__title">{{ section.title || '未命名模块' }}</span>
        <!-- 按钮区不参与拖拽，否则想点按钮会先触发整行拖动 -->
        <span class="section-list__actions" draggable="false" @click.stop>
          <button
            type="button"
            title="上移"
            aria-label="上移模块"
            :disabled="index === 0"
            @click="emit('move', section.id, -1)"
          >
            ↑
          </button>
          <button
            type="button"
            title="下移"
            aria-label="下移模块"
            :disabled="index === sections.length - 1"
            @click="emit('move', section.id, 1)"
          >
            ↓
          </button>
          <button
            type="button"
            :title="section.visible ? '隐藏模块' : '显示模块'"
            :aria-label="section.visible ? '隐藏模块' : '显示模块'"
            :aria-pressed="section.visible"
            @click="emit('toggle', section)"
          >
            {{ section.visible ? '◉' : '○' }}
          </button>
        </span>
      </div>
    </nav>

    <div class="outline-panel__add">
      <label for="section-type">添加模块</label>
      <div class="inline-control">
        <select id="section-type" v-model="selectedType">
          <option v-for="[type, label] in sectionTypes" :key="type" :value="type">
            {{ label }}
          </option>
        </select>
        <button
          type="button"
          class="button button--small button--primary"
          title="添加模块"
          data-testid="add-section"
          @click="emit('add', selectedType)"
        >
          +
        </button>
      </div>
    </div>
  </aside>
</template>
