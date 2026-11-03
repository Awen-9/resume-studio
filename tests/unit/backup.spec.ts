import { createDefaultDocument } from '@/domain/resume/defaults'
import { parseBackup } from '@/domain/resume/backup'

/** 构造一份「线上真实形态」的文档 JSON，便于逐字段破坏后验证归一化。 */
const documentJson = (): Record<string, unknown> =>
  JSON.parse(JSON.stringify(createDefaultDocument())) as Record<string, unknown>

describe('backup parsing', () => {
  it('reads the current { documents: [...] } shape', () => {
    const result = parseBackup(JSON.stringify({ documents: [documentJson()] }))
    expect(result.documents).toHaveLength(1)
    expect(result.skipped).toBe(0)
    expect(result.documents[0].sections.length).toBeGreaterThan(0)
  })

  it('accepts a bare array of documents', () => {
    expect(parseBackup(JSON.stringify([documentJson()])).documents).toHaveLength(1)
  })

  it('rejects invalid JSON with an actionable message', () => {
    expect(() => parseBackup('not json')).toThrow('不是合法的 JSON')
  })

  it('rejects a payload without a documents array', () => {
    expect(() => parseBackup(JSON.stringify({ resumes: [] }))).toThrow('备份文件格式不正确')
  })

  it('rejects a backup where every record is unusable', () => {
    expect(() => parseBackup(JSON.stringify({ documents: [1, 'x', null] }))).toThrow(/无法识别/)
  })

  it('skips unusable records but keeps the good ones', () => {
    const result = parseBackup(
      JSON.stringify({ documents: [null, { title: '没有模块' }, documentJson()] }),
    )
    expect(result.documents).toHaveLength(1)
    expect(result.skipped).toBe(2)
  })

  it('fills missing theme fields with defaults instead of dropping the document', () => {
    const document = documentJson()
    document.theme = { templateId: 'unknown-template', accentColor: 'red' }
    const [restored] = parseBackup(JSON.stringify({ documents: [document] })).documents
    expect(restored.theme.templateId).toBe('classic')
    expect(restored.theme.accentColor).toBe('#315D8C')
    expect(restored.theme.fontSize).toBeGreaterThan(0)
  })

  it('normalizes the legacy one-page page mode', () => {
    const document = documentJson()
    ;(document.theme as Record<string, unknown>).pageMode = 'one-page'
    expect(parseBackup(JSON.stringify({ documents: [document] })).documents[0].theme.pageMode).toBe(
      'one-page-strict',
    )
  })

  it('regenerates duplicate ids so two records cannot overwrite each other', () => {
    const first = documentJson()
    const second = documentJson()
    second.id = first.id
    const result = parseBackup(JSON.stringify({ documents: [first, second] }))
    expect(result.documents[0].id).not.toBe(result.documents[1].id)
    const itemIds = result.documents.flatMap((document) =>
      document.sections.flatMap((section) => section.items.map((item) => item.id)),
    )
    expect(new Set(itemIds).size).toBe(itemIds.length)
  })

  it('keeps the imported header fields', () => {
    const document = documentJson()
    document.profile = {
      name: '吴**',
      headline: 'Agent 应用开发',
      displayTitle: 'Java 后端',
      detail: '24 岁 · 男',
      headerLayout: 'compact',
      phone: '177****8476',
      email: '****@163.com',
      location: '西安',
      website: 'awen-9.github.io',
    }
    const [restored] = parseBackup(JSON.stringify({ documents: [document] })).documents
    expect(restored.profile.displayTitle).toBe('Java 后端')
    expect(restored.profile.detail).toBe('24 岁 · 男')
    expect(restored.profile.headerLayout).toBe('compact')
  })

  it('coerces numeric strings and clamps out-of-range values', () => {
    const document = documentJson()
    ;(document.theme as Record<string, unknown>).fontSize = '13.5'
    ;(document.theme as Record<string, unknown>).lineHeight = 99
    const [restored] = parseBackup(JSON.stringify({ documents: [document] })).documents
    expect(restored.theme.fontSize).toBe(13.5)
    expect(restored.theme.lineHeight).toBe(3)
  })

  it('refuses data written by a newer schema instead of quietly dropping fields', () => {
    const document = documentJson()
    document.schemaVersion = 2
    expect(() => parseBackup(JSON.stringify({ documents: [document] }))).toThrow(/更新版本/)
  })

  it('still accepts the current schema version', () => {
    const document = documentJson()
    document.schemaVersion = 1
    expect(parseBackup(JSON.stringify({ documents: [document] })).documents).toHaveLength(1)
  })
})
