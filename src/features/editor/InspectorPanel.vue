<script setup lang="ts">
import { computed } from 'vue'
import { createId } from '@/domain/resume/defaults'
import RichTextEditor from './RichTextEditor.vue'
import { loadCustomTheme, saveCustomTheme } from '@/infrastructure/storage/templateStorage'
import {
  ACCENT_PRESETS,
  FONT_PRESETS,
  type PageMode,
  type ResumeDocument,
  type ResumeItem,
  type ResumeSection,
} from '@/domain/resume/model'

const props = defineProps<{
  document: ResumeDocument
  selectedSectionId: string
}>()

const emit = defineEmits<{
  change: []
  removeSection: [id: string]
}>()

const selectedSection = computed<ResumeSection | null>(() => {
  return props.document.sections.find((section) => section.id === props.selectedSectionId) ?? null
})

const addItem = (): void => {
  selectedSection.value?.items.push({
    id: createId('item'),
    title: '',
    subtitle: '',
    period: '',
    location: '',
    content: '',
    bullets: [],
  })
  emit('change')
}

const removeItem = (itemId: string): void => {
  if (!selectedSection.value || selectedSection.value.items.length <= 1) return
  selectedSection.value.items = selectedSection.value.items.filter((item) => item.id !== itemId)
  emit('change')
}

const addBullet = (item: ResumeItem): void => {
  item.bullets.push('')
  emit('change')
}

const removeBullet = (item: ResumeItem, index: number): void => {
  item.bullets.splice(index, 1)
  emit('change')
}

const updateContent = (item: ResumeItem, value: string): void => {
  item.content = value
  emit('change')
}

const onInput = (): void => emit('change')

const saveTemplate = (): void => {
  saveCustomTheme(props.document.theme)
  emit('change')
}

const applySavedTemplate = (): void => {
  const theme = loadCustomTheme()
  if (!theme) return
  props.document.theme = { ...theme }
  emit('change')
}

const setPageMode = (mode: PageMode): void => {
  props.document.theme.pageMode = mode
  onInput()
}

const applyAccent = (value: string): void => {
  props.document.theme.accentColor = value
  onInput()
}

const applyFontPreset = (value: string): void => {
  props.document.theme.fontFamily = value
  onInput()
}
</script>

