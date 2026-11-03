<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ResumeDocument } from '@/domain/resume/model'
import { stripHtml } from '@/domain/resume/validation'
import {
  matchResumeToJob,
  type JobMatchResult,
  type JobMatchSuggestion,
} from '@/infrastructure/api/localResumeApi'
import { useDialogA11y } from '@/shared/ui/useDialogA11y'
import { useAiStatus } from '@/shared/ui/useAiStatus'

const props = defineProps<{ document: ResumeDocument; open: boolean }>()
const emit = defineEmits<{ close: []; goto: [keyword: string] }>()

const dialogRef = ref<HTMLElement | null>(null)
useDialogA11y(dialogRef, { isOpen: () => props.open, onClose: () => emit('close') })

/** 与服务端 `RESUME_CHAR_LIMIT` 保持一致：超出部分模型看不到，界面上要说清楚。 */
const RESUME_CHAR_LIMIT = 9_000

const jdKey = (id: string): string => `resume-studio:jd:${id}`

/** 把文档压成纯文本提要：模型只需要能读懂的内容，不需要 HTML 标记。 */
const buildDigest = (document: ResumeDocument): string => {
  const lines: string[] = []
  const { profile } = document
  lines.push(`姓名：${profile.name}`)
  lines.push(`目标职位：${profile.headline}`)
  if (profile.detail) lines.push(profile.detail)
  for (const section of document.sections.filter((item) => item.visible)) {
    lines.push(`\n## ${section.title}`)
    for (const item of section.items) {
      const head = [item.title, item.subtitle, item.period, item.location]
        .filter((value) => value.trim())
        .join(' ｜ ')
      if (head) lines.push(head)
      const body = stripHtml(item.content).trim()
      if (body) lines.push(body)
      for (const bullet of item.bullets) {
        if (bullet.trim()) lines.push(`- ${bullet.trim()}`)
      }
    }
  }
  return lines.join('\n').slice(0, RESUME_CHAR_LIMIT)
}

const MODE_KEY = 'resume-studio:jd-mode'

const jd = ref(window.localStorage.getItem(jdKey(props.document.id)) ?? '')
/** 快速：一次出结论；深度：逐词核对并给出原文依据，慢但可验证。 */
const mode = ref<'fast' | 'deep'>(
  window.localStorage.getItem(MODE_KEY) === 'deep' ? 'deep' : 'fast',
)
watch(mode, (value) => window.localStorage.setItem(MODE_KEY, value))

const loading = ref(false)
const error = ref('')
const result = ref<JobMatchResult | null>(null)
/** 正在跑的请求，用来支持「取消」以及关闭对话框时中断上游生成。 */
let inFlight: AbortController | null = null

/** 模型没起来时提前说清楚，别让用户点完等 2 分钟再看到 502。 */
const { status: aiStatus } = useAiStatus()
const aiUnavailable = computed(() => aiStatus.value !== null && !aiStatus.value.available)

// 同一份简历的 JD 粘一次就该记住
watch(jd, (value) => window.localStorage.setItem(jdKey(props.document.id), value))

const digest = computed(() => buildDigest(props.document))

/** 深度模式命中的词都带原文依据，面板里列出来让用户能核对。 */
const evidenceList = computed(() => {
  if (mode.value !== 'deep') return []
  return Object.entries(result.value?.evidence ?? {})
    .slice(0, 10)
    .map(([term, evidence]) => ({ term, evidence }))
})
/** 正文超出上限时提示，避免用户以为模型"漏看"了后半段。 */
const digestTruncated = computed(() => buildDigest(props.document).length >= RESUME_CHAR_LIMIT)
const canRun = computed(
  () => jd.value.trim().length >= 10 && !loading.value && !aiUnavailable.value,
)

const cancelRun = (): void => {
  inFlight?.abort()
  inFlight = null
  loading.value = false
  error.value = '已取消本次评估'
}

// 对话框关掉还在跑的深度评估没有意义：直接中断，省 GPU 也省电
watch(
  () => props.open,
  (open) => {
    if (!open && inFlight) {
      inFlight.abort()
      inFlight = null
      loading.value = false
    }
  },
)

const scoreTone = computed(() => {
  const score = result.value?.score ?? 0
  if (score >= 80) return 'high'
  if (score >= 60) return 'mid'
  return 'low'
})

/** 分数要有一句可行动的解读，光给数字用户不知道差在哪。 */
const scoreVerdict = computed(() => {
  if (!result.value) return ''
  const missing = result.value.missing.length
  if (result.value.score >= 80) return '匹配度高，可以按建议做最后微调'
  if (result.value.score >= 60) return `基本匹配，还有 ${missing} 项岗位要求没体现`
  return `差距明显，缺 ${missing} 项关键要求，建议先补内容再投`
})

/**
 * 「去修改」要跳到哪个模块，取决于建议里提到的是哪个能力。
 *
 * 之前直接把建议标题（「补上 Kubernetes」）当关键词传出去，而简历正文里永远不会
 * 出现这句话，于是每次都会落到第一个模块。这里改成从建议文本里反查已知词条：
 * 优先缺失项，其次命中项，最后退回建议里出现的英文技术词。
 */
