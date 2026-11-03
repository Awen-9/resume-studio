/** 岗位档案：一次「匹配岗位」agent 运行的结果，可跨会话复用（一岗一版）。 */

export interface JobProfileStep {
  tool: string
  result: unknown
}

export interface JobProfile {
  id: string
  resumeId: string
  /** 岗位名，用于列表里一眼认出。 */
  title: string
  jd: string
  goal: string
  createdAt: number
  answer: string
  steps: JobProfileStep[]
}

export const makeJobProfileId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `jp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