<template>
  <aside class="inspector-panel">
    <div class="panel-heading">
      <div>
        <span class="eyebrow">INSPECTOR</span>
        <h2>属性面板</h2>
      </div>
    </div>

    <div class="inspector-section">
      <div class="inspector-section__title">个人信息</div>
      <div class="form-grid">
        <label>姓名<input v-model="document.profile.name" type="text" @input="onInput" /></label>
        <label
          >目标职位<input v-model="document.profile.headline" type="text" @input="onInput"
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
    </div>

    <div class="inspector-section">
      <div class="inspector-section__title">页面样式</div>
      <div class="segmented-control" role="group" aria-label="页面模式">
        <button
          type="button"
          :class="{ active: (document.theme.pageMode ?? 'standard') === 'standard' }"
          @click="setPageMode('standard')"
        >
          标准
        </button>
        <button
          type="button"
          :class="{ active: document.theme.pageMode === 'one-page-preferred' }"
          @click="setPageMode('one-page-preferred')"
        >
          一页优先
        </button>
        <button
          type="button"
          :class="{
            active:
              document.theme.pageMode === 'one-page-strict' ||
              document.theme.pageMode === 'one-page',
          }"
          @click="setPageMode('one-page-strict')"
        >
          强制一页
        </button>
      </div>
      <p v-if="document.theme.pageMode === 'one-page-preferred'" class="control-note">
        优先压缩排版，但内容过长时允许生成多页。
      </p>
      <p
        v-else-if="
          document.theme.pageMode === 'one-page-strict' || document.theme.pageMode === 'one-page'
        "
        class="control-note"
      >
        尽量保持一页，内容不会被删除；过长时会提示风险。
      </p>
      <div class="theme-actions">
        <label class="color-control"
          >强调色<input v-model="document.theme.accentColor" type="color" @input="onInput"
        /></label>
        <button type="button" class="text-button" @click="saveTemplate">保存当前样式</button>
        <button type="button" class="text-button" @click="applySavedTemplate">
          应用已保存样式
        </button>
      </div>
      <div class="preset-row">
        <span class="preset-row__label">配色</span>
        <button
          v-for="preset in ACCENT_PRESETS"
          :key="preset.id"
          type="button"
          class="swatch"
          :class="{ active: document.theme.accentColor.toLowerCase() === preset.value.toLowerCase() }"
          :style="{ '--swatch-color': preset.value }"
          :title="preset.label"
          :aria-label="`强调色 ${preset.label}`"
          @click="applyAccent(preset.value)"
        ></button>
      </div>
      <div class="form-grid">
        <label
          >模板
          <select v-model="document.theme.templateId" @change="onInput">
            <option value="classic">经典黑白</option>
            <option value="compact">紧凑单页</option>
            <option value="accent">蓝色强调</option>
          </select>
        </label>
        <label
          >字体
          <select :value="document.theme.fontFamily" @change="applyFontPreset(($event.target as HTMLSelectElement).value)">
            <option v-for="preset in FONT_PRESETS" :key="preset.id" :value="preset.value">
              {{ preset.label }}
            </option>
          </select>
        </label>
        <label
          >字号<input
            v-model.number="document.theme.fontSize"
            type="number"
            min="10"
            max="18"
            step="0.5"
            @input="onInput"
        /></label>
        <label
          >行距<input
            v-model.number="document.theme.lineHeight"
            type="number"
            min="1.2"
            max="2.4"
            step="0.05"
            @input="onInput"
        /></label>
        <label
          >页边距(mm)<input
            v-model.number="document.theme.pageMargin"
            type="number"
            min="10"
            max="30"
            step="1"
            @input="onInput"
        /></label>
        <label
          >模块间距(px)<input
            v-model.number="document.theme.sectionGap"
            type="number"
            min="8"
            max="40"
            step="1"
            @input="onInput"
        /></label>
      </div>
      <label class="switch-row"
        ><input
          v-model="document.theme.showPageNumber"
          type="checkbox"
          @change="onInput"
        />显示页码</label
      >
    </div>

    <div v-if="selectedSection" class="inspector-section">
      <div class="inspector-section__title inspector-section__title--with-action">
        <span>{{ selectedSection.title || '未命名模块' }}</span>
        <button
          type="button"
          class="text-button text-button--danger"
          @click="emit('removeSection', selectedSection.id)"
        >
          删除模块
        </button>
      </div>
      <label>模块标题<input v-model="selectedSection.title" type="text" @input="onInput" /></label>

      <div v-for="(item, itemIndex) in selectedSection.items" :key="item.id" class="item-editor">
        <div class="item-editor__heading">
          <span>内容 {{ itemIndex + 1 }}</span>
          <button
            v-if="selectedSection.items.length > 1"
            type="button"
            class="text-button text-button--danger"
            @click="removeItem(item.id)"
          >
            删除
          </button>
        </div>
        <div class="form-grid">
          <label>名称/项目<input v-model="item.title" type="text" @input="onInput" /></label>
          <label>职位/角色<input v-model="item.subtitle" type="text" @input="onInput" /></label>
          <label>时间<input v-model="item.period" type="text" @input="onInput" /></label>
          <label>地点<input v-model="item.location" type="text" @input="onInput" /></label>
        </div>
        <label>描述</label>
        <RichTextEditor
          :model-value="item.content"
          :ariaLabel="`${selectedSection.title}描述`"
          @update:model-value="updateContent(item, $event)"
        />
        <div class="bullet-editor">
          <div class="item-editor__heading">
            <span>要点列表</span
            ><button type="button" class="text-button" @click="addBullet(item)">+ 添加要点</button>
          </div>
          <div
            v-for="(_, bulletIndex) in item.bullets"
            :key="`${item.id}-bullet-${bulletIndex}`"
            class="bullet-row"
          >
            <span>•</span
            ><input
              v-model="item.bullets[bulletIndex]"
              type="text"
              :aria-label="`要点 ${bulletIndex + 1}`"
              @input="onInput"
            /><button type="button" title="删除要点" @click="removeBullet(item, bulletIndex)">
              ×
            </button>
          </div>
        </div>
      </div>
      <button type="button" class="button button--secondary button--full" @click="addItem">
        + 添加一条内容
      </button>
    </div>
  </aside>
</template>
