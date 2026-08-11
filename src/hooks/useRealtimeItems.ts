import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { qk } from '@/lib/queryClient'
import { removeItemFromCache, upsertItemInCache } from '@/hooks/useItems'
import { clearPendingLocalWrites, hasPendingLocalWrite, isNewer } from '@/lib/itemSync'
import type { Item } from '@/types/database'

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline'

const MAX_BACKOFF_MS = 30_000
const BASE_BACKOFF_MS = 1_000

function isItem(value: unknown): value is Item {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.id === 'string' && typeof v.list_id === 'string' && typeof v.name === 'string'
}

/**
 * Live updates for one list.
 *
 * Design notes, each of which is load-bearing:
 *
 *  - Events patch the TanStack cache directly. Refetching the whole list on
 *    every event would turn a housemate ticking off ten things into ten round
 *    trips and ten re-renders.
 *  - Rows with a local write in flight are skipped. The server is echoing a
 *    state we have already moved past, and applying it visibly reverts the tap
 *    that was just made.
 *  - An UPDATE older than what we hold is dropped. Reconnect can deliver
 *    payloads out of order, and a stale one must not clobber a newer value.
 *  - On tab-visible we reconcile against the server. iOS suspends WebSockets
 *    when the app backgrounds and silently drops everything that happened
 *    meanwhile — without this, someone who backgrounds the app in the car park
 *    and reopens it in the shop is looking at a stale list.
 */
export function useRealtimeItems(listId: string | undefined) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const channelRef = useRef<RealtimeChannel | null>(null)
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

    function handleChange(payload: RealtimePostgresChangesPayload<Item>) {
      if (!listId) return

      if (payload.eventType === 'DELETE') {
        // Only arrives with a full row because items has REPLICA IDENTITY FULL.
        const old = payload.old
        if (!isItem(old)) return
        if (hasPendingLocalWrite(old.id)) return
        removeItemFromCache(queryClient, listId, old.id)
        return
      }

      const row = payload.new
      if (!isItem(row)) return
      if (row.list_id !== listId) return
      if (hasPendingLocalWrite(row.id)) return

      if (payload.eventType === 'UPDATE') {
        const current = queryClient.getQueryData<Item[]>(qk.items(listId)) ?? []
        const existing = current.find((i) => i.id === row.id)
        if (existing && !isNewer(row, existing)) return
      }

      upsertItemInCache(queryClient, listId, row)
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
          { event: '*', schema: 'public', table: 'items', filter: `list_id=eq.${listId}` },
          handleChange,
        )
        .subscribe((channelStatus) => {
          if (disposed) return
          switch (channelStatus) {
            case 'SUBSCRIBED': {
              attempts.current = 0
              setStatus('connected')
              // Catch up on anything missed while the socket was down.
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

      channelRef.current = channel
    }

    subscribeRef.current = subscribe
    subscribe()

    function onVisibilityChange() {
      if (document.visibilityState !== 'visible') return
      reconcile()
      // The socket is usually dead after an iOS suspend but does not always
      // say so. Rebuild it rather than trusting the reported state.
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
