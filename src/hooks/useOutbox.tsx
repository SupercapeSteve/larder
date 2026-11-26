import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { qk } from '@/lib/queryClient'
import { bumpAttempts, count, enqueue, peekAll, remove, type OutboxOp } from '@/lib/outbox'

/** Give up on an entry the server keeps refusing, so one bad row cannot wedge the queue. */
const MAX_ATTEMPTS = 5

type OutboxContextValue = {
  /** How many writes are waiting to reach the server. */
  pending: number
  /** Queue a write for replay. Returns once it is durably stored. */
  queue: (op: OutboxOp) => Promise<void>
  /** Try to send everything now. */
  flush: () => Promise<void>
}

const OutboxContext = createContext<OutboxContextValue | null>(null)

async function send(op: OutboxOp): Promise<{ ok: true } | { ok: false; fatal: boolean }> {
  if (op.kind === 'insert') {
    const { error } =
      op.table === 'items'
        ? await supabase.from('items').insert(op.payload)
        : op.table === 'sublists'
          ? await supabase.from('sublists').insert(op.payload)
          : await supabase.from('sublist_items').insert(op.payload)
    // 23505 = the row already landed on an earlier attempt. Treat as success:
    // ids are client-generated, so a duplicate means the write got through.
    if (!error || error.code === '23505') return { ok: true }
    return { ok: false, fatal: isFatal(error.code) }
  }

  if (op.kind === 'update') {
    const { error } =
      op.table === 'items'
        ? await supabase.from('items').update(op.payload).eq('id', op.id)
        : await supabase.from('sublists').update(op.payload).eq('id', op.id)
    if (!error) return { ok: true }
    return { ok: false, fatal: isFatal(error.code) }
  }

  if (op.kind === 'delete-many') {
    if (op.ids.length === 0) return { ok: true }
    const { error } = await supabase.from('items').delete().in('id', op.ids)
    if (!error) return { ok: true }
    return { ok: false, fatal: isFatal(error.code) }
  }

  if (op.kind === 'delete-link') {
    const { error } = await supabase
      .from('sublist_items')
      .delete()
      .eq('sublist_id', op.sublist_id)
      .eq('item_id', op.item_id)
    if (!error) return { ok: true }
    return { ok: false, fatal: isFatal(error.code) }
  }

  const { error } =
    op.table === 'items'
      ? await supabase.from('items').delete().eq('id', op.id)
      : await supabase.from('sublists').delete().eq('id', op.id)
  if (!error) return { ok: true }
  return { ok: false, fatal: isFatal(error.code) }
}

/**
 * A permission, missing-table or constraint failure will never succeed on retry
 * — dropping it is correct. A network blip will, so it stays queued.
 */
function isFatal(code: string | undefined): boolean {
  if (!code) return false
  return (
    code === '42501' ||
    code === '42P01' ||
    code === '23514' ||
    code === '23503' ||
    code.startsWith('PGRST')
  )
}

export function OutboxProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [pending, setPending] = useState(0)
  const draining = useRef(false)

  const refreshCount = useCallback(async () => {
    setPending(await count())
  }, [])

  const flush = useCallback(async () => {
    if (draining.current) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return

    draining.current = true
    let sentAny = false
    try {
      const entries = await peekAll()
      for (const entry of entries) {
        if (entry.seq === undefined) continue

        const result = await send(entry.op)
        if (result.ok) {
          sentAny = true
          await remove(entry.seq)
          continue
        }
        if (result.fatal || entry.attempts + 1 >= MAX_ATTEMPTS) {
          console.warn('[larder] dropping an unsendable queued write', entry.op)
          await remove(entry.seq)
          continue
        }

        // Still offline or a transient failure. Stop here rather than
        // continuing — replaying out of order would apply an update before the
        // insert it depends on.
        await bumpAttempts(entry)
        break
      }
    } finally {
      draining.current = false
      await refreshCount()
      // Only invalidate when something actually replayed; avoids needless
      // refetches on the 30-second heartbeat when the outbox is empty.
      if (sentAny) {
        void queryClient.invalidateQueries({ queryKey: ['items'] })
        void queryClient.invalidateQueries({ queryKey: ['sublists'] })
        void queryClient.invalidateQueries({ queryKey: ['sublist-items'] })
      }
    }
  }, [queryClient, refreshCount])

  const queue = useCallback(
    async (op: OutboxOp) => {
      await enqueue(op)
      await refreshCount()
      void flush()
    },
    [flush, refreshCount],
  )

  useEffect(() => {
    void refreshCount()
    void flush()

    function onOnline() {
      void flush()
    }
    function onVisible() {
      if (document.visibilityState === 'visible') void flush()
    }

    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    // A periodic nudge covers the case where the browser never fires `online`
    // — common on iOS when a captive portal or weak signal comes and goes.
    const timer = setInterval(() => void flush(), 30_000)

    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(timer)
    }
  }, [flush, refreshCount])

  const value = useMemo(() => ({ pending, queue, flush }), [pending, queue, flush])
  return <OutboxContext.Provider value={value}>{children}</OutboxContext.Provider>
}

export function useOutbox(): OutboxContextValue {
  const ctx = useContext(OutboxContext)
  if (!ctx) throw new Error('useOutbox must be used inside <OutboxProvider>')
  return ctx
}

export { qk }
