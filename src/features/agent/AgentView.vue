<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { applyResumeEdits } from '@/domain/resume/applyEdits'
import { resumeToPlainText } from '@/domain/interview'
import type { ResumeSummary } from '@/domain/resume/model'
import { makeJobProfileId, type JobProfile } from '@/domain/jobProfile'
import {
  deleteJobProfile,
  listJobProfiles,
  saveJobProfile,
} from '@/infrastructure/storage/jobProfiles'
import {
  fetchAiProviders,
  resumeAgentStream,
  runAgentStream,
  type AgentProposal,
  type AgentStepPayload,
} from '@/infrastructure/api/localResumeApi'
import { useResumeStore } from '@/infrastructure/state/resumeStore'
import { loadAiSettings, type ProviderId } from '@/infrastructure/storage/aiSettings'

const props = defineProps<{ documents: ResumeSummary[] }>()
const emit = defineEmits<{ back: []; 'go-settings': [] }>()

const store = useResumeStore()

const goal = ref('')
const jd = ref('')
const selectedDocId = ref(props.documents[0]?.id ?? '')
const running = ref(false)
const steps = ref<AgentStepPayload[]>([])
const answer = ref('')
const errorMessage = ref('')
const controller = ref<AbortController | null>(null)
const profiles = ref<JobProfile[]>([])

/** 会话 id 与多轮对话：同一 threadId 的请求会由 checkpointer 接着上一轮跑。 */
const threadId = ref('')
const turns = ref<Array<{ goal: string; answer: string }>>([])
const followUp = ref('')

/** 人工确认：图停在 rewrite_review 时，这里保存待确认的改写稿。 */
const pendingProposal = ref<AgentProposal | null>(null)
const selectedEdits = ref<number[]>([])
const writeBackNote = ref('')

const provider = ref<ProviderId>('ollama')
const apiKey = ref('')
const selectedModel = ref('')
const providerModels = ref<Record<ProviderId, string[]>>({ ollama: [], deepseek: [] })

const TOOL_LABELS: Record<string, string> = {
  classify_intent: '判断意图',
  analyze_match: '岗位匹配分析',
  draft_rewrite: '起草改写',
  apply_rewrite: '写回简历',
  generate_questions: '出面试题',
  read_resume_section: '读取简历模块',
  read_jd: '读取 JD',
}

const canRun = computed(
  () => !running.value && goal.value.trim().length >= 2 && Boolean(selectedDocId.value),
)

const loadDocument = async (id: string) => {
  const { loadStoredDocument } = await import('@/infrastructure/storage/indexedDbStorage')
  return loadStoredDocument(id)
}

const modelPayload = () => ({
  provider: provider.value,
  apiKey: apiKey.value.trim() || undefined,
  model: selectedModel.value || undefined,
})

/** 采纳的改写真正写回简历：打开文档 → 替换 → 保存（保存会记入历史版本）。 */
const applyEdits = async (edits: AgentProposal['edits']): Promise<void> => {
  if (!edits.length) return
  await store.open(selectedDocId.value)
  const result = applyResumeEdits(store.currentDocument, edits)
  await store.save()
  writeBackNote.value = result.failed.length
    ? `已写入 ${result.applied} 条，${result.failed.length} 条没在简历里找到原文，已跳过`
    : `已写入 ${result.applied} 条到简历，可在编辑器里 Ctrl+Z 撤销`
}

