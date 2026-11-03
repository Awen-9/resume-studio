<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  resumeToPlainText,
  type FavoriteQuestion,
  type InterviewQuestion,
  type QuestionType,
} from '@/domain/interview'
import type { ResumeSummary } from '@/domain/resume/model'
import {
  fetchAiProviders,
  generateInterviewQuestionsStream,
  generateJdStream,
  expandInterviewAnswer,
} from '@/infrastructure/api/localResumeApi'
import {
  loadAiSettings,
  saveAiSettings,
  type ProviderId,
} from '@/infrastructure/storage/aiSettings'
import {
  addFavorite,
  loadFavorites,
  removeFavorite,
} from '@/infrastructure/storage/interviewStorage'
import { loadStoredDocument } from '@/infrastructure/storage/indexedDbStorage'
import { useDialogA11y } from '@/shared/ui/useDialogA11y'
import { renderAnswerHtml } from '@/shared/utils/miniMarkdown'

const props = defineProps<{ documents: ResumeSummary[] }>()
const emit = defineEmits<{ back: []; 'go-settings': [] }>()

/** 出题需要正文，摘要里没有；从本地库取完整文档。 */
const loadDocument = (id: string) => loadStoredDocument(id)

const jd = ref('')
const selectedTypes = ref<QuestionType[]>(['scenario', 'fundamental'])
const count = ref(5)
const selectedDocId = ref(props.documents[0]?.id ?? '')
/** 两种后端各自的可用模型；只显示当前后端真正存在的模型。 */
const providerModels = ref<Record<ProviderId, string[]>>({ ollama: [], deepseek: [] })
const providerError = ref('')
const provider = ref<ProviderId>('ollama')
const apiKey = ref('')
const selectedModel = ref('')
/** 提示词档位：小模型要求少，大模型要求狠。 */
type ProfileId = 'compact' | 'standard' | 'deep'
const profile = ref<ProfileId>('standard')
const PROFILE_OPTIONS: Array<{ id: ProfileId; label: string; hint: string }> = [
  {
    id: 'compact',
    label: '精简档（1-4B）',
    hint: '要求少、段落短，适合小模型；深度有限但不容易翻车',
  },
  { id: 'standard', label: '标准档（7-8B）', hint: '默认：五段结构 + 具体细节要求' },
  { id: 'deep', label: '深度档（14B+ / 云端）', hint: '最严：要求方案对比、失败链路与多项指标' },
]
const suggestProfile = (model: string): ProfileId => {
  const size = model.toLowerCase().match(/(\d+(?:\.\d+)?)\s*b\b/)
  if (size) {
    const value = Number(size[1])
    if (Number.isFinite(value)) return value <= 4 ? 'compact' : value <= 9 ? 'standard' : 'deep'
  }
  return /deepseek|gpt|claude/.test(model.toLowerCase()) ? 'deep' : 'standard'
}
const availableModels = computed(() => providerModels.value[provider.value] ?? [])
const aiReady = computed(() => availableModels.value.length > 0)
const generating = ref(false)
const errorMessage = ref('')
const results = ref<InterviewQuestion[]>([])
/** 出题前 AI 先总结出的简历摘要，展示给用户、也作为出题依据。 */
const resumeSummary = ref('')
const generatedWith = ref('')

/** 难度标签：接口返回英文枚举，界面不该混着英文显示。 */
const DIFFICULTY_LABELS: Record<string, string> = { easy: '简单', medium: '中等', hard: '困难' }

const favorites = ref<FavoriteQuestion[]>([])
const showFavorites = ref(false)
const activeFavorite = ref<FavoriteQuestion | null>(null)
const favoritesRef = ref<HTMLElement | null>(null)
// 题目集是弹窗：Esc 关闭、焦点留在弹窗内、关闭后焦点回到触发按钮
useDialogA11y(favoritesRef, {
  isOpen: () => showFavorites.value,
  onClose: () => {
    showFavorites.value = false
  },
})

const toggleType = (type: QuestionType): void => {
  const exists = selectedTypes.value.includes(type)
  selectedTypes.value = exists
    ? selectedTypes.value.filter((item) => item !== type)
    : [...selectedTypes.value, type]
}