const anchorFor = (suggestion: JobMatchSuggestion): string => {
  const text = `${suggestion.title} ${suggestion.detail}`.toLowerCase()
  const terms = [...(result.value?.missing ?? []), ...(result.value?.matched ?? [])]
  const hit = terms.find(
    (term) => term.trim().length >= 2 && text.includes(term.trim().toLowerCase()),
  )
  if (hit) return hit
  const latin = `${suggestion.title} ${suggestion.detail}`.match(/[A-Za-z][A-Za-z0-9+#.]{2,}/g)
  return latin?.[0] ?? ''
}

const run = async (): Promise<void> => {
  if (!canRun.value) return
  loading.value = true
  error.value = ''
  const controller = new AbortController()
  inFlight = controller
  try {
    result.value = await matchResumeToJob({
      jd: jd.value.trim(),
      resume: digest.value,
      mode: mode.value,
      signal: controller.signal,
    })
  } catch (caught) {
    // 用户主动取消不是错误，不要弹红字吓人
    if (controller.signal.aborted) return
    error.value = caught instanceof Error ? caught.message : '体检失败'
  } finally {
    if (inFlight === controller) inFlight = null
    loading.value = false
  }
}
</script>

<template>
  <div class="dialog-backdrop" @click.self="emit('close')">
    <section
      ref="dialogRef"
      class="job-match"
      role="dialog"
      aria-modal="true"
      aria-labelledby="job-match-title"
    >
      <header class="job-match__header">
        <div>
          <span class="eyebrow">JOB MATCH</span>
          <h2 id="job-match-title">岗位匹配体检</h2>
          <p class="job-match__lead">粘贴目标岗位的 JD，用本机模型评估匹配度并给出改写建议。</p>
        </div>
        <button
          type="button"
          class="icon-button"
          aria-label="关闭"
          title="关闭"
          @click="emit('close')"
        >
          ×
        </button>
      </header>

      <div class="job-match__body">
        <div class="job-match__modes" role="group" aria-label="评估模式">
          <button
            type="button"
            :class="{ active: mode === 'fast' }"
            :aria-pressed="mode === 'fast'"
            @click="mode = 'fast'"
          >
            <strong>快速</strong>
            <span>约 10 秒，直接看结论</span>
          </button>
          <button
            type="button"
            :class="{ active: mode === 'deep' }"
            :aria-pressed="mode === 'deep'"
            @click="mode = 'deep'"
          >
            <strong>深度</strong>
            <span>约 30–60 秒，逐词给原文依据</span>
          </button>
        </div>

        <label class="job-match__label" for="job-match-jd">岗位描述</label>
        <textarea
          id="job-match-jd"
          v-model="jd"
          class="job-match__textarea"
          rows="4"
          placeholder="把招聘网站的职位描述整段粘进来，包含职责和要求…"
        ></textarea>
        <p class="job-match__hint">
          简历正文按当前文档自动提取，约 {{ digest.length }} 字，不会离开本机。
          <span v-if="digestTruncated"
            >已截到 {{ RESUME_CHAR_LIMIT }} 字，后面部分不参与评估。</span
          >
        </p>

        <p v-if="aiUnavailable" class="job-match__hint job-match__hint--warn">
          本机模型未就绪{{ aiStatus?.model ? `（模型 ${aiStatus.model}）` : '' }}：请先启动 Ollama
          并导入对应模型，再回来体检。
        </p>

        <p v-if="error" class="job-match__error">{{ error }}</p>

        <div v-if="result" class="job-match__result">
          <div class="job-match__scoreline">
            <div class="job-match__score" :class="`job-match__score--${scoreTone}`">
              <strong>{{ result.score }}</strong
              ><span>/ 100</span>
            </div>
            <p class="job-match__summary">{{ result.summary }}</p>
          </div>
          <p class="job-match__verdict">{{ scoreVerdict }}</p>

          <div v-if="result.matched.length" class="job-match__group">
            <h3 class="job-match__group-title">已具备（{{ result.matched.length }}）</h3>
            <div class="job-match__chips">
              <span v-for="keyword in result.matched" :key="`m-${keyword}`" class="chip chip--ok">
                {{ keyword }}
              </span>
            </div>
          </div>

          <div v-if="result.missing.length" class="job-match__group">
            <h3 class="job-match__group-title">待补充（{{ result.missing.length }}）</h3>
            <div class="job-match__chips">
              <span v-for="keyword in result.missing" :key="`x-${keyword}`" class="chip chip--miss">
                {{ keyword }}
              </span>
            </div>
          </div>

          <div v-if="evidenceList.length" class="job-match__evidence">
            <h3 class="job-match__group-title">判定依据（{{ evidenceList.length }}）</h3>
            <ul>
              <li v-for="item in evidenceList" :key="`ev-${item.term}`">
                <strong>{{ item.term }}</strong>
                <span>{{ item.evidence }}</span>
              </li>
            </ul>
          </div>

          <ol v-if="result.suggestions.length" class="job-match__suggestions">
            <li v-for="(suggestion, index) in result.suggestions" :key="index">
              <div>
                <strong>{{ suggestion.title }}</strong>
                <span>{{ suggestion.detail }}</span>
              </div>
              <button
                type="button"
                class="text-button"
                title="跳到简历里对应的模块"
                @click="emit('goto', anchorFor(suggestion))"
              >
                去修改
              </button>
            </li>
          </ol>
        </div>
      </div>

      <footer class="job-match__actions">
        <button v-if="loading" type="button" class="button button--secondary" @click="cancelRun">
          取消评估
        </button>
        <button v-else type="button" class="button button--secondary" @click="emit('close')">
          关闭
        </button>
        <button type="button" class="button button--primary" :disabled="!canRun" @click="run">
          {{
            loading
              ? mode === 'deep'
                ? '深度评估中…'
                : '体检中…'
              : result
                ? '重新体检'
                : '开始体检'
          }}
        </button>
      </footer>
    </section>
  </div>
</template>
