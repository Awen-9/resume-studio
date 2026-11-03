import { parseBackup, type BackupParseResult } from '@/domain/resume/backup'
import type { ResumeDocument, ResumeSummary } from '@/domain/resume/model'

/**
 * 简历本地持久化层。
 *
 * 首选 IndexedDB（无容量上限、支持索引查询），并保留 localStorage 作为回退：
 * - 不支持 IndexedDB 的测试/受限环境自动回退到 localStorage；
 * - 首次打开时会把历史 localStorage 数据一次性迁移进 IndexedDB。
 *
 * 历史版本以独立的 `history` 对象存储存储，按 `documentId` 建索引，
 * 每个文档最多保留 {@link MAX_HISTORY} 条，超出后自动裁剪最旧的记录。
 */

const STORAGE_KEY = 'resume-studio.documents.v1'
const DB_NAME = 'resume-studio'
const DB_VERSION = 1
const DOCUMENT_STORE = 'documents'
const HISTORY_STORE = 'history'
const MAX_HISTORY = 20

interface StoragePayload {
  documents: ResumeDocument[]
  history?: Record<string, ResumeDocument[]>
}

interface HistoryRecord {
  key: string
  documentId: string
  createdAt: string
  document: ResumeDocument
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const getStorage = (): Storage => {
  if (typeof window !== 'undefined') return window.localStorage
  return globalThis.localStorage
}

const hasIndexedDb = (): boolean => typeof indexedDB !== 'undefined'

let databasePromise: Promise<IDBDatabase> | null = null
let migrationPromise: Promise<void> | null = null

const requestResult = <T>(request: IDBRequest<T>): Promise<T> => {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

const transactionDone = (transaction: IDBTransaction): Promise<void> => {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed'))
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
  })
}

const openDatabase = (): Promise<IDBDatabase> => {
  if (!hasIndexedDb()) return Promise.reject(new Error('IndexedDB is not available'))
  if (databasePromise) return databasePromise
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(DOCUMENT_STORE)) {
        database.createObjectStore(DOCUMENT_STORE, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(HISTORY_STORE)) {
        const history = database.createObjectStore(HISTORY_STORE, { keyPath: 'key' })
        history.createIndex('documentId', 'documentId', { unique: false })
        history.createIndex('createdAt', 'createdAt', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Unable to open IndexedDB'))
  })
  return databasePromise
}

const readFallbackPayload = (): StoragePayload => {
  try {
    const raw = getStorage().getItem(STORAGE_KEY)
    if (!raw) return { documents: [], history: {} }
    const payload = JSON.parse(raw) as StoragePayload
    return Array.isArray(payload.documents)
      ? { history: {}, ...payload }
      : { documents: [], history: {} }
  } catch {
    return { documents: [], history: {} }
  }
}

const writeFallbackPayload = (payload: StoragePayload): void => {
  getStorage().setItem(STORAGE_KEY, JSON.stringify(payload))
}

const migrateFallbackData = async (): Promise<void> => {
  if (!hasIndexedDb()) return
  const database = await openDatabase()
  const transaction = database.transaction(DOCUMENT_STORE, 'readonly')
  const done = transactionDone(transaction)
  const existing = (await requestResult(
    transaction.objectStore(DOCUMENT_STORE).getAll(),
  )) as ResumeDocument[]
  await done
  if (existing.length > 0) return

  const fallback = readFallbackPayload()
  if (fallback.documents.length === 0) return
  const writeTransaction = database.transaction([DOCUMENT_STORE, HISTORY_STORE], 'readwrite')
  const documents = writeTransaction.objectStore(DOCUMENT_STORE)
  const history = writeTransaction.objectStore(HISTORY_STORE)
  for (const document of fallback.documents) {
    documents.put(clone(document))
    history.put({
      key: `${document.id}:migration`,
      documentId: document.id,
      createdAt: document.updatedAt,
      document: clone(document),
    } satisfies HistoryRecord)
  }
  await transactionDone(writeTransaction)
}

const ensureMigrated = async (): Promise<void> => {
  if (!hasIndexedDb()) return
  migrationPromise ??= migrateFallbackData().catch(() => undefined)
  await migrationPromise
}

