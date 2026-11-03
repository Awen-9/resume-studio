<script setup lang="ts">
import { computed } from 'vue'
import type { ResumeDocument } from '@/domain/resume/model'
import { getResumeProfileFields, usesCompactHeader } from '@/domain/resume/renderer'

/**
 * 简历头部。预览页、测量页共用同一份标记，
 * 否则「量到的高度」和「画出来的高度」又会各走一套。
 */
const props = defineProps<{ document: ResumeDocument }>()

const compact = computed(() => usesCompactHeader(props.document.profile))
const fields = computed(() => getResumeProfileFields(props.document).join('  |  '))
</script>

<template>
  <header class="resume-header" :class="{ 'resume-header--compact': compact }">
    <template v-if="compact">
      <h1>
        {{
          [document.profile.displayTitle, document.profile.name].filter(Boolean).join(' ') ||
          '未填写姓名'
        }}
      </h1>
      <p class="resume-header__meta">{{ fields }}</p>
      <p v-if="document.profile.detail" class="resume-header__detail">
        {{ document.profile.detail }}
      </p>
      <p class="resume-header__headline">{{ document.profile.headline || '目标职位' }}</p>
    </template>
    <template v-else>
      <h1>{{ document.profile.name || '未填写姓名' }}</h1>
      <p class="resume-header__headline">{{ document.profile.headline || '目标职位' }}</p>
      <p v-if="fields" class="resume-header__meta">{{ fields }}</p>
    </template>
  </header>
</template>
