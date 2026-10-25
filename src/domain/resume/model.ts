export type SectionType = 'education' | 'experience' | 'project' | 'skills' | 'summary' | 'custom'

export type TemplateId = 'classic' | 'compact' | 'accent'
export type PageMode = 'standard' | 'one-page-preferred' | 'one-page-strict' | 'one-page'

export interface ResumeProfile {
  name: string
  headline: string
  displayTitle?: string
  detail?: string
  headerLayout?: 'stacked' | 'compact'
  phone: string
  email: string
  location: string
  website: string
}

export interface ResumeItem {
  id: string
  title: string
  subtitle: string
  period: string
  location: string
  content: string
  bullets: string[]
}

export interface ResumeSection {
  id: string
  type: SectionType
  title: string
  visible: boolean
  items: ResumeItem[]
}

export interface ResumeTheme {
  templateId: TemplateId
  pageMode?: PageMode
  fontFamily: string
  fontSize: number
  lineHeight: number
  pageMargin: number
  sectionGap: number
  accentColor: string
  showPageNumber: boolean
}

export interface ResumeDocument {
  id: string
  title: string
  schemaVersion: number
  updatedAt: string
  profile: ResumeProfile
  theme: ResumeTheme
  sections: ResumeSection[]
}

export interface ResumeSummary {
  id: string
  title: string
  updatedAt: string
  templateId: TemplateId
}

export const SECTION_LABELS: Record<SectionType, string> = {
  education: '教育经历',
  experience: '工作经历',
  project: '项目经历',
  skills: '专业技能',
  summary: '个人总结',
  custom: '自定义模块',
}

export const TEMPLATE_LABELS: Record<TemplateId, string> = {
  classic: '经典黑白',
  compact: '紧凑单页',
  accent: '蓝色强调',
}
