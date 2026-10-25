import { createDefaultDocument } from '@/data/defaultResume'
import {
  deleteStoredDocument,
  exportStoredDocuments,
  importStoredDocuments,
  listDocumentHistory,
  listStoredDocuments,
  loadStoredDocument,
  saveStoredDocument,
} from '@/lib/storage'

describe('local resume storage', () => {
  it('saves, lists, loads and deletes documents', async () => {
    const document = createDefaultDocument()
    await saveStoredDocument(document)
    document.title = '更新后的简历'
    await saveStoredDocument(document)
    expect(await listStoredDocuments()).toHaveLength(1)
    expect((await loadStoredDocument(document.id))?.title).toBe(document.title)
    expect(await listDocumentHistory(document.id)).toHaveLength(2)
    await deleteStoredDocument(document.id)
    expect(await listStoredDocuments()).toHaveLength(0)
  })

  it('exports and imports a portable JSON backup', async () => {
    const document = createDefaultDocument()
    await saveStoredDocument(document)
    const backup = await exportStoredDocuments()
    window.localStorage.clear()
    expect(await importStoredDocuments(backup)).toBe(1)
    expect((await loadStoredDocument(document.id))?.profile.name).toBe('你的姓名')
  })

  it('rejects invalid backup data', async () => {
    await expect(importStoredDocuments('{"invalid": true}')).rejects.toThrow('备份文件格式不正确')
  })
})
