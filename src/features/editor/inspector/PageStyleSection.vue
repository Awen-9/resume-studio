<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ACCENT_PRESETS,
  FONT_PRESETS,
  type PageMode,
  type ResumeDocument,
} from '@/domain/resume/model'
import { loadCustomTheme, saveCustomTheme } from '@/infrastructure/storage/templateStorage'

const props = defineProps<{ document: ResumeDocument; pageCount: number }>()
const emit = defineEmits<{ change: [] }>()

const onInput = (): void => emit('change')

/** 存档存在与否决定「应用已保存样式」能不能点——不能点的时候要看得出来。 */
const savedTheme = ref(loadCustomTheme())

const saveTemplate = (): void => {
  saveCustomTheme(props.document.theme)
  savedTheme.value = loadCustomTheme()
  emit('change')
}

const applySavedTemplate = (): void => {
  if (!savedTheme.value) return
  props.document.theme = { ...savedTheme.value }
  emit('change')
}

const setPageMode = (mode: PageMode): void => {
  props.document.theme.pageMode = mode
  onInput()
}

const TARGET_PAGE_OPTIONS = [1, 2, 3, 4, 5, 6]

/** 固定页数：空值表示回到「自动」。 */
const setTargetPages = (value: string): void => {
  if (value === '') delete props.document.theme.targetPages
  else props.document.theme.targetPages = Number(value)
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

/**
 * 排版档位只负责「疏密」，不碰页数策略。
 *
 * 早期版本把 `pageMode` 也塞进档位里，于是点「紧凑」会把用户刚设的「一页优先」
 * 悄悄改回标准——两个控件抢同一个字段。现在密度（档位）与页数（下方控件）
 * 彻底分开：档位只写字号/行距/边距/间距。
 */
interface LayoutPreset {
  id: 'comfortable' | 'compact'
  label: string
  fontSize: number
  lineHeight: number
  pageMargin: number
  sectionGap: number
}

const LAYOUT_PRESETS: LayoutPreset[] = [
  {
    id: 'comfortable',
    label: '舒适',
    fontSize: 12.5,
    lineHeight: 1.65,
    pageMargin: 18,
    sectionGap: 18,
  },
  {
    id: 'compact',
    label: '紧凑',
    fontSize: 11.5,
    lineHeight: 1.45,
    pageMargin: 14,
    sectionGap: 12,
  },
]

const activePreset = computed(() => {
  const theme = props.document.theme
  return (
    LAYOUT_PRESETS.find(
      (preset) =>
        Math.abs(theme.fontSize - preset.fontSize) < 0.01 &&
        Math.abs(theme.lineHeight - preset.lineHeight) < 0.01 &&
        Math.abs(theme.pageMargin - preset.pageMargin) < 0.01 &&
        Math.abs(theme.sectionGap - preset.sectionGap) < 0.01,
    )?.id ?? null
  )
})

const applyLayoutPreset = (preset: LayoutPreset): void => {
  Object.assign(props.document.theme, {
    fontSize: preset.fontSize,
    lineHeight: preset.lineHeight,
    pageMargin: preset.pageMargin,
    sectionGap: preset.sectionGap,
  })
  onInput()
}

/** 「强制一页」经常做不到：如实说还差多少，而不是让用户以为已经一页。 */
const pageModeHint = computed(() => {
  const mode = props.document.theme.pageMode ?? 'standard'
  if (mode === 'one-page-preferred') {
    return props.pageCount > 1
      ? `已压缩排版，当前仍有 ${props.pageCount} 页；可精简内容或改用「强制一页」。`
      : '已压缩排版，保持在一页内。'
  }
  if (mode === 'one-page-strict') {
    return props.pageCount > 1
      ? `内容仍有 ${props.pageCount} 页，强制一页需要精简内容或调小字号。`
      : '已压缩到一页。'
  }
  return ''
})
</script>

<template>
  <div class="inspector-section">
    <div class="inspector-section__title">页面样式</div>
    <div class="preset-row preset-row--layout">
      <span class="preset-row__label">密度</span>
      <div class="segmented-control segmented-control--two" role="group" aria-label="排版密度">
        <button
          v-for="preset in LAYOUT_PRESETS"
          :key="preset.id"
          type="button"
          :class="{ active: activePreset === preset.id }"
          @click="applyLayoutPreset(preset)"
        >
          {{ preset.label }}
        </button>
      </div>
    </div>
    <p class="control-note">密度只影响疏密，不改变页数；想精确微调展开下方「高级」。</p>
    <div class="preset-row preset-row--layout">
      <span class="preset-row__label">页数</span>
      <!-- 固定页数生效时这一排不参与排版，禁用比「还能点但没效果」诚实 -->
      <div
        class="segmented-control"
        role="group"
        aria-label="页数控制"
        :aria-disabled="Boolean(document.theme.targetPages)"
      >
        <button
          type="button"
          :class="{ active: (document.theme.pageMode ?? 'standard') === 'standard' }"
          :disabled="Boolean(document.theme.targetPages)"
          :title="document.theme.targetPages ? '已设固定页数，此项暂不生效' : ''"
          @click="setPageMode('standard')"
        >
          标准
        </button>
        <button
          type="button"
          :class="{ active: document.theme.pageMode === 'one-page-preferred' }"
          :disabled="Boolean(document.theme.targetPages)"
          :title="document.theme.targetPages ? '已设固定页数，此项暂不生效' : ''"
          @click="setPageMode('one-page-preferred')"
        >
          一页优先
        </button>
        <button
          type="button"
          :class="{ active: document.theme.pageMode === 'one-page-strict' }"
          :disabled="Boolean(document.theme.targetPages)"
          :title="document.theme.targetPages ? '已设固定页数，此项暂不生效' : ''"
          @click="setPageMode('one-page-strict')"
        >
          强制一页
        </button>
      </div>
      <span class="page-count-badge" :class="{ 'page-count-badge--long': pageCount > 2 }">
        {{ pageCount }} 页
      </span>
    </div>

    <!-- 固定页数：把内容均摊到指定页数并撑满；与上面的「页数」模式互斥 -->
    <div class="preset-row preset-row--layout">
      <span class="preset-row__label">固定页数</span>
      <select
        class="page-target-select"
        :value="document.theme.targetPages ?? ''"
        aria-label="固定页数"
        @change="setTargetPages(($event.target as HTMLSelectElement).value)"
      >
        <option value="">自动（按内容）</option>
        <option v-for="option in TARGET_PAGE_OPTIONS" :key="option" :value="option">
          {{ option }} 页
        </option>
      </select>
    </div>
    <p v-if="document.theme.targetPages" class="control-note">
      强制 {{ document.theme.targetPages }}
      页：内容均摊并撑满；放不下就一路缩小字号直到刚好这么多页（预览会说明缩到了多大），此时上面的页数模式不生效。
    </p>
    <p
      v-if="document.theme.targetPages && pageCount !== document.theme.targetPages"
      class="control-note control-note--warn"
    >
      {{
        pageCount > document.theme.targetPages
          ? `内容太多：已压到最小字号仍需要 ${pageCount} 页，建议精简内容。`
          : `内容不足以铺满 ${document.theme.targetPages} 页（当前 ${pageCount} 页），可以补充内容。`
      }}
    </p>
    <p v-if="pageModeHint" class="control-note" :class="{ 'control-note--warn': pageCount > 1 }">
      {{ pageModeHint }}
    </p>
    <div class="theme-actions">
      <label class="color-control"
        >强调色<input v-model="document.theme.accentColor" type="color" @input="onInput"
      /></label>
      <button type="button" class="text-button" @click="saveTemplate">保存当前样式</button>
      <button
        type="button"
        class="text-button"
        :disabled="!savedTheme"
        :title="savedTheme ? '把存档的样式套到当前简历' : '还没保存过样式'"
        @click="applySavedTemplate"
      >
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
        :class="{
          active: document.theme.accentColor.toLowerCase() === preset.value.toLowerCase(),
        }"
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
        <select
          :value="document.theme.fontFamily"
          @change="applyFontPreset(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="preset in FONT_PRESETS" :key="preset.id" :value="preset.value">
            {{ preset.label }}
          </option>
        </select>
      </label>
    </div>
    <details class="inspector-advanced">
      <summary>高级：手动微调数值</summary>
      <div class="form-grid">
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
    </details>
    <label class="switch-row"
      ><input
        v-model="document.theme.showPageNumber"
        type="checkbox"
        @change="onInput"
      />显示页码</label
    >
  </div>
</template>
