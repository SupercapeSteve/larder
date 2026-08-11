import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { qk } from '@/lib/queryClient'
import { rpcErrorMessage } from '@/lib/authErrors'
import { useUser } from '@/hooks/useAuth'
import { categorise } from '@/lib/categories'
import { parseItemInput } from '@/lib/parseItem'
import { beginLocalWrite, endLocalWrite, newId } from '@/lib/itemSync'
import type { Item } from '@/types/database'

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

function nextSortOrder(client: QueryClient, listId: string): number {
  const items = client.getQueryData<Item[]>(qk.items(listId)) ?? []
  // Monotonic and collision-free across devices without a round trip.
  return Math.max(Date.now(), ...items.map((i) => i.sort_order + 1))
}

/* ── Mutations. Every one of these is optimistic. ─────────────────────────── */

export type NewItemDraft = {
  name: string
  quantity?: string | null
  category?: string | null
  note?: string | null
}

export function useAddItem(listId: string) {
  const client = useQueryClient()
  const user = useUser()

  return useMutation({
    mutationFn: async (draft: NewItemDraft & { id: string; sort_order: number }): Promise<Item> => {
      const { data, error } = await supabase
        .from('items')
        .insert({
          id: draft.id,
          list_id: listId,
          name: draft.name,
          quantity: draft.quantity ?? null,
          category: draft.category ?? null,
          note: draft.note ?? null,
          source: 'app',
          sort_order: draft.sort_order,
        })
        .select(ITEM_COLUMNS)
        .single()
      if (error) throw new Error(rpcErrorMessage(error))
      return data
    },
    onMutate: async (draft) => {
      beginLocalWrite(draft.id)
      await client.cancelQueries({ queryKey: qk.items(listId) })
      const previous = client.getQueryData<Item[]>(qk.items(listId))

      const now = new Date().toISOString()
      const optimistic: Item = {
        id: draft.id,
        list_id: listId,
        name: draft.name,
        quantity: draft.quantity ?? null,
        category: draft.category ?? null,
        note: draft.note ?? null,
        checked: false,
        added_by: user?.id ?? null,
        checked_by: null,
        checked_at: null,
        source: 'app',
        sort_order: draft.sort_order,
        created_at: now,
        updated_at: now,
      }
      upsertItemInCache(client, listId, optimistic)
      return { previous }
    },
    onError: (_error, _draft, context) => {
      if (context?.previous) client.setQueryData(qk.items(listId), context.previous)
    },
    onSuccess: (item) => {
      upsertItemInCache(client, listId, item)
    },
    onSettled: (_item, _error, draft) => {
      endLocalWrite(draft.id)
    },
  })
}

/** Turns what the user typed into a draft, ready for `useAddItem`. */
export function draftFromInput(client: QueryClient, listId: string, raw: string): (NewItemDraft & { id: string; sort_order: number }) | null {
  const parsed = parseItemInput(raw)
  if (parsed.name.length === 0) return null
  return {
    id: newId(),
    name: parsed.name.slice(0, 200),
    quantity: parsed.quantity,
    category: categorise(parsed.name),
    note: null,
    sort_order: nextSortOrder(client, listId),
  }
}

export function useToggleItem(listId: string) {
  const client = useQueryClient()
  const user = useUser()

  return useMutation({
    mutationFn: async ({ item, checked }: { item: Item; checked: boolean }): Promise<Item> => {
      const { data, error } = await supabase
        .from('items')
        .update({ checked })
        .eq('id', item.id)
        .select(ITEM_COLUMNS)
        .single()
      if (error) throw new Error(rpcErrorMessage(error))
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

  return useMutation({
    mutationFn: async ({ item, edits }: { item: Item; edits: ItemEdits }): Promise<Item> => {
      const { data, error } = await supabase
        .from('items')
        .update({
          name: edits.name,
          quantity: edits.quantity,
          category: edits.category,
          note: edits.note,
        })
        .eq('id', item.id)
        .select(ITEM_COLUMNS)
        .single()
      if (error) throw new Error(rpcErrorMessage(error))
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

  return useMutation({
    mutationFn: async (item: Item): Promise<void> => {
      const { error } = await supabase.from('items').delete().eq('id', item.id)
      if (error) throw new Error(rpcErrorMessage(error))
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

  return useMutation({
    mutationFn: async (items: Item[]): Promise<Item[]> => {
      const { data, error } = await supabase
        .from('items')
        .insert(
          items.map((item) => ({
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
          })),
        )
        .select(ITEM_COLUMNS)
      if (error) throw new Error(rpcErrorMessage(error))
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

  return useMutation({
    mutationFn: async (items: Item[]): Promise<void> => {
      if (items.length === 0) return
      const { error } = await supabase
        .from('items')
        .delete()
        .in(
          'id',
          items.map((i) => i.id),
        )
      if (error) throw new Error(rpcErrorMessage(error))
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
