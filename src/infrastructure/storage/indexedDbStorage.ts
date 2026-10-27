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

export const saveStoredDocument = async (document: ResumeDocument): Promise<void> => {
  const snapshot = clone(document)
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
    key: `${snapshot.id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    documentId: snapshot.id,
    createdAt: snapshot.updatedAt,
    document: snapshot,
  } satisfies HistoryRecord)
  await done
  await trimIndexedHistory(snapshot.id)
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

export const exportStoredDocuments = async (): Promise<string> => {
  const documents = hasIndexedDb() ? await readIndexedDocuments() : readFallbackPayload().documents
  return JSON.stringify({ documents }, null, 2)
}

export const importStoredDocuments = async (raw: string): Promise<number> => {
  const payload = JSON.parse(raw) as StoragePayload
  if (!Array.isArray(payload.documents)) throw new Error('备份文件格式不正确')
  if (!hasIndexedDb()) {
    writeFallbackPayload({ documents: payload.documents.map(clone), history: {} })
    return payload.documents.length
  }
  const database = await openDatabase()
  const transaction = database.transaction([DOCUMENT_STORE, HISTORY_STORE], 'readwrite')
  const done = transactionDone(transaction)
  const documents = transaction.objectStore(DOCUMENT_STORE)
  const history = transaction.objectStore(HISTORY_STORE)
  const oldDocuments = (await requestResult(documents.getAll())) as ResumeDocument[]
  const oldHistory = (await requestResult(history.getAll())) as HistoryRecord[]
  oldDocuments.forEach((document) => documents.delete(document.id))
  oldHistory.forEach((record) => history.delete(record.key))
  payload.documents.forEach((document) => {
    documents.put(clone(document))
    history.put({
      key: `${document.id}:import:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      documentId: document.id,
      createdAt: document.updatedAt,
      document: clone(document),
    } satisfies HistoryRecord)
  })
  await done
  return payload.documents.length
}
