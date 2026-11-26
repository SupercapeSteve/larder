import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { qk } from '@/lib/queryClient'
import { removeItemFromCache, upsertItemInCache } from '@/hooks/useItems'
import {
  linkKey,
  removeSublistFromCache,
  removeSublistLinkFromCache,
  upsertSublistInCache,
  upsertSublistLinkInCache,
} from '@/hooks/useSublists'
import { clearPendingLocalWrites, hasPendingLocalWrite, isNewer } from '@/lib/itemSync'
import type { Item, Sublist, SublistItem } from '@/types/database'

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline'

const MAX_BACKOFF_MS = 30_000
const BASE_BACKOFF_MS = 1_000

function isItem(value: unknown): value is Item {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.id === 'string' && typeof v.list_id === 'string' && typeof v.name === 'string'
}

function isSublist(value: unknown): value is Sublist {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.id === 'string' && typeof v.list_id === 'string' && typeof v.name === 'string'
}

function isSublistLink(value: unknown): value is SublistItem {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.sublist_id === 'string' &&
    typeof v.item_id === 'string' &&
    typeof v.list_id === 'string'
  )
}

/**
 * All a DELETE payload gives us on single-PK tables (`items`, `sublists`).
 *
 * Supabase strips the old record down to the primary key whenever RLS is
 * enabled on the table — deliberately, because DELETE events are broadcast
 * without a per-row RLS check and a full row would leak data. `replica
 * identity full` does not change this; RLS wins. So a delete arrives as
 * `{ id }` and nothing else. On `sublist_items`, the composite primary key IS
 * `(sublist_id, item_id)`, so both halves arrive intact.
 */
function hasId(value: unknown): value is { id: string } {
  if (typeof value !== 'object' || value === null) return false
  return typeof (value as Record<string, unknown>).id === 'string'
}

function hasLinkPk(value: unknown): value is { sublist_id: string; item_id: string } {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.sublist_id === 'string' && typeof v.item_id === 'string'
}

/**
 * Live updates for one list (items, sub-lists, and sub-list links).
 *
 * Design notes, each of which is load-bearing:
 *
 *  - Events patch the TanStack cache directly. Refetching the whole list on
 *    every event would turn a housemate ticking off ten things into ten round
 *    trips and ten re-renders.
 *  - `sublists` / `sublist_items` subscribe on a separate channel from `items`.
 *    During a rolling deploy (if the frontend ever lands a beat before the SQL
 *    migration), an unmigrated table error on `sublists` cannot degrade or
 *    disconnect the core `items` stream.
 *  - Rows with a local write in flight are skipped. The server is echoing a
 *    state we have already moved past, and applying it visibly reverts the tap
 *    that was just made.
 *  - An UPDATE older than what we hold is dropped. Reconnect can deliver
 *    payloads out of order, and a stale one must not clobber a newer value.
 *  - DELETE is subscribed to separately and without a filter. With RLS on,
 *    Supabase strips a delete's old record to its primary key, so `list_id` is
 *    not there to filter on and a filtered subscription silently never fires.
 *  - On tab-visible we reconcile against the server. iOS suspends WebSockets
 *    when the app backgrounds and silently drops everything that happened
 *    meanwhile — without this, someone who backgrounds the app in the car park
 *    and reopens it in the shop is looking at a stale list.
 */