/** 刷新可用模型：没有 Key 时只会拿到本地模型，DeepSeek 显示为未配置。 */
const refreshModels = async (): Promise<void> => {
  providerError.value = ''
  try {
    const result = await fetchAiProviders(apiKey.value.trim() || undefined)
    providerModels.value = { ollama: result.ollama.models, deepseek: result.deepseek.models }
    if (provider.value === 'deepseek' && result.deepseek.error) {
      providerError.value = result.deepseek.error
    }
    const next = providerModels.value[provider.value]
    if (!next.includes(selectedModel.value)) selectedModel.value = next[0] ?? ''
    if (next[0]) profile.value = suggestProfile(next[0])
  } catch (error) {
    providerError.value = error instanceof Error ? error.message : '读取模型失败'
  }
}

const onProviderChange = async (event: Event): Promise<void> => {
  provider.value = (event.target as HTMLSelectElement).value as ProviderId
  await applyProvider()
}

const validating = ref(false)

const applyProvider = async (): Promise<void> => {
  providerError.value = ''
  saveAiSettings({ provider: provider.value, deepseekKey: apiKey.value })
  validating.value = true
  try {
    await refreshModels()
  } finally {
    validating.value = false
  }
  // 切到 DeepSeek 但还没填 Key：保留选择，只提示会回退到本地
  if (provider.value === 'deepseek' && !apiKey.value.trim()) {
    providerError.value = '还没有填 API Key，出题会先用本地模型'
  }
}

onMounted(async () => {
  favorites.value = loadFavorites()
  const settings = loadAiSettings()
  provider.value = settings.provider
  apiKey.value = settings.deepseekKey
  await refreshModels()
})

/** 选了 DeepSeek 且填了 Key 才真的走云端，否则回退本地。 */
const useDeepseek = computed(() => provider.value === 'deepseek' && apiKey.value.trim().length > 0)

/** 按钮为什么点不了：与其让用户猜，不如直接写出来。 */
const disabledReason = computed(() => {
  if (generating.value) return ''
  if (validating.value) return '正在验证模型来源…'
  if (!selectedDocId.value) return '先创建或导入一份简历'
  if (selectedTypes.value.length === 0) return '至少选一种题型'
  if (!aiReady.value) {
    return provider.value === 'deepseek'
      ? '没有可用模型：确认 API Key 后点「测试连接」'
      : '没有可用模型：启动 Ollama 后点「刷新可用模型」'
  }
  return ''
})

const canGenerate = computed(
  () =>
    aiReady.value &&
    !generating.value &&
    selectedTypes.value.length > 0 &&
    Boolean(selectedDocId.value),
)

/** 当前这次出题的控制器；点「暂停」就把它中止。 */
const activeController = ref<AbortController | null>(null)
/** 一句话生成 JD：输入岗位方向，流式写进 JD 文本框，之后可以改或直接出题。 */
const jdPrompt = ref('')
const jdGenerating = ref(false)

const generateJd = async (): Promise<void> => {
  const role = jdPrompt.value.trim()
  if (!role || jdGenerating.value) return
  jdGenerating.value = true
  errorMessage.value = ''
  jd.value = ''
  try {
    await generateJdStream(
      {
        role,
        provider: useDeepseek.value ? 'deepseek' : 'ollama',
        apiKey: useDeepseek.value ? apiKey.value.trim() : undefined,
        model: selectedModel.value || undefined,
      },
      (delta) => {
        jd.value += delta
      },
    )
  } catch (error) {
    errorMessage.value =
      error instanceof Error && error.name === 'AbortError'
        ? '已暂停生成 JD'
        : error instanceof Error
          ? error.message
          : '生成 JD 失败'
  } finally {
    jdGenerating.value = false
  }
}

const pauseGenerate = (): void => {
  activeController.value?.abort()
}

