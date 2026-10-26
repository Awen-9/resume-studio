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

/** 字体预设：一组可一键套用的中英文字体组合。 */
export interface FontPreset {
  id: string
  label: string
  value: string
}

export const FONT_PRESETS: FontPreset[] = [
  {
    id: 'sans',
    label: '黑体 / 无衬线',
    value: 'Noto Sans SC, PingFang SC, Microsoft YaHei, sans-serif',
  },
  {
    id: 'serif',
    label: '宋体 / 衬线',
    value: 'Georgia, Noto Serif SC, SimSun, serif',
  },
  {
    id: 'modern',
    label: '现代清爽',
    value: 'Helvetica Neue, Arial, Noto Sans SC, sans-serif',
  },
]

/** 配色预设：常用简历强调色，配合字体预设实现快速换肤。 */
export interface AccentPreset {
  id: string
  label: string
  value: string
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'navy', label: '藏蓝', value: '#315D8C' },
  { id: 'teal', label: '青绿', value: '#1F7A6D' },
  { id: 'slate', label: '石板灰', value: '#4B5563' },
  { id: 'wine', label: '酒红', value: '#8C3B4E' },
  { id: 'ink', label: '墨黑', value: '#20262D' },
]
