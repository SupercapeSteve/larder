import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { functionsBaseUrl } from '@/lib/env'
import { qk } from '@/lib/queryClient'
import { rpcErrorMessage } from '@/lib/authErrors'
import { useUser } from '@/hooks/useAuth'
import { categorise, type CategoryRule } from '@/lib/categories'
import { parseItemInput } from '@/lib/parseItem'
import { beginLocalWrite, endLocalWrite, newId } from '@/lib/itemSync'
import { isMissingTableError, readLocalSublistLinks, writeLocalSublistLinks } from '@/lib/sublists'
import { useOutbox } from '@/hooks/useOutbox'
import type { Item, SublistItem } from '@/types/database'

const VAPID_CONFIGURED = Boolean(import.meta.env.VITE_VAPID_PUBLIC_KEY)

/**
 * Was this a connectivity failure rather than a refusal?
 *
 * A rejected write (permission, constraint) must still roll back and tell the
 * user. A write that never reached the server should be queued instead — that
 * is the difference between "the server said no" and "you are in a chest
 * freezer aisle with no signal".
 */
export function isConnectivityError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  const message = (
    error instanceof Error ? error.message : String((error as { message?: string })?.message ?? '')
  ).toLowerCase()
  return (
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network request failed') ||
    message.includes('load failed')
  )
}

/**
 * Best-effort push nudge to housemates who opted into notifications.
 * Never blocks a mutation, and skips the network round-trip entirely when VAPID
 * is not configured on this deployment.
 */
function notifyHouseholdAdd(listId: string, itemName: string): void {
  if (!VAPID_CONFIGURED || !listId) return
  void supabase.auth
    .getSession()
    .then(({ data }) => {
      const token = data.session?.access_token
      if (!token) return
      return fetch(`${functionsBaseUrl}/notify`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          list_id: listId,
          title: 'Added to Larder',
          body: itemName.slice(0, 140),
        }),
      })
    })
    .catch(() => undefined)
}

const ITEM_COLUMNS =
  'id, list_id, name, quantity, category, note, checked, added_by, checked_by, checked_at, source, sort_order, created_at, updated_at'

export function sortItems(items: readonly Item[]): Item[] {
  return [...items].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
    return Date.parse(a.created_at) - Date.parse(b.created_at)
  })
}

export function useItems(listId: string | undefined) {
  return useQuery({
    queryKey: qk.items(listId ?? 'none'),
    enabled: Boolean(listId),
    queryFn: async (): Promise<Item[]> => {
      if (!listId) return []
      const { data, error } = await supabase
        .from('items')
        .select(ITEM_COLUMNS)
        .eq('list_id', listId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })
      if (error) throw error
      return data ?? []
    },
  })
}

/* ── Cache helpers, shared with the realtime subscription ─────────────────── */

export function upsertItemInCache(client: QueryClient, listId: string, item: Item): void {
  client.setQueryData<Item[]>(qk.items(listId), (old) => {
    const existing = old ?? []
    const index = existing.findIndex((i) => i.id === item.id)
    if (index === -1) return sortItems([...existing, item])
    const next = [...existing]
    next[index] = item
    return sortItems(next)
  })
}

export function removeItemFromCache(client: QueryClient, listId: string, itemId: string): void {
  client.setQueryData<Item[]>(qk.items(listId), (old) => (old ?? []).filter((i) => i.id !== itemId))
}

export function nextSortOrder(client: QueryClient, listId: string): number {
  const items = client.getQueryData<Item[]>(qk.items(listId)) ?? []
  // Monotonic and collision-free across devices without a round trip.
  return Math.max(Date.now(), ...items.map((i) => i.sort_order + 1))
}

/* ── Mutations. Every one of these is optimistic and offline-capable. ─────── */

/** The row as it will exist once a queued insert reaches the server. */
function optimisticItem(
  draft: NewItemDraft & { id: string; sort_order: number },
  listId: string,
  userId: string | null,
): Item {
  const now = new Date().toISOString()
  return {
    id: draft.id,
    list_id: listId,
    name: draft.name,
    quantity: draft.quantity ?? null,
    category: draft.category ?? null,
    note: draft.note ?? null,
    checked: false,
    added_by: userId,
    checked_by: null,
    checked_at: null,
    source: 'app',
    sort_order: draft.sort_order,
    created_at: now,
    updated_at: now,
  }
}