const generate = async (): Promise<void> => {
  if (!canGenerate.value) return
  generating.value = true
  errorMessage.value = ''
  results.value = []
  resumeSummary.value = ''
  try {
    const controller = new AbortController()
    activeController.value = controller
    const document = await loadDocument(selectedDocId.value)
    if (!document) throw new Error('没有找到这份简历，可能已被删除')
    const payload = await generateInterviewQuestionsStream(
      {
        jd: jd.value.trim(),
        resume: resumeToPlainText(document),
        types: selectedTypes.value,
        count: count.value,
        model: selectedModel.value || undefined,
        profile: profile.value,
        provider: useDeepseek.value ? 'deepseek' : 'ollama',
        apiKey: useDeepseek.value ? apiKey.value.trim() : undefined,
      },
      // 出一道显示一道，不必等整批结束
      (question) => (results.value = [...results.value, question as InterviewQuestion]),
      controller.signal,
    )
    results.value = payload.questions as InterviewQuestion[]
    resumeSummary.value = payload.summary
    generatedWith.value = payload.model
    if (results.value.length === 0) errorMessage.value = '模型没有给出题目，换一种题型或再试一次'
  } catch (error) {
    // 用户主动暂停不是失败：给一句可操作的提示，参数都还在，可以直接重来
    errorMessage.value =
      error instanceof Error && error.name === 'AbortError'
        ? '已暂停。调整题型或题数后可以重新出题。'
        : error instanceof Error
          ? error.message
          : '出题失败'
  } finally {
    generating.value = false
    activeController.value = null
  }
}

/** 收藏时把 JD 和简历一起快照下来，避免之后简历改动导致上下文丢失。 */
const favorite = async (question: InterviewQuestion): Promise<void> => {
  const document = await loadDocument(selectedDocId.value)
  favorites.value = addFavorite({
    ...question,
    id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
    model: generatedWith.value || selectedModel.value,
    jd: jd.value.trim(),
    resumeTitle: document?.title ?? '',
    resumeSnapshot: document ? resumeToPlainText(document) : '',
  })
}

/** 正在展开的题目下标：只禁用那一张卡上的按钮。 */
const expandingIndex = ref<number | null>(null)

/** 单个题目「展开更细」：用一次独立调用把答案写长写实。 */
const expandAnswer = async (index: number): Promise<void> => {
  const item = results.value[index]
  if (!item || expandingIndex.value !== null) return
  expandingIndex.value = index
  try {
    const document = await loadDocument(selectedDocId.value)
    const answer = await expandInterviewAnswer({
      question: item.question,
      answer: item.answer,
      type: item.type,
      jd: jd.value.trim() || undefined,
      resume: document ? resumeToPlainText(document).slice(0, 6000) : undefined,
      provider: useDeepseek.value ? 'deepseek' : 'ollama',
      apiKey: useDeepseek.value ? apiKey.value.trim() : undefined,
      model: selectedModel.value || undefined,
      profile: profile.value,
    })
    results.value = results.value.map((entry, i) => (i === index ? { ...entry, answer } : entry))
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '展开失败'
  } finally {
    expandingIndex.value = null
  }
}

const isFavorited = (question: InterviewQuestion): boolean =>
  favorites.value.some((item) => item.question === question.question)

const unfavorite = (id: string): void => {
  favorites.value = removeFavorite(id)
  if (activeFavorite.value?.id === id) activeFavorite.value = null
}
</script>

