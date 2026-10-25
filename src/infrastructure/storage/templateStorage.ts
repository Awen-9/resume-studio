import type { ResumeTheme } from '@/domain/resume/model'

const TEMPLATE_KEY = 'resume-studio.custom-theme.v1'

export const saveCustomTheme = (theme: ResumeTheme): void => {
  localStorage.setItem(TEMPLATE_KEY, JSON.stringify({ ...theme }))
}

export const loadCustomTheme = (): ResumeTheme | null => {
  try {
    const raw = localStorage.getItem(TEMPLATE_KEY)
    return raw ? (JSON.parse(raw) as ResumeTheme) : null
  } catch {
    return null
  }
}
