import type { JobProfile } from '@/domain/jobProfile'

const STORAGE_KEY = 'resume-studio:job-profiles'

const readAll = (): JobProfile[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as JobProfile[]) : []
  } catch {
    return []
  }
}

const writeAll = (profiles: JobProfile[]): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles))
}

export const listJobProfiles = (): JobProfile[] =>
  readAll().sort((a, b) => b.createdAt - a.createdAt)

export const saveJobProfile = (profile: JobProfile): void => {
  const others = readAll().filter((item) => item.id !== profile.id)
  writeAll([profile, ...others])
}

export const deleteJobProfile = (id: string): void => {
  writeAll(readAll().filter((item) => item.id !== id))
}
