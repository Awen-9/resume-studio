/**
 * 防止浏览器清理本地简历数据，并提醒用户定期备份。
 *
 * 未申请持久化的站点数据在磁盘紧张时可能被浏览器整体清除，
 * 而简历只保存在本机，所以启动时申请持久化，并在长时间未备份时提醒用户。
 */

const BACKUP_REFERENCE_KEY = 'resume-studio.backup-reference-at'
/** 距上次备份（或首次使用）超过这个天数就在首页提醒。 */
export const BACKUP_REMINDER_DAYS = 14

/** 申请持久化存储，返回浏览器是否已同意。不支持该接口的环境返回 false。 */
export const requestPersistentStorage = async (): Promise<boolean> => {
  if (!navigator.storage?.persist) return false
  if (await navigator.storage.persisted()) return true
  return navigator.storage.persist()
}

/**
 * 备份提醒的计时起点：上次备份时间；从未备份时取首次使用时间，
 * 避免新用户刚打开就看到提醒。
 */
export const loadBackupReference = (): string => {
  const stored = localStorage.getItem(BACKUP_REFERENCE_KEY)
  if (stored) return stored
  return markBackupDone()
}

export const markBackupDone = (): string => {
  const now = new Date().toISOString()
  localStorage.setItem(BACKUP_REFERENCE_KEY, now)
  return now
}

export const needsBackupReminder = (reference: string, now = Date.now()): boolean =>
  now - Date.parse(reference) > BACKUP_REMINDER_DAYS * 24 * 60 * 60 * 1000