export type NewItemDraft = {
  name: string
  quantity?: string | null
  category?: string | null
  note?: string | null
  /** Optional sub-list to attach the item to AFTER the item row commits. */
  sublistId?: string | null
}

export function useAddItem(listId: string) {
  const client = useQueryClient()
  const user = useUser()
  const { queue } = useOutbox()

  return useMutation({
    mutationFn: async (draft: NewItemDraft & { id: string; sort_order: number }): Promise<Item> => {
      const row = {
        id: draft.id,
        list_id: listId,
        name: draft.name,
        quantity: draft.quantity ?? null,
        category: draft.category ?? null,
        note: draft.note ?? null,
        source: 'app',
        sort_order: draft.sort_order,
      }
      const linkRow = draft.sublistId
        ? { sublist_id: draft.sublistId, item_id: draft.id, list_id: listId }
        : null

      // The id is generated on the client, so a queued insert is idempotent:
      // replaying one that already landed is a duplicate-key no-op. Queue the
      // item BEFORE its sub-list link so FIFO replay satisfies foreign keys.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        await queue({ kind: 'insert', table: 'items', payload: row })
        if (linkRow) await queue({ kind: 'insert', table: 'sublist_items', payload: linkRow })
        return optimisticItem(draft, listId, user?.id ?? null)
      }

      const { data, error } = await supabase.from('items').insert(row).select(ITEM_COLUMNS).single()
      if (error) {
        if (isConnectivityError(error)) {
          await queue({ kind: 'insert', table: 'items', payload: row })
          if (linkRow) await queue({ kind: 'insert', table: 'sublist_items', payload: linkRow })
          return optimisticItem(draft, listId, user?.id ?? null)
        }
        throw new Error(rpcErrorMessage(error))
      }

      // Link strictly AFTER the item INSERT commits — firing them in parallel
      // races `enforce_sublist_item_integrity` against an uncommitted item row.
      if (linkRow) {
        const { error: linkError } = await supabase
          .from('sublist_items')
          .upsert(linkRow, { onConflict: 'sublist_id,item_id', ignoreDuplicates: true })
        if (linkError) {
          if (isConnectivityError(linkError)) {
            await queue({ kind: 'insert', table: 'sublist_items', payload: linkRow })
          } else if (isMissingTableError(linkError)) {
            const existing = readLocalSublistLinks(listId)
            writeLocalSublistLinks(listId, [
              ...existing,
              { ...linkRow, created_at: new Date().toISOString() },
            ])
          } else {
            throw new Error(rpcErrorMessage(linkError))
          }
        }
      }

      notifyHouseholdAdd(listId, data.quantity ? `${data.quantity} ${data.name}` : data.name)
      return data
    },
    onMutate: async (draft) => {
      beginLocalWrite(draft.id)
      const linkGuard = draft.sublistId ? `link:${draft.sublistId}:${draft.id}` : null
      if (linkGuard) beginLocalWrite(linkGuard)

      await client.cancelQueries({ queryKey: qk.items(listId) })
      const previous = client.getQueryData<Item[]>(qk.items(listId))
      const previousLinks = draft.sublistId
        ? client.getQueryData<SublistItem[]>(qk.sublistLinks(listId))
        : undefined

      const optimistic = optimisticItem(draft, listId, user?.id ?? null)
      upsertItemInCache(client, listId, optimistic)

      if (draft.sublistId) {
        const sid = draft.sublistId
        client.setQueryData<SublistItem[]>(qk.sublistLinks(listId), (old) => {
          const existing = old ?? []
          if (existing.some((l) => l.sublist_id === sid && l.item_id === draft.id)) return existing
          return [
            ...existing,
            {
              sublist_id: sid,
              item_id: draft.id,
              list_id: listId,
              created_at: optimistic.created_at,
            },
          ]
        })
      }

      return { previous, previousLinks }
    },
    onError: (_error, draft, context) => {
      if (context?.previous) client.setQueryData(qk.items(listId), context.previous)
      if (draft.sublistId && context?.previousLinks) {
        client.setQueryData(qk.sublistLinks(listId), context.previousLinks)
      }
    },
    onSuccess: (item) => {
      upsertItemInCache(client, listId, item)
    },
    onSettled: (_item, _error, draft) => {
      endLocalWrite(draft.id)
      if (draft.sublistId) endLocalWrite(`link:${draft.sublistId}:${draft.id}`)
    },
  })
}

