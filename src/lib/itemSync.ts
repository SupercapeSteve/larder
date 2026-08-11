/**
 * Two small pieces of machinery that keep optimistic updates and realtime from
 * fighting each other.
 */

/**
 * Client-generated ids.
 *
 * The optimistic row and the row the server broadcasts back share an id, so the
 * realtime INSERT echo *replaces* the optimistic row instead of appearing
 * beside it. That is what stops the classic double-render flicker — no
 * "temp-123 → real uuid" reconciliation dance, no window where the item is on
 * screen twice.
 */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Non-secure context (plain-http LAN testing). RFC 4122 v4 shape, seeded
  // from getRandomValues where available.
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Items with a mutation in flight from *this* client.
 *
 * While a write is pending we ignore realtime events for that row: the server
 * is echoing a state we already moved past, and applying it would visibly
 * revert the tap the user just made. The count (rather than a boolean) matters
 * because rapid taps overlap.
 */
const pending = new Map<string, number>()

export function beginLocalWrite(id: string): void {
  pending.set(id, (pending.get(id) ?? 0) + 1)
}

export function endLocalWrite(id: string): void {
  const next = (pending.get(id) ?? 1) - 1
  if (next <= 0) pending.delete(id)
  else pending.set(id, next)
}

export function hasPendingLocalWrite(id: string): boolean {
  return pending.has(id)
}

export function clearPendingLocalWrites(): void {
  pending.clear()
}

/**
 * Last-write-wins, but never backwards.
 *
 * Reconnect and refetch can deliver rows out of order. Comparing updated_at
 * stops an older payload from overwriting a newer one that already landed.
 * Deliberately not a CRDT — for a grocery list, last-write-wins is the right
 * amount of machinery.
 */
export function isNewer(incoming: { updated_at: string }, existing: { updated_at: string }): boolean {
  return Date.parse(incoming.updated_at) >= Date.parse(existing.updated_at)
}