const readIndexedDocuments = async (): Promise<ResumeDocument[]> => {
  await ensureMigrated()
  const database = await openDatabase()
  const transaction = database.transaction(DOCUMENT_STORE, 'readonly')
  const done = transactionDone(transaction)
  const documents = (await requestResult(
    transaction.objectStore(DOCUMENT_STORE).getAll(),
  )) as ResumeDocument[]
  await done
  return documents.map(clone)
}

const trimIndexedHistory = async (documentId: string): Promise<void> => {
  const database = await openDatabase()
  const transaction = database.transaction(HISTORY_STORE, 'readwrite')
  const done = transactionDone(transaction)
  const records = (await requestResult(
    transaction.objectStore(HISTORY_STORE).index('documentId').getAll(documentId),
  )) as HistoryRecord[]
  records
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(MAX_HISTORY)
    .forEach((record) => transaction.objectStore(HISTORY_STORE).delete(record.key))
  await done
}

export const listStoredDocuments = async (): Promise<ResumeSummary[]> => {
  const stored = hasIndexedDb() ? await readIndexedDocuments() : readFallbackPayload().documents
  return stored
    .map((document) => ({
      id: document.id,
      title: document.title,
      updatedAt: document.updatedAt,
      templateId: document.theme.templateId,
      targetRole: document.targetRole,
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

export const loadStoredDocument = async (id: string): Promise<ResumeDocument | null> => {
  if (!hasIndexedDb())
    return readFallbackPayload().documents.find((document) => document.id === id) ?? null
  await ensureMigrated()
  const database = await openDatabase()
  const transaction = database.transaction(DOCUMENT_STORE, 'readonly')
  const done = transactionDone(transaction)
  const document = (await requestResult(transaction.objectStore(DOCUMENT_STORE).get(id))) as
    ResumeDocument | undefined
  await done
  return document ? clone(document) : null
}

/**
 * 历史记录的写入时间戳。
 *
 * 之前直接复用 `document.updatedAt`（毫秒精度）：连续两次保存落在同一毫秒时，
 * 两条历史记录的 createdAt 相同，撤销就会随机拿到其中一条。这里用一个单调递增的
 * 时钟，保证同一会话内的保存顺序严格可排序。
 */
let lastHistoryStamp = 0
const nextHistoryStamp = (): string => {
  const now = Date.now()
  lastHistoryStamp = now > lastHistoryStamp ? now : lastHistoryStamp + 1
  return new Date(lastHistoryStamp).toISOString()
}

export const saveStoredDocument = async (document: ResumeDocument): Promise<void> => {
  const snapshot = clone(document)
  const createdAt = nextHistoryStamp()
  if (!hasIndexedDb()) {
    const payload = readFallbackPayload()
    const index = payload.documents.findIndex((item) => item.id === snapshot.id)
    if (index >= 0) payload.documents[index] = snapshot
    else payload.documents.push(snapshot)
    payload.history ??= {}
    payload.history[snapshot.id] = [snapshot, ...(payload.history[snapshot.id] ?? [])].slice(
      0,
      MAX_HISTORY,
    )
    writeFallbackPayload(payload)
    return
  }
  await ensureMigrated()
  const database = await openDatabase()
  const transaction = database.transaction([DOCUMENT_STORE, HISTORY_STORE], 'readwrite')
  const done = transactionDone(transaction)
  transaction.objectStore(DOCUMENT_STORE).put(snapshot)
  transaction.objectStore(HISTORY_STORE).put({
    key: `${snapshot.id}:${createdAt}:${Math.random().toString(36).slice(2, 8)}`,
    documentId: snapshot.id,
    createdAt,
    document: snapshot,
  } satisfies HistoryRecord)
  await done
  await trimIndexedHistory(snapshot.id)
}

/**
 * 覆盖当前文档但**不追加历史记录**。
 *
 * 撤销/重做是「在已有历史里移动指针」，不是「再保存一次」——早期实现用 save 回退，
 * 结果每撤销一步就多一条历史，连按两次撤销会在两个版本之间来回跳。
 */
export const overwriteStoredDocument = async (document: ResumeDocument): Promise<void> => {
  const snapshot = clone(document)
  if (!hasIndexedDb()) {
    const payload = readFallbackPayload()
    const index = payload.documents.findIndex((item) => item.id === snapshot.id)
    if (index >= 0) payload.documents[index] = snapshot
    else payload.documents.push(snapshot)
    writeFallbackPayload(payload)
    return
  }
  await ensureMigrated()
  const database = await openDatabase()
  const transaction = database.transaction(DOCUMENT_STORE, 'readwrite')
  const done = transactionDone(transaction)
  transaction.objectStore(DOCUMENT_STORE).put(snapshot)
  await done
}

export const deleteStoredDocument = async (id: string): Promise<void> => {
  if (!hasIndexedDb()) {
    const payload = readFallbackPayload()
    payload.documents = payload.documents.filter((document) => document.id !== id)
    delete payload.history?.[id]
    writeFallbackPayload(payload)
    return
  }
  await ensureMigrated()
  const database = await openDatabase()
  const transaction = database.transaction([DOCUMENT_STORE, HISTORY_STORE], 'readwrite')
  const done = transactionDone(transaction)
  transaction.objectStore(DOCUMENT_STORE).delete(id)
  const history = (await requestResult(
    transaction.objectStore(HISTORY_STORE).index('documentId').getAll(id),
  )) as HistoryRecord[]
  history.forEach((record) => transaction.objectStore(HISTORY_STORE).delete(record.key))
  await done
}

export const listDocumentHistory = async (id: string): Promise<ResumeDocument[]> => {
  if (!hasIndexedDb()) return (readFallbackPayload().history?.[id] ?? []).map(clone)
  await ensureMigrated()
  const database = await openDatabase()
  const transaction = database.transaction(HISTORY_STORE, 'readonly')
  const done = transactionDone(transaction)
  const records = (await requestResult(
    transaction.objectStore(HISTORY_STORE).index('documentId').getAll(id),
  )) as HistoryRecord[]
  await done
  return records
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map((record) => clone(record.document))
}

/** 读出全部文档（含未在列表里展示的完整内容），用于备份与「恢复前快照」。 */
export const loadAllStoredDocuments = async (): Promise<ResumeDocument[]> => {
  return hasIndexedDb() ? readIndexedDocuments() : readFallbackPayload().documents.map(clone)
}

export const exportStoredDocuments = async (): Promise<string> => {
  const documents = await loadAllStoredDocuments()
  return JSON.stringify({ documents }, null, 2)
}

/**
 * 用给定的文档整体替换本地库。
 *
 * 这是 destructive 操作，调用方必须先拿到用户确认或保留可撤销的快照；
 * 解析/校验要在进入本函数之前完成（见 {@link importStoredDocuments}），
 * 保证「校验失败」不会发生在清库之后。
 */
export const replaceStoredDocuments = async (documents: ResumeDocument[]): Promise<void> => {
  const snapshots = documents.map(clone)
  if (!hasIndexedDb()) {
    writeFallbackPayload({
      documents: snapshots,
      history: Object.fromEntries(snapshots.map((document) => [document.id, [document]])),
    })
    return
  }
  const database = await openDatabase()
  const transaction = database.transaction([DOCUMENT_STORE, HISTORY_STORE], 'readwrite')
  const done = transactionDone(transaction)
  const documentStore = transaction.objectStore(DOCUMENT_STORE)
  const historyStore = transaction.objectStore(HISTORY_STORE)
  const oldDocuments = (await requestResult(documentStore.getAll())) as ResumeDocument[]
  const oldHistory = (await requestResult(historyStore.getAll())) as HistoryRecord[]
  oldDocuments.forEach((document) => documentStore.delete(document.id))
  oldHistory.forEach((record) => historyStore.delete(record.key))
  snapshots.forEach((document) => {
    documentStore.put(clone(document))
    historyStore.put({
      key: `${document.id}:import:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      documentId: document.id,
      createdAt: document.updatedAt,
      document: clone(document),
    } satisfies HistoryRecord)
  })
  await done
}

/**
 * 导入备份：先解析校验，全部通过后才落库。
 *
 * 校验失败时抛出对用户可读的错误，本地现有简历保持原样——这是这层最重要的契约。
 */
export const importStoredDocuments = async (raw: string): Promise<BackupParseResult> => {
  const parsed = parseBackup(raw)
  await replaceStoredDocuments(parsed.documents)
  return parsed
}
