import { afterEach, beforeEach } from 'vitest'

const createMemoryStorage = (): Storage => {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size
    },
  } as Storage
}

beforeEach(() => {
  if (typeof window === 'undefined') return
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: createMemoryStorage(),
  })
})

afterEach(() => {
  if (typeof window !== 'undefined') window.localStorage.clear()
})
