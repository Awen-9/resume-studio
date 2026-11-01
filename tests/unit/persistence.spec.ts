import {
  BACKUP_REMINDER_DAYS,
  loadBackupReference,
  markBackupDone,
  needsBackupReminder,
} from '@/infrastructure/storage/persistence'

const DAY = 24 * 60 * 60 * 1000

describe('backup reminder', () => {
  it('starts counting from the first visit instead of nagging new users', () => {
    const reference = loadBackupReference()
    expect(needsBackupReminder(reference)).toBe(false)
    expect(loadBackupReference()).toBe(reference)
  })

  it('reminds after the configured number of days and resets after a backup', () => {
    const reference = loadBackupReference()
    const later = Date.parse(reference) + (BACKUP_REMINDER_DAYS + 1) * DAY
    expect(needsBackupReminder(reference, later)).toBe(true)

    const backedUp = markBackupDone()
    expect(loadBackupReference()).toBe(backedUp)
    expect(needsBackupReminder(backedUp, Date.parse(backedUp) + DAY)).toBe(false)
  })
})
