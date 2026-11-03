<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { resumeToPlainText } from '@/domain/interview'
import type { ResumeSummary } from '@/domain/resume/model'
import { makeJobProfileId, type JobProfile } from '@/domain/jobProfile'
import {
  deleteJobProfile,
  listJobProfiles,
  saveJobProfile,
} from '@/infrastructure/storage/jobProfiles'
import { fetchAiProviders, runAgentStream } from '@/infrastructure/api/localResumeApi'
import { loadAiSettings, type ProviderId } from '@/infrastructure/storage/aiSettings'

const props = defineProps<{ documents: ResumeSummary[] }>()
const emit = defineEmits<{ back: []; 'go-settings': [] }>()

const goal = ref('')
const jd = ref('')
const selectedDocId = ref(props.documents[0]?.id ?? '')
const running = ref(false)
const steps = ref<Array<{ tool: string; args: Record<string, unknown>; result: unknown }>>([])
const answer = ref('')
const errorMessage = ref('')
const controller = ref<AbortController | null>(null)
const profiles = ref<JobProfile[]>([])

const provider = ref<ProviderId>('ollama')
const apiKey = ref('')
const selectedModel = ref('')
const providerModels = ref<Record<ProviderId, string[]>>({ ollama: [], deepseek: [] })

const TOOL_LABELS: Record<string, string> = {
  summarize_resume: '总结简历',
  optimize_resume: '改简历',
  generate_questions: '出面试题',
}

const canRun = computed(
  () => !running.value && goal.value.trim().length >= 4 && Boolean(selectedDocId.value),
)

const loadDocument = async (id: string) => {
  const { loadStoredDocument } = await import('@/infrastructure/storage/indexedDbStorage')
  return loadStoredDocument(id)
}

const run = async (): Promise<void> => {
  if (!canRun.value) return
  running.value = true
  errorMessage.value = ''
  steps.value = []
  answer.value = ''
  const abort = new AbortController()
  controller.value = abort

  try {
    const document = await loadDocument(selectedDocId.value)
    if (!document) throw new Error('没有找到这份简历，可能已被删除')

    const finalAnswer = await runAgentStream(
      {
        goal: goal.value.trim(),
        jd: jd.value.trim() || undefined,
        resume: resumeToPlainText(document),
        provider: provider.value,
        apiKey: apiKey.value.trim() || undefined,
        model: selectedModel.value || undefined,
      },
      (step) => {
        steps.value = [...steps.value, step]
      },
      abort.signal,
    )
    answer.value = finalAnswer
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      errorMessage.value = '已停止'
    } else {
      errorMessage.value = error instanceof Error ? error.message : '运行失败'
    }
  } finally {
    running.value = false
    controller.value = null
  }
}

const stop = (): void => controller.value?.abort()

const refreshModels = async (): Promise<void> => {
  try {
    const result = await fetchAiProviders(apiKey.value.trim() || undefined)
    providerModels.value = { ollama: result.ollama.models, deepseek: result.deepseek.models }
    const next = providerModels.value[provider.value]
    if (!next.includes(selectedModel.value)) selectedModel.value = next[0] ?? ''
  } catch {
    // 拿不到模型列表时保留当前选择，交给设置页处理
  }
}

onMounted(async () => {
  profiles.value = listJobProfiles()
  const settings = loadAiSettings()
  provider.value = settings.provider
  apiKey.value = settings.deepseekKey
  await refreshModels()
})

const saveProfile = (): void => {
  if (!answer.value) return
  const title = jd.value.trim().split('\n')[0]?.slice(0, 24) || goal.value.trim().slice(0, 24)
  saveJobProfile({
    id: makeJobProfileId(),
    resumeId: selectedDocId.value,
    title,
    jd: jd.value,
    goal: goal.value,
    createdAt: Date.now(),
    answer: answer.value,
    steps: steps.value.map((step) => ({ tool: step.tool, result: step.result })),
  })
  profiles.value = listJobProfiles()
}

const restoreProfile = (profile: JobProfile): void => {
  jd.value = profile.jd
  goal.value = profile.goal
  answer.value = profile.answer
  steps.value = profile.steps.map((step) => ({
    tool: step.tool,
    args: {},
    result: step.result,
  }))
}

const removeProfile = (id: string): void => {
  deleteJobProfile(id)
  profiles.value = listJobProfiles()
}

/** 把不同工具的返回结果解析成便于模板渲染的结构。 */
interface StepDisplay {
  tool: string
  text?: string
  edits?: Array<{ before: string; after: string; reason: string }>
  questions?: Array<{ type: string; question: string; answer: string; difficulty: string }>
  summary?: string
}

const displayOf = (step: { tool: string; result: unknown }): StepDisplay => {
  const result = step.result as Record<string, unknown> | string | null | undefined
  if (typeof result === 'string') return { tool: step.tool, text: result }
  if (result && typeof result === 'object') {
    if (Array.isArray(result.edits)) {
      return {
        tool: step.tool,
        summary: typeof result.summary === 'string' ? result.summary : '',
        edits: result.edits as StepDisplay['edits'],
      }
    }
    if (Array.isArray(result.questions)) {
      return { tool: step.tool, questions: result.questions as StepDisplay['questions'] }
    }
    if (typeof result.summary === 'string') return { tool: step.tool, text: result.summary }
  }
  return { tool: step.tool, text: JSON.stringify(result) }
}
</script>