const run = async (goalText: string): Promise<void> => {
  if (running.value) return
  const text = goalText.trim()
  if (text.length < 2 || !selectedDocId.value) return

  running.value = true
  errorMessage.value = ''
  steps.value = []
  answer.value = ''
  writeBackNote.value = ''
  pendingProposal.value = null
  selectedEdits.value = []
  const abort = new AbortController()
  controller.value = abort

  try {
    const document = await loadDocument(selectedDocId.value)
    if (!document) throw new Error('没有找到这份简历，可能已被删除')

    const result = await runAgentStream(
      {
        goal: text,
        jd: jd.value.trim() || undefined,
        resume: resumeToPlainText(document),
        threadId: threadId.value || undefined,
        ...modelPayload(),
      },
      {
        onThread: (id) => {
          threadId.value = id
        },
        onStep: (step) => {
          steps.value = [...steps.value, step]
        },
        onInterrupt: (proposal, id) => {
          threadId.value = id
          pendingProposal.value = proposal
          selectedEdits.value = proposal.edits.map((_, index) => index)
        },
      },
      abort.signal,
    )

    if (result.threadId) threadId.value = result.threadId
    if (result.answer) {
      answer.value = result.answer
      turns.value = [...turns.value, { goal: text, answer: result.answer }]
    }
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

const runGoal = (): void => {
  void run(goal.value)
}

const askFollowUp = (): void => {
  const text = followUp.value.trim()
  if (!text) return
  followUp.value = ''
  void run(text)
}

const stop = (): void => controller.value?.abort()

/** 确认改写：accept 先写回本地简历，再让图继续跑完；reject 只收尾。 */
const settleRewrite = async (decision: 'accept' | 'reject'): Promise<void> => {
  const proposal = pendingProposal.value
  if (!proposal || running.value) return
  running.value = true
  errorMessage.value = ''
  const accepted = [...selectedEdits.value].sort((a, b) => a - b)
  try {
    if (decision === 'accept') {
      const edits = accepted.map((index) => proposal.edits[index]).filter(Boolean)
      await applyEdits(edits)
    }
    const result = await resumeAgentStream(
      {
        threadId: threadId.value,
        decision,
        accepted: decision === 'accept' ? accepted : undefined,
        ...modelPayload(),
      },
      {
        onStep: (step) => {
          steps.value = [...steps.value, step]
        },
      },
    )
    answer.value = result.answer
    turns.value = [
      ...turns.value,
      { goal: decision === 'accept' ? '已采纳改写' : '放弃改写', answer: result.answer },
    ]
    pendingProposal.value = null
    selectedEdits.value = []
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '继续执行失败'
  } finally {
    running.value = false
  }
}

const newSession = (): void => {
  if (running.value) return
  threadId.value = ''
  turns.value = []
  steps.value = []
  answer.value = ''
  pendingProposal.value = null
  selectedEdits.value = []
  writeBackNote.value = ''
}

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
  score?: number
  edits?: Array<{ before: string; after: string; reason: string }>
  questions?: Array<{ type: string; question: string; answer: string; difficulty: string }>
  summary?: string
  suggestions?: Array<{ title: string; detail: string }>
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
    if (typeof result.score === 'number') {
      return {
        tool: step.tool,
        score: result.score,
        text: typeof result.summary === 'string' ? result.summary : '',
        suggestions: Array.isArray(result.suggestions)
          ? (result.suggestions as StepDisplay['suggestions'])
          : [],
      }
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
        <span>给一个目标，让它自己决定该做什么；可以连续追问</span>
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

        <div class="agent-model-summary">
          <span>会话：{{ threadId ? threadId.slice(0, 8) : '新会话' }}</span>
          <button v-if="threadId && !running" type="button" class="text-button" @click="newSession">
            新会话
          </button>
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
          @click="runGoal"
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
        <p v-if="writeBackNote" class="control-note">{{ writeBackNote }}</p>
        <p v-if="errorMessage" class="control-note control-note--warn">
          {{ errorMessage }}
          <span class="interview-row">
            <button type="button" class="text-button" :disabled="running" @click="runGoal">
              重试
            </button>
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
        <div v-if="turns.length" class="agent-turns">
          <details v-for="(turn, index) in turns" :key="index" class="agent-turn">
            <summary>{{ turn.goal }}</summary>
            <p>{{ turn.answer }}</p>
          </details>
        </div>

        <p v-if="running" class="muted-text">agent 正在工作，每完成一步会显示在下面…</p>
        <ol class="agent-steps">
          <li v-for="(step, index) in steps" :key="index" class="agent-step">
            <strong class="agent-step__title">{{ TOOL_LABELS[step.tool] ?? step.tool }}</strong>

            <!-- 总结 / 意图 / 通用文本 -->
            <p v-if="displayOf(step).text" class="agent-step__text">
              {{ displayOf(step).text }}
            </p>

            <!-- 岗位匹配：分数 + 建议 -->
            <div v-if="displayOf(step).score !== undefined" class="agent-score">
              <span class="agent-score__value">{{ displayOf(step).score }}</span>
              <span class="agent-score__unit">/ 100</span>
            </div>
            <ul v-if="displayOf(step).suggestions?.length" class="agent-suggestions">
              <li v-for="(item, itemIndex) in displayOf(step).suggestions" :key="itemIndex">
                <strong>{{ item.title }}</strong
                >：{{ item.detail }}
              </li>
            </ul>

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

        <!-- 人工确认：图暂停在这里，勾选后才会写回简历 -->
        <div v-if="pendingProposal" class="agent-review">
          <h2>确认改写</h2>
          <p class="muted-text">{{ pendingProposal.summary }}</p>
          <label
            v-for="(edit, index) in pendingProposal.edits"
            :key="index"
            class="agent-review__item"
          >
            <input v-model="selectedEdits" type="checkbox" :value="index" />
            <span class="agent-review__body">
              <span class="agent-edit__before">{{ edit.before }}</span>
              <span class="agent-edit__after">{{ edit.after }}</span>
              <span class="agent-edit__reason">{{ edit.reason }}</span>
            </span>
          </label>
          <div class="interview-row">
            <button
              type="button"
              class="button button--primary"
              :disabled="running || selectedEdits.length === 0"
              @click="settleRewrite('accept')"
            >
              采纳所选并写回
            </button>
            <button
              type="button"
              class="button button--secondary"
              :disabled="running"
              @click="settleRewrite('reject')"
            >
              全部放弃
            </button>
          </div>
        </div>

        <div v-if="answer && !steps.length" class="agent-answer">
          <strong>结果</strong>
          <p>{{ answer }}</p>
        </div>
        <p v-if="!steps.length && !running && !answer" class="muted-text">
          运行后，每一步（判断意图 / 匹配分析 / 改写 / 出题）都会实时出现在这里。
        </p>

        <!-- 多轮追问：沿用同一个 threadId -->
        <div v-if="threadId && !running && !pendingProposal" class="agent-followup">
          <input
            v-model="followUp"
            type="text"
            placeholder="继续追问，例如：那项目经历该怎么改？"
            @keyup.enter="askFollowUp"
          />
          <button
            type="button"
            class="button button--secondary"
            :disabled="!followUp.trim()"
            @click="askFollowUp"
          >
            追问
          </button>
        </div>
      </section>
    </div>
  </main>
</template>
