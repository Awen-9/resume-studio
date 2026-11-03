/**
 * 面试出题的提示词与评分要点。
 *
 * 答案结构参考 JavaGuide 这类技术八股文的写法：
 * 「简要回答」先给结论，再「详细回答」分点展开机制，最后「常见追问」「易错点」。
 * 结构本身随模型档位变化（见 interviewProfiles.ts）：小模型要求少，大模型要求狠。
 */

import { resolveProfile, type PromptProfileId } from './interviewProfiles.js'

export type PromptType = 'scenario' | 'fundamental' | 'basic' | 'algorithm' | 'project'

/** 每种题型在「详细回答」里的展开重点。 */
export const TYPE_RUBRICS: Record<PromptType, string> = {
  scenario:
    '详细回答按「约束澄清 → 方案与取舍 → 落地步骤（含组件与参数）→ 只有 5 分钟时先做什么 → 兜底与指标」展开',
  fundamental:
    '详细回答按「一句话结论 → 实现原理（讲到数据结构与调用链）→ 边界与代价 → 与相近概念的区别」展开',
  basic: '详细回答按「准确定义 → 一个能跑通的例子 → 常见误解及后果 → 面试官为什么问这个」展开',
  algorithm:
    '详细回答按「输入规模与边界 → 暴力解及复杂度 → 优化思路与数据结构 → 关键代码要点 → 3 个边界用例」展开',
  project:
    '详细回答按「背景与量级 → 我做了什么、关键决策 → 量化结果 → 踩过的坑 → 如果重做会怎么改」展开',
}

const buildAnswerFormat = (profileId?: PromptProfileId): string => {
  const profile = resolveProfile(profileId)
  return [
    '答案的书写格式（每道题都必须严格照这个结构，用换行分段）：',
    '',
    profile.sections.join('\n\n'),
    '',
    `总长度 ${profile.answerLength}。`,
  ].join('\n')
}

const buildSharedRules = (profileId?: PromptProfileId): string => {
  const profile = resolveProfile(profileId)
  const rules = [
    '内容标准（必须满足）：',
    `1. 每个分点至少 ${profile.id === 'compact' ? '1-2' : '2'} 句，禁止一句话收尾；`,
    `2. 必须出现 ${profile.technicalTerms} 个以上具体技术名词（组件、命令、配置项、数据结构、协议字段）；`,
    `3. 必须出现 ${profile.metrics} 个以上量化指标（P99、QPS、内存占用、连接数、毫秒数、容量）；`,
    '4. 必须写清失败时的现象，便于排查；',
    '5. 禁止「提升性能」「优化流程」「加强监控」这类没有主语和数据的表述。',
  ]
  if (profile.richText) {
    rules.push('6. 关键术语用 **加粗**，命令/参数/代码用 `反引号`——渲染时会显示为强调与等宽字体。')
  }
  rules.push(
    '',
    '风格锚点（照这个信息密度写）：',
    '反例：优化了查询性能，提升了用户体验。',
    '正例：给 `order` 表建 `(user_id, created_at)` 联合索引，把 range scan 变成 index range scan，',
    '回表次数从每次 300 次降到 4 次，**P99 从 480ms 降到 90ms**；代价是写入慢约 8%。',
  )
  return rules.join('\n')
}

const buildDepthRules = (): string =>
  [
    '出题质量要求：',
    '- 题目要「追问式」，不要教科书式。不要问「什么是索引」，要问「你这个查询建了联合索引还是慢，可能是什么原因」；',
    '- 每题都要能落到简历里的具体经历或技术栈上；简历写得含糊的地方优先作为突破口；',
    '- 同一批次不重复考点：分别覆盖设计、排查、权衡、编码、协作；',
    '- 难度分布约为 简单 2 : 中等 5 : 困难 3。',
  ].join('\n')

const rubricTable = (types: PromptType[], profileId?: PromptProfileId): string => {
  const profile = resolveProfile(profileId)
  // 小模型只给最核心的两段，避免提示词本身太长把注意力拉走
  const depth = profile.id === 'compact' ? 0 : profile.id === 'deep' ? 3 : 2
  return types
    .map((type) => {
      const rubric = TYPE_RUBRICS[type]
      if (!rubric) return null
      const parts = rubric.split('→')
      return `- ${type}：${parts.slice(0, depth + 1).join('→')}`
    })
    .filter((line): line is string => line !== null)
    .join('\n')
}

/** 批量（非流式）出题的系统提示词。 */
export const buildSystemPrompt = (types: PromptType[], profileId?: PromptProfileId): string =>
  [
    '你是资深技术面试官兼技术专栏作者，正在根据岗位描述（JD）和候选人简历出面试题。',
    '',
    '输出要求（严格遵守）：',
    '1. 只输出一个 JSON 对象：{"questions":[{"type":"...","question":"...","answer":"...","difficulty":"easy|medium|hard"}]}',
    '2. 不要 markdown 代码块，不要任何解释性文字。',
    '3. answer 里的换行写成 \\n 转义。',
    '',
    buildDepthRules(),
    '',
    buildAnswerFormat(profileId),
    '',
    buildSharedRules(profileId),
    '',
    '按题型的展开重点：',
    rubricTable(types, profileId),
  ].join('\n')

/** 流式出题（一行一个 JSON 对象）的系统提示词。 */
export const buildStreamSystemPrompt = (types: PromptType[], profileId?: PromptProfileId): string =>
  [
    '你是资深技术面试官兼技术专栏作者，正在根据候选人简历（以及可选的岗位描述）出面试题。',
    '',
    '输出格式（严格遵守）：',
    '1. 每行输出一个 JSON 对象，对象之间用换行分隔，不要输出数组方括号；',
    '2. 每个对象只包含四个字段：type、question、answer、difficulty；',
    '3. type 只能是 scenario / fundamental / basic / algorithm / project 之一；',
    '4. difficulty 只能是 easy / medium / hard 之一；',
    '5. answer 里的换行写成 \\n 转义；不要 markdown 代码块、不要解释、不要编号。',
    '',
    buildDepthRules(),
    '',
    buildAnswerFormat(profileId),
    '',
    buildSharedRules(profileId),
    '',
    '按题型的展开重点：',
    rubricTable(types, profileId),
  ].join('\n')