/**
 * Turns what the user typed into a draft, ready for `useAddItem`.
 * `rules` are the household's learned corrections; they outrank the built-in
 * keyword map, which is the whole point of having them.
 */
export function draftFromInput(
  client: QueryClient,
  listId: string,
  raw: string,
  rules: readonly CategoryRule[] = [],
  sortFloor?: number,
): (NewItemDraft & { id: string; sort_order: number }) | null {
  const parsed = parseItemInput(raw)
  if (parsed.name.length === 0) return null
  const next = nextSortOrder(client, listId)
  return {
    id: newId(),
    name: parsed.name.slice(0, 200),
    quantity: parsed.quantity,
    category: categorise(parsed.name, rules),
    note: null,
    sort_order: sortFloor !== undefined ? Math.max(next, sortFloor) : next,
  }
}

export function useToggleItem(listId: string) {
  const client = useQueryClient()
  const user = useUser()
  const { queue } = useOutbox()

  return useMutation({
    mutationFn: async ({ item, checked }: { item: Item; checked: boolean }): Promise<Item> => {
      const locally = (): Item => ({
        ...item,
        checked,
        checked_at: checked ? new Date().toISOString() : null,
        checked_by: checked ? (user?.id ?? null) : null,
        updated_at: new Date().toISOString(),
      })

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        await queue({ kind: 'update', table: 'items', id: item.id, payload: { checked } })
        return locally()
      }

      const { data, error } = await supabase
        .from('items')
        .update({ checked })
        .eq('id', item.id)
        .select(ITEM_COLUMNS)
        .single()
      if (error) {
        if (isConnectivityError(error)) {
          await queue({ kind: 'update', table: 'items', id: item.id, payload: { checked } })
          return locally()
        }
        throw new Error(rpcErrorMessage(error))
      }
      return data
    },
    onMutate: async ({ item, checked }) => {
      beginLocalWrite(item.id)
      await client.cancelQueries({ queryKey: qk.items(listId) })
      const previous = client.getQueryData<Item[]>(qk.items(listId))

      upsertItemInCache(client, listId, {
        ...item,
        checked,
        checked_at: checked ? new Date().toISOString() : null,
        checked_by: checked ? (user?.id ?? null) : null,
        updated_at: new Date().toISOString(),
      })
      return { previous }
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) client.setQueryData(qk.items(listId), context.previous)
    },
    onSuccess: (item) => upsertItemInCache(client, listId, item),
    onSettled: (_data, _error, vars) => endLocalWrite(vars.item.id),
  })
}

export type ItemEdits = {
  name: string
  quantity: string | null
  category: string | null
  note: string | null
}

export function useUpdateItem(listId: string) {
  const client = useQueryClient()
  const { queue } = useOutbox()

  return useMutation({
    mutationFn: async ({ item, edits }: { item: Item; edits: ItemEdits }): Promise<Item> => {
      const patch = {
        name: edits.name,
        quantity: edits.quantity,
        category: edits.category,
        note: edits.note,
      }
      const locally = (): Item => ({
        ...item,
        ...patch,
        updated_at: new Date().toISOString(),
      })

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        await queue({ kind: 'update', table: 'items', id: item.id, payload: patch })
        return locally()
      }

      const { data, error } = await supabase
        .from('items')
        .update(patch)
        .eq('id', item.id)
        .select(ITEM_COLUMNS)
        .single()
      if (error) {
        if (isConnectivityError(error)) {
          await queue({ kind: 'update', table: 'items', id: item.id, payload: patch })
          return locally()
        }
        throw new Error(rpcErrorMessage(error))
      }
      return data
    },
    onMutate: async ({ item, edits }) => {
      beginLocalWrite(item.id)
      await client.cancelQueries({ queryKey: qk.items(listId) })
      const previous = client.getQueryData<Item[]>(qk.items(listId))
      upsertItemInCache(client, listId, { ...item, ...edits, updated_at: new Date().toISOString() })
      return { previous }
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) client.setQueryData(qk.items(listId), context.previous)
    },
    onSuccess: (item) => upsertItemInCache(client, listId, item),
    onSettled: (_data, _error, vars) => endLocalWrite(vars.item.id),
  })
}

