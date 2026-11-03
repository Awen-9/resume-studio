import { QUESTION_TYPES, type FavoriteQuestion, type QuestionType } from '@/domain/interview'

const STORAGE_KEY = 'resume-studio.interview-favorites.v1'
/** 题库上限：再多也不像「收藏」，更像是没整理。 */
const MAX_FAVORITES = 300

const isType = (value: unknown): value is QuestionType =>
  typeof value === 'string' && (QUESTION_TYPES as readonly string[]).includes(value)

const normalize = (raw: unknown): FavoriteQuestion | null => {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const question = typeof item.question === 'string' ? item.question.trim() : ''
  const answer = typeof item.answer === 'string' ? item.answer.trim() : ''
  if (!question || !answer) return null
  return {
    id: typeof item.id === 'string' && item.id ? item.id : `q-${Date.now()}`,
    type: isType(item.type) ? item.type : 'scenario',
    difficulty:
      item.difficulty === 'easy' || item.difficulty === 'hard' ? item.difficulty : 'medium',
    question,
    answer,
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
    model: typeof item.model === 'string' ? item.model : '',
    jd: typeof item.jd === 'string' ? item.jd : '',
    resumeTitle: typeof item.resumeTitle === 'string' ? item.resumeTitle : '',
    resumeSnapshot: typeof item.resumeSnapshot === 'string' ? item.resumeSnapshot : '',
  }
}

/** 读取题库；坏数据直接丢掉，不让一条脏记录毁掉整个列表。 */
export const loadFavorites = (): FavoriteQuestion[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(normalize)
      .filter((item): item is FavoriteQuestion => item !== null)
      .slice(0, MAX_FAVORITES)
  } catch {
    return []
  }
}

export const saveFavorites = (favorites: FavoriteQuestion[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites.slice(0, MAX_FAVORITES)))
  } catch {
    // 配额满时静默失败：收藏是附加能力，不该阻断出题主流程
  }
}

export const addFavorite = (favorite: FavoriteQuestion): FavoriteQuestion[] => {
  const next = [favorite, ...loadFavorites().filter((item) => item.id !== favorite.id)].slice(
    0,
    MAX_FAVORITES,
  )
  saveFavorites(next)
  return next
}

export const removeFavorite = (id: string): FavoriteQuestion[] => {
  const next = loadFavorites().filter((item) => item.id !== id)
  saveFavorites(next)
  return next
}
