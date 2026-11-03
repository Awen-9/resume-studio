import { buildStreamSystemPrompt, buildSystemPrompt } from '../../server/services/interviewPrompts'
import { PROMPT_PROFILES, suggestProfile } from '../../server/services/interviewProfiles'

describe('prompt profiles', () => {
  const types = ['scenario', 'algorithm'] as const

  it('asks less of small models and more of large ones', () => {
    const compact = buildSystemPrompt([...types], 'compact')
    const standard = buildSystemPrompt([...types], 'standard')
    const deep = buildSystemPrompt([...types], 'deep')

    // 长度要求逐档加码
    expect(compact).toContain(PROMPT_PROFILES.compact.answerLength)
    expect(standard).toContain(PROMPT_PROFILES.standard.answerLength)
    expect(deep).toContain(PROMPT_PROFILES.deep.answerLength)

    // 段落数递增：小模型三段，深度档七段
    expect(PROMPT_PROFILES.compact.sections).toHaveLength(3)
    expect(PROMPT_PROFILES.deep.sections.length).toBeGreaterThan(
      PROMPT_PROFILES.standard.sections.length,
    )
    // 小模型不要求加粗与反引号
    expect(compact).not.toContain('反引号')
    expect(standard).toContain('反引号')
  })

  it('falls back to the standard profile for unknown values', () => {
    expect(buildSystemPrompt([...types], 'nonsense' as never)).toContain(
      PROMPT_PROFILES.standard.answerLength,
    )
  })

  it('keeps the streaming prompt aligned with the chosen profile', () => {
    expect(buildStreamSystemPrompt(['fundamental'], 'deep')).toContain(
      PROMPT_PROFILES.deep.answerLength,
    )
  })

  it('guesses a profile from the model name', () => {
    expect(suggestProfile('qwen3:1.7b')).toBe('compact')
    expect(suggestProfile('qwen3-8b')).toBe('standard')
    expect(suggestProfile('qwen3:14b')).toBe('deep')
    expect(suggestProfile('deepseek-chat')).toBe('deep')
    expect(suggestProfile('my-custom-model')).toBeUndefined()
  })
})