<template>
  <main class="interview-view">
    <header class="interview-header">
      <button type="button" class="icon-button" aria-label="返回简历列表" @click="emit('back')">
        ←
      </button>
      <div class="document-name">
        <h1>面试出题</h1>
        <span>选一份简历、按题型生成面试题；填写 JD 会更有针对性</span>
      </div>
      <div class="interview-header__actions">
        <button type="button" class="button button--secondary" @click="showFavorites = true">
          题目集（{{ favorites.length }}）
        </button>
      </div>
    </header>

    <div class="interview-body">
      <section class="interview-form">
        <label class="interview-field">
          <span>一句话生成 JD（例如「Agent 工程师」）</span>
          <div class="interview-row">
            <input
              v-model="jdPrompt"
              type="text"
              placeholder="Agent 工程师 / 后端开发 / 数据分析"
              @keyup.enter="generateJd"
            />
            <button type="button" class="text-button" :disabled="jdGenerating" @click="generateJd">
              {{ jdGenerating ? '生成中…' : jd ? '重新生成 JD' : '生成 JD' }}
            </button>
          </div>
          <span v-if="jdGenerating" class="interview-hint">
            正在生成。模型首次调用要先加载进内存，通常 10-40 秒，期间没有输出是正常的。
          </span>
        </label>

        <label class="interview-field">
          <span>岗位描述（JD，可不填）</span>
          <textarea
            v-model="jd"
            rows="8"
            placeholder="粘贴 JD 全文（选填）。留空时只根据简历里的技术栈和经历出题。"
          />
        </label>

        <label class="interview-field">
          <span>选择简历</span>
          <select v-model="selectedDocId">
            <option v-for="document in documents" :key="document.id" :value="document.id">
              {{ document.title }}
            </option>
          </select>
        </label>

        <div class="interview-field">
          <span>题型</span>
          <div class="interview-types">
            <button
              v-for="type in QUESTION_TYPES"
              :key="type"
              type="button"
              :class="{ active: selectedTypes.includes(type) }"
              @click="toggleType(type)"
            >
              {{ QUESTION_TYPE_LABELS[type] }}
            </button>
          </div>
        </div>

        <div class="interview-row">
          <label class="interview-field interview-field--inline">
            <span>题数</span>
            <select v-model.number="count">
              <option v-for="n in [3, 5, 8, 10]" :key="n" :value="n">{{ n }} 道</option>
            </select>
          </label>
          <label class="interview-field interview-field--inline">
            <span>模型来源</span>
            <select :value="provider" @change="onProviderChange">
              <option value="ollama">本地 Ollama</option>
              <option value="deepseek">DeepSeek（API Key）</option>
            </select>
          </label>
          <label class="interview-field interview-field--inline">
            <span>提示词档位</span>
            <select v-model="profile">
              <option v-for="option in PROFILE_OPTIONS" :key="option.id" :value="option.id">
                {{ option.label }}
              </option>
            </select>
          </label>
          <label class="interview-field interview-field--inline">
            <span>模型</span>
            <select v-model="selectedModel" :disabled="availableModels.length === 0">
              <option v-for="model in availableModels" :key="model" :value="model">
                {{ model }}
              </option>
              <option v-if="availableModels.length === 0" value="">（暂无可用模型）</option>
            </select>
          </label>
        </div>

        <label v-if="provider === 'deepseek'" class="interview-field">
          <span>DeepSeek API Key</span>
          <span class="interview-hint">
            在设置里管理
            <button type="button" class="text-button" @click="emit('go-settings')">去设置</button>
          </span>
        </label>
        <p class="interview-hint">
          {{ PROFILE_OPTIONS.find((option) => option.id === profile)?.hint }}
        </p>
        <div class="interview-row">
          <button type="button" class="text-button" @click="refreshModels">刷新可用模型</button>
        </div>

        <p v-if="!aiReady" class="control-note control-note--warn">
          {{
            provider === 'deepseek'
              ? 'DeepSeek 没有可用模型：检查 API Key 后点「刷新可用模型」。'
              : '没检测到本机 Ollama 模型：先 `ollama pull qwen3-8b`，再点「刷新可用模型」。'
          }}
        </p>
        <p v-if="providerError" class="control-note control-note--warn">{{ providerError }}</p>
        <p v-if="errorMessage" class="control-note control-note--warn">
          {{ errorMessage }}
          <span class="interview-row">
            <button type="button" class="text-button" :disabled="generating" @click="generate">
              重试
            </button>
            <button type="button" class="text-button" @click="emit('go-settings')">去设置</button>
          </span>
        </p>

        <button
          v-if="generating"
          type="button"
          class="button button--secondary"
          @click="pauseGenerate"
        >
          暂停
        </button>
        <button
          v-else
          type="button"
          class="button button--primary"
          :disabled="!canGenerate"
          @click="generate"
        >
          {{ results.length > 0 ? '重新出题' : '开始出题' }}
        </button>
        <p v-if="disabledReason" class="interview-hint">{{ disabledReason }}</p>
      </section>

      <section class="interview-results">
        <details v-if="resumeSummary" class="question-card" open>
          <summary>简历摘要（AI 总结，出题以此为准）</summary>
          <p class="answer-body" v-html="renderAnswerHtml(resumeSummary)" />
        </details>
        <p v-if="!results.length && !generating" class="muted-text">
          题目会显示在这里。收藏后会进入右上角的「题目集」，之后可以随时查看题目、答案和当时的 JD /
          简历。
        </p>
        <p v-if="generating" class="muted-text">
          正在生成，题目会一道一道出现；随时可以点「暂停」。
        </p>

        <article
          v-for="(item, index) in results"
          :id="`q-${index}`"
          :key="index"
          class="question-card"
        >
          <header class="question-card__head">
            <span class="question-card__type">{{ QUESTION_TYPE_LABELS[item.type] }}</span>
            <span class="question-card__difficulty">{{
              DIFFICULTY_LABELS[item.difficulty] ?? item.difficulty
            }}</span>
            <button
              type="button"
              class="text-button"
              :disabled="isFavorited(item)"
              @click="favorite(item)"
            >
              {{ isFavorited(item) ? '已收藏' : '收藏' }}
            </button>
          </header>
          <h3>{{ item.question }}</h3>
          <details>
            <summary>查看答案</summary>
            <p class="answer-body" v-html="renderAnswerHtml(item.answer)" />
            <button
              type="button"
              class="text-button"
              :disabled="expandingIndex !== null"
              @click="expandAnswer(index)"
            >
              {{ expandingIndex === index ? '展开中…' : '展开更细' }}
            </button>
          </details>
        </article>
      </section>
    </div>

    <!-- 题目集：左侧列表，右侧详情（题目 / 答案 / 类型 / JD / 简历） -->
    <div v-if="showFavorites" class="dialog-backdrop" @click.self="showFavorites = false">
      <section
        ref="favoritesRef"
        class="favorites-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="题目集"
      >
        <header class="export-dialog__header">
          <div>
            <span class="eyebrow">QUESTION BANK</span>
            <h2>题目集</h2>
          </div>
          <button
            type="button"
            class="icon-button"
            aria-label="关闭题目集"
            @click="showFavorites = false"
          >
            ×
          </button>
        </header>

        <div class="favorites-body">
          <ul class="favorites-list">
            <li v-if="favorites.length === 0" class="muted-text">还没有收藏的题目。</li>
            <li v-for="item in favorites" :key="item.id">
              <button
                type="button"
                :class="{ active: activeFavorite?.id === item.id }"
                @click="activeFavorite = item"
              >
                <span class="question-card__type">{{ QUESTION_TYPE_LABELS[item.type] }}</span>
                <span>{{ item.question }}</span>
              </button>
            </li>
          </ul>

          <div class="favorites-detail">
            <template v-if="activeFavorite">
              <h3>{{ activeFavorite.question }}</h3>
              <p class="favorites-detail__meta">
                {{ QUESTION_TYPE_LABELS[activeFavorite.type] }} ·
                {{ DIFFICULTY_LABELS[activeFavorite.difficulty] ?? activeFavorite.difficulty }} ·
                {{ activeFavorite.model || '本地模型' }}
              </p>
              <h4>参考答案</h4>
              <p
                class="favorites-detail__answer answer-body"
                v-html="renderAnswerHtml(activeFavorite.answer)"
              />
              <h4>岗位描述</h4>
              <pre class="favorites-detail__pre">{{ activeFavorite.jd || '（未记录）' }}</pre>
              <h4>简历（{{ activeFavorite.resumeTitle || '未记录' }}）</h4>
              <pre class="favorites-detail__pre">{{
                activeFavorite.resumeSnapshot || '（未记录）'
              }}</pre>
              <button type="button" class="text-button" @click="unfavorite(activeFavorite.id)">
                从题目集删除
              </button>
            </template>
            <p v-else class="muted-text">从左侧选一道题查看详情。</p>
          </div>
        </div>
      </section>
    </div>
  </main>
</template>
