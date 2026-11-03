/**
 * 提示词档位：同一个产品要能喂饱 1.5B 的小模型，也要能压榨 14B/云端模型。
 *
 * 小模型的失败模式不是「写得差」，而是「要求太多直接崩」——给五段结构它会漏段、
 * 给 900 字目标它会写到一半截断、给「必须出现两个量化指标」它会开始编数字。
 * 所以按模型量级切换的是**要求密度**，不是换个说法。
 */
export type PromptProfileId = 'compact' | 'standard' | 'deep'

export interface PromptProfile {
  id: PromptProfileId
  label: string
  /** 给用户看的一句话说明。 */
  hint: string
  /** 答案目标长度（写进提示词的区间）。 */
  answerLength: string
  /** 答案段落结构；compact 只保留三段，避免小模型漏段。 */
  sections: string[]
  /** 是否要求加粗与行内代码：小模型经常把 `**` 用错，干脆不要求。 */
  richText: boolean
  /** 每题必须出现的量化指标个数。 */
  metrics: number
  /** 每题必须出现的技术名词个数。 */
  technicalTerms: number
  /** 是否要求两层追问。 */
  followUps: 1 | 2
}

export const PROMPT_PROFILES: Record<PromptProfileId, PromptProfile> = {
  compact: {
    id: 'compact',
    label: '精简档（1-4B 小模型）',
    hint: '要求少、段落短，牺牲深度换稳定输出；适合 qwen3:1.7b / llama3.2:3b 这类模型。',
    answerLength: '200-350 字',
    sections: [
      '**简要回答**（一句话结论）',
      '**详细回答**（2-3 条，每条 1-2 句）',
      '**追问**（1 条）',
    ],
    richText: false,
    metrics: 1,
    technicalTerms: 1,
    followUps: 1,
  },
  standard: {
    id: 'standard',
    label: '标准档（7-8B 本地模型）',
    hint: '默认档：五段结构 + 具体细节要求，7-8B 模型能稳定做到；适合 qwen3-8b / llama3.1:8b。',
    answerLength: '500-900 字',
    sections: [
      '**简要回答**（30-80 字结论）',
      '**详细回答**（3-4 条，每条 2-4 句）',
      '**关键细节**（2-3 个参数/命令/数据结构）',
      '**常见追问**（两层）',
      '**易错点**（1-2 条）',
    ],
    richText: true,
    metrics: 1,
    technicalTerms: 2,
    followUps: 2,
  },
  deep: {
    id: 'deep',
    label: '深度档（14B+ / 云端）',
    hint: '最严的一档：要求给出取舍对比、失败链路与可核对的数据，适合 qwen3-14b、DeepSeek 等。',
    answerLength: '900-1400 字',
    sections: [
      '**简要回答**（30-80 字结论）',
      '**详细回答**（4-6 条，每条 3-5 句）',
      '**方案对比**（至少两个方案及取舍）',
      '**关键细节**（参数/命令/数据结构/协议字段）',
      '**失败链路**（哪里先崩、如何暴露）',
      '**常见追问**（三层）',
      '**易错点**（2 条）',
    ],
    richText: true,
    metrics: 2,
    technicalTerms: 3,
    followUps: 2,
  },
}

export const DEFAULT_PROFILE: PromptProfileId = 'standard'

export const resolveProfile = (id?: string): PromptProfile =>
  PROMPT_PROFILES[(id as PromptProfileId) ?? DEFAULT_PROFILE] ?? PROMPT_PROFILES[DEFAULT_PROFILE]

/**
 * 按模型名猜档位：用户不必懂参数规模。
 * 命中不了就返回 undefined，交给用户自己选。
 */
export const suggestProfile = (model: string): PromptProfileId | undefined => {
  const name = model.toLowerCase()
  // 取「数字 + b」里的数字：qwen3:1.7b → 1.7，qwen3-8b → 8，qwen3:14b → 14
  const size = name.match(/(\d+(?:\.\d+)?)\s*b\b/)
  if (size) {
    const value = Number(size[1])
    if (Number.isFinite(value)) {
      if (value <= 4) return 'compact'
      if (value <= 9) return 'standard'
      return 'deep'
    }
  }
  if (/deepseek|gpt|claude|qwen-max|qwen-plus/.test(name)) return 'deep'
  return undefined
}