<template>
  <main class="agent-view">
    <header class="interview-header">
      <button type="button" class="icon-button" aria-label="返回" @click="emit('back')">←</button>
      <div class="document-name">
        <h1>AI Agent</h1>
        <span>给一个目标，让它自己决定该做什么</span>
      </div>
    </header>

    <div class="agent-body">
      <section class="agent-form">
        <div class="agent-model-summary">
          <span>
            模型：<strong>{{ provider === 'deepseek' ? 'DeepSeek' : '本地 Ollama' }}</strong>
            <template v-if="selectedModel"> · {{ selectedModel }}</template>
          </span>
          <button type="button" class="text-button" @click="emit('go-settings')">去设置</button>
        </div>

        <label class="interview-field">
          <span>目标（用一句话说清楚）</span>
          <input v-model="goal" type="text" placeholder="例如：帮我匹配这个岗位，并出一套面试题" />
        </label>

        <label class="interview-field">
          <span>岗位描述（JD，选填）</span>
          <textarea v-model="jd" rows="5" placeholder="粘贴 JD，agent 会据此改简历、出题" />
        </label>

        <label class="interview-field">
          <span>选择简历</span>
          <select v-model="selectedDocId">
            <option v-for="document in documents" :key="document.id" :value="document.id">
              {{ document.title }}
            </option>
          </select>
        </label>

        <button v-if="running" type="button" class="button button--secondary" @click="stop">
          停止
        </button>
        <button
          v-else
          type="button"
          class="button button--primary"
          :disabled="!canRun"
          @click="run"
        >
          运行
        </button>
        <button
          v-if="answer && !running"
          type="button"
          class="button button--secondary"
          @click="saveProfile"
        >
          保存为岗位档案
        </button>
        <p v-if="errorMessage" class="control-note control-note--warn">
          {{ errorMessage }}
          <span class="interview-row">
            <button type="button" class="text-button" :disabled="running" @click="run">重试</button>
            <button type="button" class="text-button" @click="emit('go-settings')">去设置</button>
          </span>
        </p>

        <div v-if="profiles.length" class="agent-profiles">
          <span>已保存的岗位档案</span>
          <ul>
            <li v-for="profile in profiles" :key="profile.id">
              <button type="button" class="text-button" @click="restoreProfile(profile)">
                {{ profile.title }}
              </button>
              <button
                type="button"
                class="text-button agent-profiles__remove"
                aria-label="删除"
                @click="removeProfile(profile.id)"
              >
                删除
              </button>
            </li>
          </ul>
        </div>
      </section>

      <section class="agent-log">
        <p v-if="running" class="muted-text">agent 正在工作，每完成一步会显示在下面…</p>
        <ol class="agent-steps">
          <li v-for="(step, index) in steps" :key="index" class="agent-step">
            <strong class="agent-step__title">{{ TOOL_LABELS[step.tool] ?? step.tool }}</strong>

            <!-- 总结：一段可读文本 -->
            <p v-if="displayOf(step).text" class="agent-step__text">
              {{ displayOf(step).text }}
            </p>

            <!-- 改简历：一条条 before → after -->
            <div v-if="displayOf(step).edits?.length" class="agent-edits">
              <p v-if="displayOf(step).summary" class="agent-step__text">
                {{ displayOf(step).summary }}
              </p>
              <div
                v-for="(edit, editIndex) in displayOf(step).edits"
                :key="editIndex"
                class="agent-edit"
              >
                <p class="agent-edit__before">{{ edit.before }}</p>
                <p class="agent-edit__after">{{ edit.after }}</p>
                <p class="agent-edit__reason">{{ edit.reason }}</p>
              </div>
            </div>

            <!-- 出题：题目卡片 -->
            <div v-if="displayOf(step).questions?.length" class="agent-questions">
              <div
                v-for="(question, questionIndex) in displayOf(step).questions"
                :key="questionIndex"
                class="agent-question"
              >
                <div class="agent-question__meta">
                  <span class="agent-question__type">{{ question.type }}</span>
                  <span class="agent-question__difficulty">{{ question.difficulty }}</span>
                </div>
                <p class="agent-question__text">{{ question.question }}</p>
                <details v-if="question.answer">
                  <summary>查看参考答案</summary>
                  <p class="agent-question__answer">{{ question.answer }}</p>
                </details>
              </div>
            </div>
          </li>
        </ol>
        <div v-if="answer && !steps.length" class="agent-answer">
          <strong>结果</strong>
          <p>{{ answer }}</p>
        </div>
        <p v-if="!steps.length && !running && !answer" class="muted-text">
          运行后，每一步（总结 / 改简历 / 出题）都会实时出现在这里。
        </p>
      </section>
    </div>
  </main>
</template>
