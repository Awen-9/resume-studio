<script setup lang="ts">
import { computed } from 'vue'
import type { ResumeSection } from '@/domain/resume/model'
import { emphasizeLeadInHtml } from '@/domain/resume/leadIn'
import { sanitizeRichHtml } from '@/domain/resume/renderer'

/**
 * 一个内容模块的渲染单元。
 *
 * 预览页、测量页、导入确认页都用它，保证「量高度的结构」与「最终看到的」完全一致。
 * `slice` 用于模块跨页：同一个模块在续页只渲染它在这一页的那几条，标题会重复出现。
 * 选中态、data-section-id、点击事件都由父组件透传（Vue 的属性透传会合并到根节点）。
 */
const props = defineProps<{
  section: ResumeSection
  slice?: { start: number; end: number }
  /** 测量页需要给标题与条目打标记，供浏览器量高度。 */
  measure?: boolean
}>()

const items = computed(() =>
  props.slice ? props.section.items.slice(props.slice.start, props.slice.end) : props.section.items,
)
</script>

<template>
  <section class="resume-section" :data-measure-section="measure ? section.id : undefined">
    <h2 :data-measure-heading="measure ? '' : undefined">
      {{ section.title || '未命名模块' }}
    </h2>
    <div
      v-for="(item, index) in items"
      :key="item.id"
      class="resume-item"
      :data-measure-item="measure ? `${section.id}:${index}` : undefined"
    >
      <div v-if="item.title || item.period" class="resume-item__heading">
        <strong>{{ item.title }}</strong>
        <span>{{ item.period }}</span>
      </div>
      <div v-if="item.subtitle || item.location" class="resume-item__subheading">
        <span>{{ item.subtitle }}</span>
        <span>{{ item.location }}</span>
      </div>
      <!-- eslint-disable vue/no-v-html -- 内容经 sanitizeRichHtml 清洗后才渲染 -->
      <div
        v-if="item.content"
        class="resume-rich-text"
        v-html="emphasizeLeadInHtml(sanitizeRichHtml(item.content))"
      />
      <!-- eslint-enable vue/no-v-html -->
      <ul v-if="item.bullets.length" class="resume-bullets">
        <li v-for="(bullet, bulletIndex) in item.bullets" :key="`${item.id}-${bulletIndex}`">
          {{ bullet }}
        </li>
      </ul>
    </div>
  </section>
</template>
