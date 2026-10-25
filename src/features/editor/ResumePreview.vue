<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getEffectiveTheme, paginateSections } from '@/domain/resume/pagination'
import { getResumeProfileFields, sanitizeRichHtml } from '@/domain/resume/renderer'
import type { ResumeDocument, ResumeSection } from '@/domain/resume/model'

const props = defineProps<{
  document: ResumeDocument
  selectedSectionId: string
}>()

const emit = defineEmits<{
  select: [id: string]
  'layout-status': [status: { pageCount: number; overflowPages: number[]; ready: boolean }]
}>()

const stageRef = ref<HTMLElement | null>(null)
const renderTheme = computed(() => getEffectiveTheme(props.document.theme))
const pages = ref(paginateSections(props.document.sections, renderTheme.value))
const overflowPages = ref<number[]>([])
let layoutTimer: number | undefined

const reconcileLayout = async (): Promise<void> => {
  pages.value = paginateSections(props.document.sections, renderTheme.value)
  overflowPages.value = []
  await nextTick()
  for (let guard = 0; guard < 40; guard += 1) {
    const pageElements = Array.from(
      stageRef.value?.querySelectorAll<HTMLElement>('.resume-page') ?? [],
    )
    const overflowIndex = pageElements.findIndex(
      (page) => page.scrollHeight > page.clientHeight + 2,
    )
    if (overflowIndex < 0) {
      emit('layout-status', { pageCount: pages.value.length, overflowPages: [], ready: true })
      return
    }
    const currentPage = pages.value[overflowIndex]
    if (!currentPage || currentPage.sections.length <= 1) {
      overflowPages.value.push(overflowIndex + 1)
      emit('layout-status', {
        pageCount: pages.value.length,
        overflowPages: [...overflowPages.value],
        ready: true,
      })
      return
    }
    const movedSection = currentPage.sections[currentPage.sections.length - 1]
    const nextPages = pages.value.map((page) => ({ ...page, sections: [...page.sections] }))
    nextPages[overflowIndex].sections.pop()
    if (nextPages[overflowIndex + 1]) nextPages[overflowIndex + 1].sections.unshift(movedSection)
    else nextPages.push({ index: nextPages.length + 1, sections: [movedSection] })
    pages.value = nextPages.map((page, index) => ({ ...page, index: index + 1 }))
    await nextTick()
  }
  emit('layout-status', {
    pageCount: pages.value.length,
    overflowPages: [...overflowPages.value],
    ready: true,
  })
}

const scheduleLayout = (): void => {
  if (layoutTimer) window.clearTimeout(layoutTimer)
  layoutTimer = window.setTimeout(() => void reconcileLayout(), 80)
}

watch(() => props.document, scheduleLayout, { deep: true })

onMounted(() => {
  scheduleLayout()
})

onBeforeUnmount(() => {
  if (layoutTimer) window.clearTimeout(layoutTimer)
})

const sectionClass = (section: ResumeSection): string => {
  return section.id.startsWith(props.selectedSectionId)
    ? 'resume-section is-selected'
    : 'resume-section'
}
</script>

<template>
  <div ref="stageRef" class="preview-stage" data-testid="resume-preview">
    <div class="preview-stage__meta">
      <span>A4 预览</span>
      <span>{{ pages.length }} 页</span>
    </div>
    <div v-if="overflowPages.length" class="preview-stage__warning" role="status">
      第 {{ overflowPages.join('、') }} 页内容仍然过长，请减小字号或调整内容。
    </div>
    <div class="paper-stack">
      <article
        v-for="page in pages"
        :key="page.index"
        class="resume-page"
        :class="[
          `template-${document.theme.templateId}`,
          `page-mode-${document.theme.pageMode ?? 'standard'}`,
        ]"
        :style="{
          '--resume-font-family': renderTheme.fontFamily,
          '--resume-font-size': `${renderTheme.fontSize}px`,
          '--resume-line-height': renderTheme.lineHeight,
          '--resume-page-margin': `${renderTheme.pageMargin}mm`,
          '--resume-section-gap': `${renderTheme.sectionGap}px`,
          '--resume-accent': renderTheme.accentColor,
        }"
        :data-page="page.index"
      >
        <header
          v-if="page.index === 1"
          class="resume-header"
          :class="{
            'resume-header--compact':
              document.profile.headerLayout === 'compact' ||
              document.profile.displayTitle ||
              document.profile.detail,
          }"
        >
          <template
            v-if="
              document.profile.headerLayout === 'compact' ||
              document.profile.displayTitle ||
              document.profile.detail
            "
          >
            <h1>
              {{
                [document.profile.displayTitle, document.profile.name].filter(Boolean).join(' ') ||
                '未填写姓名'
              }}
            </h1>
            <p class="resume-header__meta">{{ getResumeProfileFields(document).join('  |  ') }}</p>
            <p v-if="document.profile.detail" class="resume-header__detail">
              {{ document.profile.detail }}
            </p>
            <p class="resume-header__headline">{{ document.profile.headline || '目标职位' }}</p>
          </template>
          <template v-else>
            <h1>{{ document.profile.name || '未填写姓名' }}</h1>
            <p class="resume-header__headline">{{ document.profile.headline || '目标职位' }}</p>
            <p v-if="getResumeProfileFields(document).length" class="resume-header__meta">
              {{ getResumeProfileFields(document).join('  |  ') }}
            </p>
          </template>
        </header>

        <section
          v-for="section in page.sections"
          :key="section.id"
          :class="sectionClass(section)"
          @click="emit('select', section.id)"
        >
          <h2>{{ section.title || '未命名模块' }}</h2>
          <div v-for="item in section.items" :key="item.id" class="resume-item">
            <div v-if="item.title || item.period" class="resume-item__heading">
              <strong>{{ item.title }}</strong>
              <span>{{ item.period }}</span>
            </div>
            <div v-if="item.subtitle || item.location" class="resume-item__subheading">
              <span>{{ item.subtitle }}</span>
              <span>{{ item.location }}</span>
            </div>
            <div
              v-if="item.content"
              class="resume-rich-text"
              v-html="sanitizeRichHtml(item.content)"
            />
            <ul v-if="item.bullets.length" class="resume-bullets">
              <li v-for="(bullet, bulletIndex) in item.bullets" :key="`${item.id}-${bulletIndex}`">
                {{ bullet }}
              </li>
            </ul>
          </div>
        </section>

        <footer v-if="document.theme.showPageNumber" class="resume-page__number">
          {{ page.index }}
        </footer>
      </article>
    </div>
  </div>
</template>