export function useDeleteItem(listId: string) {
  const client = useQueryClient()
  const { queue } = useOutbox()

  return useMutation({
    mutationFn: async (item: Item): Promise<void> => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        await queue({ kind: 'delete', table: 'items', id: item.id })
        return
      }
      const { error } = await supabase.from('items').delete().eq('id', item.id)
      if (error) {
        if (isConnectivityError(error)) {
          await queue({ kind: 'delete', table: 'items', id: item.id })
          return
        }
        throw new Error(rpcErrorMessage(error))
      }
    },
    onMutate: async (item) => {
      beginLocalWrite(item.id)
      await client.cancelQueries({ queryKey: qk.items(listId) })
      const previous = client.getQueryData<Item[]>(qk.items(listId))
      removeItemFromCache(client, listId, item.id)
      return { previous }
    },
    onError: (_error, _item, context) => {
      if (context?.previous) client.setQueryData(qk.items(listId), context.previous)
    },
    onSettled: (_data, _error, item) => endLocalWrite(item.id),
  })
}

/**
 * Undo for a delete. Re-inserts with the original id, so the row comes back as
 * the same item rather than a new one — position, note and quantity intact.
 *
 * Attribution is the one thing that does not survive: the database decides
 * `added_by` and `checked_by` from the JWT and ignores whatever the client
 * sends, because trusting those columns is exactly how one household member
 * forges a check-off in another's name. So undoing a delete of somebody else's
 * item re-attributes it to whoever pressed Undo. That is the correct trade —
 * an occasional wrong initial beats a forgeable audit trail.
 */
export function useRestoreItems(listId: string) {
  const client = useQueryClient()
  const { queue } = useOutbox()

  return useMutation({
    mutationFn: async (items: Item[]): Promise<Item[]> => {
      const rows = items.map((item) => ({
        id: item.id,
        list_id: item.list_id,
        name: item.name,
        quantity: item.quantity,
        category: item.category,
        note: item.note,
        checked: item.checked,
        checked_by: item.checked_by,
        checked_at: item.checked_at,
        source: item.source,
        sort_order: item.sort_order,
      }))

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        for (const row of rows) {
          await queue({ kind: 'insert', table: 'items', payload: row })
        }
        return items
      }

      const { data, error } = await supabase.from('items').insert(rows).select(ITEM_COLUMNS)
      if (error) {
        if (isConnectivityError(error)) {
          for (const row of rows) {
            await queue({ kind: 'insert', table: 'items', payload: row })
          }
          return items
        }
        throw new Error(rpcErrorMessage(error))
      }
      return data ?? []
    },
    onMutate: async (items) => {
      for (const item of items) beginLocalWrite(item.id)
      await client.cancelQueries({ queryKey: qk.items(listId) })
      const previous = client.getQueryData<Item[]>(qk.items(listId))
      for (const item of items) upsertItemInCache(client, listId, item)
      return { previous }
    },
    onError: (_error, _items, context) => {
      if (context?.previous) client.setQueryData(qk.items(listId), context.previous)
    },
    onSuccess: (items) => {
      for (const item of items) upsertItemInCache(client, listId, item)
    },
    onSettled: (_data, _error, items) => {
      for (const item of items) endLocalWrite(item.id)
    },
  })
}

export function useClearChecked(listId: string) {
  const client = useQueryClient()
  const { queue } = useOutbox()

  return useMutation({
    mutationFn: async (items: Item[]): Promise<void> => {
      if (items.length === 0) return
      const ids = items.map((i) => i.id)

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        await queue({ kind: 'delete-many', table: 'items', ids })
        return
      }

      const { error } = await supabase.from('items').delete().in('id', ids)
      if (error) {
        if (isConnectivityError(error)) {
          await queue({ kind: 'delete-many', table: 'items', ids })
          return
        }
        throw new Error(rpcErrorMessage(error))
      }
    },
    onMutate: async (items) => {
      for (const item of items) beginLocalWrite(item.id)
      await client.cancelQueries({ queryKey: qk.items(listId) })
      const previous = client.getQueryData<Item[]>(qk.items(listId))
      for (const item of items) removeItemFromCache(client, listId, item.id)
      return { previous }
    },
    onError: (_error, _items, context) => {
      if (context?.previous) client.setQueryData(qk.items(listId), context.previous)
    },
    onSettled: (_data, _error, items) => {
      for (const item of items) endLocalWrite(item.id)
    },
  })
}
