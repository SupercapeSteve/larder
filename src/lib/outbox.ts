/**
 * Durable outbox for writes made without a connection.
 *
 * A grocery list is used in a shop, which is exactly where signal dies. Before
 * this, an offline tap applied optimistically and then rolled back — the item
 * you just added vanished. Now the mutation is written to IndexedDB first and
 * replayed when the connection returns, so the optimistic update is a promise
 * the app can actually keep.
 *
 * IndexedDB rather than localStorage: writes must survive the tab being killed
 * mid-shop, and localStorage is synchronous and size-capped.
 *
 * Ordering matters — an "add" must be replayed before the "check" that follows
 * it — so the queue is strictly FIFO and a failure stops the drain rather than
 * skipping ahead.
 */

const DB_NAME = 'larder-outbox'
const STORE = 'mutations'
const DB_VERSION = 1

import type { ItemInsert, ItemUpdate } from '@/types/database'

// Typed against the table rather than Record<string, unknown>: a queued write
// is replayed verbatim much later, so a column typo would surface as a runtime
// failure in a shop rather than a compile error here.
export type OutboxOp =
  | { kind: 'insert'; table: 'items'; payload: ItemInsert }
  | { kind: 'update'; table: 'items'; id: string; payload: ItemUpdate }
  | { kind: 'delete'; table: 'items'; id: string }

export type OutboxEntry = {
  /** Auto-increment key; also the replay order. */
  seq?: number
  op: OutboxOp
  queuedAt: number
  attempts: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'seq', autoIncrement: true })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open the outbox'))
  })
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode)
        const request = run(transaction.objectStore(STORE))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('Outbox write failed'))
        transaction.oncomplete = () => db.close()
      }),
  )
}

/** IndexedDB is unavailable in some private-browsing modes; degrade quietly. */
function available(): boolean {
  return typeof indexedDB !== 'undefined'
}

export async function enqueue(op: OutboxOp): Promise<void> {
  if (!available()) return
  const entry: OutboxEntry = { op, queuedAt: Date.now(), attempts: 0 }
  await tx('readwrite', (store) => store.add(entry) as IDBRequest<IDBValidKey>).catch(() => undefined)
}

export async function peekAll(): Promise<OutboxEntry[]> {
  if (!available()) return []
  try {
    const all = await tx<OutboxEntry[]>('readonly', (store) => store.getAll() as IDBRequest<OutboxEntry[]>)
    return all.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
  } catch {
    return []
  }
}

export async function remove(seq: number): Promise<void> {
  if (!available()) return
  await tx('readwrite', (store) => store.delete(seq) as unknown as IDBRequest<undefined>).catch(
    () => undefined,
  )
}

export async function bumpAttempts(entry: OutboxEntry): Promise<void> {
  if (!available() || entry.seq === undefined) return
  await tx('readwrite', (store) =>
    store.put({ ...entry, attempts: entry.attempts + 1 }) as IDBRequest<IDBValidKey>,
  ).catch(() => undefined)
}

export async function count(): Promise<number> {
  if (!available()) return 0
  try {
    return await tx<number>('readonly', (store) => store.count() as IDBRequest<number>)
  } catch {
    return 0
  }
}

export async function clear(): Promise<void> {
  if (!available()) return
  await tx('readwrite', (store) => store.clear() as unknown as IDBRequest<undefined>).catch(
    () => undefined,
  )
}