export function useRealtimeItems(listId: string | undefined) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const channelRef = useRef<RealtimeChannel | null>(null)
  const sublistsChannelRef = useRef<RealtimeChannel | null>(null)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attempts = useRef(0)
  const subscribeRef = useRef<(() => void) | null>(null)

  const reconcile = useCallback(() => {
    if (!listId) return
    // Anything still marked pending across a suspend is unresolvable — the
    // mutation's settle handler may never have run. Clear it so the refetch
    // is not filtered out by a stale guard.
    clearPendingLocalWrites()
    void queryClient.invalidateQueries({ queryKey: qk.items(listId) })
    void queryClient.invalidateQueries({ queryKey: qk.sublists(listId) })
    void queryClient.invalidateQueries({ queryKey: qk.sublistLinks(listId) })
  }, [listId, queryClient])

  useEffect(() => {
    if (!listId) return

    let disposed = false

    function clearRetry() {
      if (retryTimer.current !== null) {
        clearTimeout(retryTimer.current)
        retryTimer.current = null
      }
    }

    function teardown() {
      clearRetry()
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
      if (sublistsChannelRef.current) {
        void supabase.removeChannel(sublistsChannelRef.current)
        sublistsChannelRef.current = null
      }
    }

    function scheduleRetry() {
      if (disposed) return
      clearRetry()
      const delay = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempts.current)
      // Jitter so two phones in the same kitchen do not retry in lockstep.
      const jittered = delay * (0.7 + Math.random() * 0.6)
      attempts.current += 1
      retryTimer.current = setTimeout(() => {
        if (disposed) return
        subscribeRef.current?.()
      }, jittered)
    }

    function handleItemDelete(payload: RealtimePostgresChangesPayload<Item>) {
      if (!listId) return
      const old = payload.old
      if (!hasId(old)) return
      if (hasPendingLocalWrite(old.id)) return

      removeItemFromCache(queryClient, listId, old.id)
      queryClient.setQueryData<SublistItem[]>(qk.sublistLinks(listId), (prev) =>
        (prev ?? []).filter((l) => l.item_id !== old.id),
      )
    }

    function handleItemUpsert(payload: RealtimePostgresChangesPayload<Item>) {
      if (!listId) return
      const row = payload.new
      if (!isItem(row)) return
      if (row.list_id !== listId) return
      if (hasPendingLocalWrite(row.id)) return

      const current = queryClient.getQueryData<Item[]>(qk.items(listId)) ?? []
      const existing = current.find((i) => i.id === row.id)
      if (existing && !isNewer(row, existing)) return

      upsertItemInCache(queryClient, listId, row)
    }

    function handleSublistUpsert(payload: RealtimePostgresChangesPayload<Sublist>) {
      if (!listId) return
      const row = payload.new
      if (!isSublist(row) || row.list_id !== listId) return
      if (hasPendingLocalWrite(row.id)) return

      const current = queryClient.getQueryData<Sublist[]>(qk.sublists(listId)) ?? []
      const existing = current.find((s) => s.id === row.id)
      if (existing && !isNewer(row, existing)) return

      upsertSublistInCache(queryClient, listId, row)
    }

    function handleSublistDelete(payload: RealtimePostgresChangesPayload<Sublist>) {
      if (!listId) return
      const old = payload.old
      if (!hasId(old) || hasPendingLocalWrite(old.id)) return
      removeSublistFromCache(queryClient, listId, old.id)
    }

    function handleLinkInsert(payload: RealtimePostgresChangesPayload<SublistItem>) {
      if (!listId) return
      const row = payload.new
      if (!isSublistLink(row) || row.list_id !== listId) return
      if (hasPendingLocalWrite(linkKey(row.sublist_id, row.item_id))) return
      upsertSublistLinkInCache(queryClient, listId, row)
    }

    function handleLinkDelete(payload: RealtimePostgresChangesPayload<SublistItem>) {
      if (!listId) return
      const old = payload.old
      if (!hasLinkPk(old)) return
      if (hasPendingLocalWrite(linkKey(old.sublist_id, old.item_id))) return
      removeSublistLinkFromCache(queryClient, listId, old.sublist_id, old.item_id)
    }

    function subscribe() {
      if (disposed) return
      teardown()

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setStatus('offline')
        return
      }

      setStatus(attempts.current === 0 ? 'connecting' : 'reconnecting')

      const channel = supabase
        .channel(`items:${listId}`, { config: { private: false } })
        .on<Item>(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'items', filter: `list_id=eq.${listId}` },
          handleItemUpsert,
        )
        .on<Item>(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'items', filter: `list_id=eq.${listId}` },
          handleItemUpsert,
        )
        .on<Item>(
          'postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'items' },
          handleItemDelete,
        )
        .subscribe((channelStatus) => {
          if (disposed) return
          switch (channelStatus) {
            case 'SUBSCRIBED': {
              attempts.current = 0
              setStatus('connected')
              reconcile()
              break
            }
            case 'CHANNEL_ERROR':
            case 'TIMED_OUT': {
              setStatus('reconnecting')
              scheduleRetry()
              break
            }
            case 'CLOSED':
            default:
              break
          }
        })

      const sublistsChannel = supabase
        .channel(`sublists:${listId}`, { config: { private: false } })
        .on<Sublist>(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'sublists', filter: `list_id=eq.${listId}` },
          handleSublistUpsert,
        )
        .on<Sublist>(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'sublists', filter: `list_id=eq.${listId}` },
          handleSublistUpsert,
        )
        .on<Sublist>(
          'postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'sublists' },
          handleSublistDelete,
        )
        .on<SublistItem>(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'sublist_items',
            filter: `list_id=eq.${listId}`,
          },
          handleLinkInsert,
        )
        .on<SublistItem>(
          'postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'sublist_items' },
          handleLinkDelete,
        )
        .subscribe()

      channelRef.current = channel
      sublistsChannelRef.current = sublistsChannel
    }

    subscribeRef.current = subscribe
    subscribe()

    function onVisibilityChange() {
      if (document.visibilityState !== 'visible') return
      reconcile()
      attempts.current = 0
      subscribe()
    }

    function onOnline() {
      attempts.current = 0
      subscribe()
    }

    function onOffline() {
      setStatus('offline')
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    return () => {
      disposed = true
      subscribeRef.current = null
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      teardown()
    }
  }, [listId, queryClient, reconcile])

  return { status, reconcile }
}
