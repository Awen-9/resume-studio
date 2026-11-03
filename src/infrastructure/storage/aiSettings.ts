/**
 * 模型来源设置。
 *
 * 只存在本机浏览器：DeepSeek 的 Key 不上传、不写进备份，
 * 每次请求时作为 `x-ai-key` 头发给本机服务，由本机服务转发给 DeepSeek。
 */
export type ProviderId = 'ollama' | 'deepseek'

export interface AiSettings {
  provider: ProviderId
  deepseekKey: string
  /** 默认模型名；空则用服务端/后端的默认值。 */
  model?: string
}

const KEY = 'resume-studio.ai-settings.v1'

export const loadAiSettings = (): AiSettings => {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { provider: 'ollama', deepseekKey: '', model: '' }
    const parsed = JSON.parse(raw) as Partial<AiSettings>
    return {
      provider: parsed.provider === 'deepseek' ? 'deepseek' : 'ollama',
      deepseekKey: typeof parsed.deepseekKey === 'string' ? parsed.deepseekKey : '',
      model: typeof parsed.model === 'string' ? parsed.model : '',
    }
  } catch {
    return { provider: 'ollama', deepseekKey: '', model: '' }
  }
}

export const saveAiSettings = (settings: AiSettings): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // 配额满时忽略：设置丢失不该阻断出题
  }
}
