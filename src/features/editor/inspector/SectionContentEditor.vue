<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue'
import { createId } from '@/domain/resume/defaults'
import {
  SECTION_LABELS,
  type ResumeDocument,
  type ResumeItem,
  type ResumeSection,
  type SectionType,
} from '@/domain/resume/model'

/**
 * Tiptap 是首屏最大的一块依赖，按需加载：
 * 只有展开某一条内容时才需要富文本编辑器，首页和预览不该为它买单。
 */
const RichTextEditor = defineAsyncComponent(() => import('../RichTextEditor.vue'))

const props = defineProps<{
  document: ResumeDocument
  selectedSectionId: string
}>()

const emit = defineEmits<{
  change: []
  removeSection: [id: string]
  removeItem: [sectionId: string, itemId: string]
  moveItem: [sectionId: string, itemId: string, direction: -1 | 1]
}>()

const selectedSection = computed<ResumeSection | null>(() => {
  return props.document.sections.find((section) => section.id === props.selectedSectionId) ?? null
})

/** 一次只展开一个内容块，避免右栏变成一堵表单墙。 */
const openItemId = ref<string>('')
/** 模块编辑区本身，用于「点预览/大纲后把右栏滚到对应位置」。 */
const sectionRoot = ref<HTMLElement | null>(null)
/** 刚跳转过来时闪一下，让用户确认右栏确实跟着换了。 */
const flashing = ref(false)
let flashTimer: number | undefined
/** 首次挂载不滚动：刚打开简历就跳过个人信息太突兀。 */
let mounted = false

const scrollToSection = async (): Promise<void> => {
  await nextTick()
  const root = sectionRoot.value
  // 右栏才是滚动容器：直接滚窗口会让整页跳，三栏布局里体验很差
  const panel = root?.closest<HTMLElement>('.inspector-panel')
  if (!root || !panel) return
  const top =
    panel.scrollTop + root.getBoundingClientRect().top - panel.getBoundingClientRect().top - 8
  panel.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })

  flashing.value = true
  if (flashTimer) window.clearTimeout(flashTimer)
  flashTimer = window.setTimeout(() => (flashing.value = false), 800)
}

watch(
  () => props.selectedSectionId,
  () => {
    openItemId.value = selectedSection.value?.items[0]?.id ?? ''
    if (mounted) void scrollToSection()
  },
  { immediate: true },
)

onMounted(() => {
  mounted = true
})

/** 展开的那条被删掉后，自动展开第一条，别让整块突然全折叠。 */
watch(
  () => selectedSection.value?.items.map((item) => item.id).join('|') ?? '',
  () => {
    const items = selectedSection.value?.items ?? []
    if (items.length > 0 && !items.some((item) => item.id === openItemId.value)) {
      openItemId.value = items[0].id
    }
  },
)

onBeforeUnmount(() => {
  if (flashTimer) window.clearTimeout(flashTimer)
})

const onInput = (): void => emit('change')

/**
 * 按模块类型给一句写法提示。
 *
 * 只给「怎么写」而不给「写什么」——模板文案容易让所有简历变得一样，
 * 但「动词开头 + 量化结果」这类结构建议是普适的。
 */
const tipsFor = (type: SectionType): string => {
  if (type === 'experience' || type === 'project') {
    return '建议 2–4 条：动词开头（负责 / 推动 / 设计），尽量带上量化结果。'
  }
  if (type === 'education') return '课程、绩点、排名有亮点就写，没有可以不填。'
  if (type === 'skills') return '按「熟练 / 熟悉 / 了解」分层，比一长串名词更容易被读到。'
  return ''
}

const toggleItem = (id: string): void => {
  openItemId.value = openItemId.value === id ? '' : id
}

const addItem = async (): Promise<void> => {
  const section = selectedSection.value
  if (!section) return
  const item: ResumeItem = {
    id: createId('item'),
    title: '',
    subtitle: '',
    period: '',
    location: '',
    content: '',
    bullets: [],
  }
  section.items.push(item)
  // 直接展开并聚焦：否则加完只多出一行折叠项，用户以为没生效
  openItemId.value = item.id
  emit('change')
  await nextTick()
  document.querySelector<HTMLInputElement>(`[data-item-id="${item.id}"] input`)?.focus()
}

