<script setup lang="ts">
import { computed } from 'vue'
import type { ResumeDocument } from '@/domain/resume/model'
import { usesCompactHeader } from '@/domain/resume/renderer'

const props = defineProps<{ document: ResumeDocument }>()
const emit = defineEmits<{ change: [] }>()

const onInput = (): void => emit('change')

/** 头部版式：未显式设置时按是否有展示标题推断，与预览/导出的判断保持一致。 */
const headerLayoutModel = computed<'stacked' | 'compact'>({
  get: () => (usesCompactHeader(props.document.profile) ? 'compact' : 'stacked'),
  set: (value) => {
    props.document.profile.headerLayout = value
    onInput()
  },
})
</script>

<template>
  <div class="inspector-section">
    <div class="inspector-section__title">个人信息</div>
    <div class="form-grid">
      <label>姓名<input v-model="document.profile.name" type="text" @input="onInput" /></label>
      <label
        >目标职位<input v-model="document.profile.headline" type="text" @input="onInput"
      /></label>
      <label
        >投递岗位<input
          v-model="document.targetRole"
          type="text"
          placeholder="例如：Agent 应用开发"
          @input="onInput"
      /></label>
      <label>电话<input v-model="document.profile.phone" type="text" @input="onInput" /></label>
      <label>邮箱<input v-model="document.profile.email" type="email" @input="onInput" /></label>
      <label
        >所在城市<input v-model="document.profile.location" type="text" @input="onInput"
      /></label>
      <label
        >网站/作品集<input v-model="document.profile.website" type="url" @input="onInput"
      /></label>
    </div>
    <!--
      导入的 PDF 常被识别成「职位 + 姓名」的紧凑头部（displayTitle/detail），
      这几个字段以前只能由导入器写入、用户在界面上完全改不了，这里补上出口。
    -->
    <details class="inspector-advanced">
      <summary>头部排版（导入的简历常用）</summary>
      <div class="form-grid">
        <label
          >展示标题<input
            v-model="document.profile.displayTitle"
            type="text"
            placeholder="例如：Java 后端 · 3 年"
            @input="onInput"
        /></label>
        <label
          >头部简介<input
            v-model="document.profile.detail"
            type="text"
            placeholder="例如：24 岁 · 现居西安"
            @input="onInput"
        /></label>
      </div>
      <!-- 用 label[for] 而不是把 select 包进 label：包起来会把选项文案算进
           可访问名称，导致 getByLabel('姓名') 这类查询命中这个下拉框。 -->
      <div class="switch-row switch-row--stacked">
        <label for="header-layout-select">版式</label>
        <select id="header-layout-select" v-model="headerLayoutModel" aria-label="头部版式">
          <option value="stacked">分层（姓名 + 职位 + 联系方式）</option>
          <option value="compact">紧凑（展示标题与姓名合并一行）</option>
        </select>
      </div>
      <p class="control-note">
        填了展示标题或头部简介时默认走紧凑版式；想恢复分层样式，把版式改成「分层」即可。
      </p>
    </details>
  </div>
</template>
