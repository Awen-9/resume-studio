import { createDefaultDocument } from '@/domain/resume/defaults'
import {
  deleteStoredDocument,
  exportStoredDocuments,
  importStoredDocuments,
  listDocumentHistory,
  listStoredDocuments,
  loadAllStoredDocuments,
  loadStoredDocument,
  replaceStoredDocuments,
  saveStoredDocument,
} from '@/infrastructure/storage/indexedDbStorage'

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
    const restored = await importStoredDocuments(backup)
    expect(restored.documents).toHaveLength(1)
    expect((await loadStoredDocument(document.id))?.profile.name).toBe('你的姓名')
  })

  it('rejects invalid backup data', async () => {
    await expect(importStoredDocuments('{"invalid": true}')).rejects.toThrow('备份文件格式不正确')
  })

  it('keeps existing documents when the backup is rejected', async () => {
    const document = createDefaultDocument()
    await saveStoredDocument(document)
    // 校验必须发生在清库之前：一份坏备份不能顺手把现有简历弄丢
    await expect(importStoredDocuments('not json at all')).rejects.toThrow('不是合法的 JSON')
    expect(await listStoredDocuments()).toHaveLength(1)
    expect((await loadStoredDocument(document.id))?.profile.name).toBe(document.profile.name)
  })

  it('can restore a snapshot taken before an import', async () => {
    const original = createDefaultDocument()
    original.title = '导入前的简历'
    await saveStoredDocument(original)
    const snapshot = await loadAllStoredDocuments()
    const incoming = createDefaultDocument()
    incoming.title = '备份里的简历'
    await replaceStoredDocuments([incoming])
    expect((await listStoredDocuments())[0].title).toBe('备份里的简历')
    await replaceStoredDocuments(snapshot)
    expect((await listStoredDocuments())[0].title).toBe('导入前的简历')
  })
})