/** 复制一条内容：同公司多段经历、同项目多个角色时，比重新填一遍快得多。 */
const duplicateItem = async (item: ResumeItem): Promise<void> => {
  const section = selectedSection.value
  if (!section) return
  const index = section.items.indexOf(item)
  if (index < 0) return
  const copy: ResumeItem = { ...item, id: createId('item'), bullets: [...item.bullets] }
  section.items.splice(index + 1, 0, copy)
  openItemId.value = copy.id
  emit('change')
}

/** 删除条目交给上层处理：那里能拿到快照，删除后可以撤销。 */
const removeItem = (itemId: string): void => {
  if (!selectedSection.value || selectedSection.value.items.length <= 1) return
  emit('removeItem', selectedSection.value.id, itemId)
}

const addBullet = async (item: ResumeItem): Promise<void> => {
  item.bullets.push('')
  emit('change')
  // 新要点要能直接打字，否则还得再点一下输入框
  await nextTick()
  const inputs = document.querySelectorAll<HTMLInputElement>(
    `[data-item-id="${item.id}"] [data-bullet-input]`,
  )
  inputs[inputs.length - 1]?.focus()
}

const removeBullet = (item: ResumeItem, index: number): void => {
  item.bullets.splice(index, 1)
  emit('change')
}

const updateContent = (item: ResumeItem, value: string): void => {
  item.content = value
  emit('change')
}
</script>

<template>
  <div
    v-if="selectedSection"
    ref="sectionRoot"
    class="inspector-section"
    :class="{ 'is-flash': flashing }"
  >
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
    <label
      >模块类型
      <select v-model="selectedSection.type" @change="onInput">
        <option v-for="(label, value) in SECTION_LABELS" :key="value" :value="value as SectionType">
          {{ label }}
        </option>
      </select>
    </label>

    <div
      v-for="(item, itemIndex) in selectedSection.items"
      :key="item.id"
      class="item-editor"
      :data-item-id="item.id"
    >
      <div class="item-editor__heading">
        <button type="button" class="item-editor__toggle" @click="toggleItem(item.id)">
          <span class="item-editor__index">{{ itemIndex + 1 }}</span>
          <span class="item-editor__label">{{ item.title || item.subtitle || '未命名内容' }}</span>
          <span class="item-editor__chev" aria-hidden="true">{{
            openItemId === item.id ? '▾' : '▸'
          }}</span>
        </button>
        <!-- 条目顺序直接决定简历里的先后，不能只能靠删了重建 -->
        <span class="item-editor__actions">
          <button
            type="button"
            title="复制这条内容"
            aria-label="复制这条内容"
            @click="duplicateItem(item)"
          >
            ⧉
          </button>
          <button
            type="button"
            title="上移这条内容"
            aria-label="上移这条内容"
            :disabled="itemIndex === 0"
            @click="emit('moveItem', selectedSection.id, item.id, -1)"
          >
            ↑
          </button>
          <button
            type="button"
            title="下移这条内容"
            aria-label="下移这条内容"
            :disabled="itemIndex === selectedSection.items.length - 1"
            @click="emit('moveItem', selectedSection.id, item.id, 1)"
          >
            ↓
          </button>
        </span>
        <button
          v-if="selectedSection.items.length > 1"
          type="button"
          class="text-button text-button--danger"
          @click="removeItem(item.id)"
        >
          删除
        </button>
      </div>
      <div v-if="openItemId === item.id" class="item-editor__body">
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
          <!-- 写内容是核心动作，给一句可操作的写法提示，比空白输入框有用 -->
          <p v-if="tipsFor(selectedSection.type)" class="control-note item-editor__hint">
            {{ tipsFor(selectedSection.type) }}
          </p>
          <div
            v-for="(_, bulletIndex) in item.bullets"
            :key="`${item.id}-bullet-${bulletIndex}`"
            class="bullet-row"
          >
            <span>•</span
            ><input
              v-model="item.bullets[bulletIndex]"
              type="text"
              data-bullet-input
              :aria-label="`要点 ${bulletIndex + 1}`"
              @input="onInput"
            /><button type="button" title="删除要点" @click="removeBullet(item, bulletIndex)">
              ×
            </button>
          </div>
        </div>
      </div>
    </div>
    <button type="button" class="button button--secondary button--full" @click="addItem">
      + 添加一条内容
    </button>
  </div>
</template>
