import type { ResumeDocument } from './resume/model'
import { stripHtml } from './resume/validation'

/** 题型：与 server/services/interview.ts 的枚举保持一致。 */
export const QUESTION_TYPES = ['scenario', 'fundamental', 'basic', 'algorithm', 'project'] as const
export type QuestionType = (typeof QUESTION_TYPES)[number]

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  scenario: '场景题',
  fundamental: '八股文',
  basic: '基础知识',
  algorithm: '算法',
  project: '项目深挖',
}

export interface InterviewQuestion {
  type: QuestionType
  question: string
  answer: string
  difficulty: 'easy' | 'medium' | 'hard'
}

/**
 * 收藏的题目。
 *
 * JD 和简历在收藏那一刻**存快照**：简历之后改了、删了，这道题的上下文还在。
 * 只存引用的话，题库里会留下一堆打不开的题目。
 */
export interface FavoriteQuestion extends InterviewQuestion {
  id: string
  createdAt: string
  model: string
  /** 出题时使用的岗位描述（原文）。 */
  jd: string
  resumeTitle: string
  /** 简历的纯文本快照，点开题目详情时可以对照。 */
  resumeSnapshot: string
}

/** 把简历压成一段纯文本，供出题和快照使用。 */
export const resumeToPlainText = (document: ResumeDocument): string => {
  const { name, headline, phone, email, location } = document.profile
  const header = [name, headline, [phone, email, location].filter(Boolean).join(' / ')]
    .filter((line) => line && line.trim())
    .join('\n')
  const body = document.sections
    .filter((section) => section.visible)
    .map((section) => {
      const items = section.items.map((item) => {
        const head = [item.title, item.subtitle, item.period, item.location]
          .filter((value) => value && value.trim())
          .join(' | ')
        const content = stripHtml(item.content).trim()
        const bullets = item.bullets.filter(Boolean).map((bullet) => `- ${bullet}`)
        return [head, content, ...bullets].filter((line) => line && line.trim()).join('\n')
      })
      return [`【${section.title}】`, ...items].join('\n')
    })
    .join('\n\n')
  return [header, body].filter(Boolean).join('\n\n')
}
