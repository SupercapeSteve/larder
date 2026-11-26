import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { qk } from '@/lib/queryClient'
import { rpcErrorMessage } from '@/lib/authErrors'
import { useUser } from '@/hooks/useAuth'
import { beginLocalWrite, endLocalWrite, newId } from '@/lib/itemSync'
import {
  isConnectivityError,
  upsertItemInCache,
  type NewItemDraft,
} from '@/hooks/useItems'
import { useOutbox } from '@/hooks/useOutbox'
import {
  isMissingTableError,
  readLocalSublistLinks,
  readLocalSublists,
  writeLocalSublistLinks,
  writeLocalSublists,
} from '@/lib/sublists'
import type { Item, Sublist, SublistItem } from '@/types/database'

const SUBLIST_COLUMNS =
  'id, list_id, name, emoji, note, sort_order, created_by, created_at, updated_at'
const SUBLIST_LINK_COLUMNS = 'sublist_id, item_id, list_id, created_at'
const ITEM_COLUMNS =
  'id, list_id, name, quantity, category, note, checked, added_by, checked_by, checked_at, source, sort_order, created_at, updated_at'

export function linkKey(sublistId: string, itemId: string): string {
  return `link:${sublistId}:${itemId}`
}

export function sortSublists(sublists: readonly Sublist[]): Sublist[] {
  return [...sublists].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
    return Date.parse(a.created_at) - Date.parse(b.created_at)
  })
}

/* ── Queries ──────────────────────────────────────────────────────────────── */

export function useSublists(listId: string | undefined) {
  return useQuery({
    queryKey: qk.sublists(listId ?? 'none'),
    enabled: Boolean(listId),
    queryFn: async (): Promise<Sublist[]> => {
      if (!listId) return []
      const { data, error } = await supabase
        .from('sublists')
        .select(SUBLIST_COLUMNS)
        .eq('list_id', listId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })

      if (error) {
        if (isMissingTableError(error)) return readLocalSublists(listId)
        throw error
      }
      return data ?? []
    },
  })
}

export function useSublistLinks(listId: string | undefined) {
  return useQuery({
    queryKey: qk.sublistLinks(listId ?? 'none'),
    enabled: Boolean(listId),
    queryFn: async (): Promise<SublistItem[]> => {
      if (!listId) return []
      const { data, error } = await supabase
        .from('sublist_items')
        .select(SUBLIST_LINK_COLUMNS)
        .eq('list_id', listId)

      if (error) {
        if (isMissingTableError(error)) return readLocalSublistLinks(listId)
        throw error
      }
      return data ?? []
    },
  })
}

/* ── Cache helpers, shared with the realtime subscription ─────────────────── */

export function upsertSublistInCache(client: QueryClient, listId: string, sublist: Sublist): void {
  client.setQueryData<Sublist[]>(qk.sublists(listId), (old) => {
    const existing = old ?? []
    const index = existing.findIndex((s) => s.id === sublist.id)
    if (index === -1) return sortSublists([...existing, sublist])
    const next = [...existing]
    next[index] = sublist
    return sortSublists(next)
  })
}

export function removeSublistFromCache(client: QueryClient, listId: string, sublistId: string): void {
  client.setQueryData<Sublist[]>(qk.sublists(listId), (old) =>
    (old ?? []).filter((s) => s.id !== sublistId),
  )
  // Mirror ON DELETE CASCADE immediately in cache so badges vanish on the spot.
  client.setQueryData<SublistItem[]>(qk.sublistLinks(listId), (old) =>
    (old ?? []).filter((link) => link.sublist_id !== sublistId),
  )
}

export function upsertSublistLinkInCache(
  client: QueryClient,
  listId: string,
  link: SublistItem,
): void {
  client.setQueryData<SublistItem[]>(qk.sublistLinks(listId), (old) => {
    const existing = old ?? []
    const exists = existing.some(
      (l) => l.sublist_id === link.sublist_id && l.item_id === link.item_id,
    )
    return exists ? existing : [...existing, link]
  })
}

export function removeSublistLinkFromCache(
  client: QueryClient,
  listId: string,
  sublistId: string,
  itemId: string,
): void {
  client.setQueryData<SublistItem[]>(qk.sublistLinks(listId), (old) =>
    (old ?? []).filter((l) => !(l.sublist_id === sublistId && l.item_id === itemId)),
  )
}

function nextSublistSortOrder(client: QueryClient, listId: string): number {
  const current = client.getQueryData<Sublist[]>(qk.sublists(listId)) ?? []
  return Math.max(Date.now(), ...current.map((s) => s.sort_order + 1))
}

/* ── Mutations ────────────────────────────────────────────────────────────── */

export type NewSublistInput = {
  id?: string
  name: string
  emoji?: string | null
  note?: string | null
}

export type CreateSublistVariables = {
  draft: NewSublistInput & { id: string; sort_order: number }
  /** Existing main-list item IDs to include right at creation. */
  itemIds?: string[]
  /** Brand-new ingredient items to create on the main list and link. */
  newItems?: Array<NewItemDraft & { id: string; sort_order: number }>
}

/**
 * Creates a sub-list AND attaches its initial items in one cohesive mutation:
 *  - `onMutate` populates `sublists`, `items`, and `sublist_items` in cache at
 *    0ms, so opening the new sub-list immediately shows every selected item
 *    with no empty-state flash.
 *  - `mutationFn` commits in strict FK order (`sublists` → `items` →
 *    `sublist_items`) so `enforce_sublist_item_integrity` never races an
 *    uncommitted row.
 */
export function useCreateSublist(listId: string) {
  const client = useQueryClient()
  const user = useUser()
  const { queue } = useOutbox()

  return useMutation({
    mutationFn: async ({
      draft,
      itemIds = [],
      newItems = [],
    }: CreateSublistVariables): Promise<{ sublist: Sublist; items: Item[]; links: SublistItem[] }> => {
      const now = new Date().toISOString()
      const localSublist: Sublist = {
        id: draft.id,
        list_id: listId,
        name: draft.name,
        emoji: draft.emoji ?? null,
        note: draft.note ?? null,
        sort_order: draft.sort_order,
        created_by: user?.id ?? null,
        created_at: now,
        updated_at: now,
      }

      const sublistInsert = {
        id: draft.id,
        list_id: listId,
        name: draft.name,
        emoji: draft.emoji ?? null,
        note: draft.note ?? null,
        sort_order: draft.sort_order,
      }

      const itemInserts = newItems.map((d) => ({
        id: d.id,
        list_id: listId,
        name: d.name,
        quantity: d.quantity ?? null,
        category: d.category ?? null,
        note: d.note ?? null,
        source: 'app' as const,
        sort_order: d.sort_order,
      }))

      const localItems: Item[] = newItems.map((d) => ({
        id: d.id,
        list_id: listId,
        name: d.name,
        quantity: d.quantity ?? null,
        category: d.category ?? null,
        note: d.note ?? null,
        checked: false,
        added_by: user?.id ?? null,
        checked_by: null,
        checked_at: null,
        source: 'app',
        sort_order: d.sort_order,
        created_at: now,
        updated_at: now,
      }))

      const allLinkIds = [...new Set([...itemIds, ...newItems.map((d) => d.id)])]
      const linkInserts = allLinkIds.map((itemId) => ({
        sublist_id: draft.id,
        item_id: itemId,
        list_id: listId,
      }))
      const localLinks: SublistItem[] = linkInserts.map((r) => ({ ...r, created_at: now }))

      const queueAllOffline = async () => {
        await queue({ kind: 'insert', table: 'sublists', payload: sublistInsert })
        for (const itemRow of itemInserts) {
          await queue({ kind: 'insert', table: 'items', payload: itemRow })
        }
        for (const linkRow of linkInserts) {
          await queue({ kind: 'insert', table: 'sublist_items', payload: linkRow })
        }
      }

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        await queueAllOffline()
        return { sublist: localSublist, items: localItems, links: localLinks }
      }

      // 1. Sub-list row first.
      const { data: createdSub, error: subError } = await supabase
        .from('sublists')
        .insert(sublistInsert)
        .select(SUBLIST_COLUMNS)
        .single()

      if (subError) {
        if (isConnectivityError(subError)) {
          await queueAllOffline()
          return { sublist: localSublist, items: localItems, links: localLinks }
        }
        if (isMissingTableError(subError)) {
          writeLocalSublists(
            listId,
            sortSublists([...readLocalSublists(listId).filter((s) => s.id !== localSublist.id), localSublist]),
          )
          writeLocalSublistLinks(listId, [...readLocalSublistLinks(listId), ...localLinks])
          return { sublist: localSublist, items: localItems, links: localLinks }
        }
        throw new Error(rpcErrorMessage(subError))
      }

      // 2. Any brand-new ingredient items second.
      let savedItems: Item[] = []
      if (itemInserts.length > 0) {
        const { data: insItems, error: itemError } = await supabase
          .from('items')
          .insert(itemInserts)
          .select(ITEM_COLUMNS)
        if (itemError) {
          if (isConnectivityError(itemError)) {
            for (const itemRow of itemInserts) {
              await queue({ kind: 'insert', table: 'items', payload: itemRow })
            }
            for (const linkRow of linkInserts) {
              await queue({ kind: 'insert', table: 'sublist_items', payload: linkRow })
            }
            return { sublist: createdSub, items: localItems, links: localLinks }
          }
          throw new Error(rpcErrorMessage(itemError))
        }
        savedItems = insItems ?? []
      }

      // 3. Links third — both endpoint tables now hold committed rows.
      let savedLinks: SublistItem[] = localLinks
      if (linkInserts.length > 0) {
        const { data: insLinks, error: linkError } = await supabase
          .from('sublist_items')
          .upsert(linkInserts, { onConflict: 'sublist_id,item_id', ignoreDuplicates: true })
          .select(SUBLIST_LINK_COLUMNS)
        if (linkError) {
          if (isConnectivityError(linkError)) {
            for (const linkRow of linkInserts) {
              await queue({ kind: 'insert', table: 'sublist_items', payload: linkRow })
            }
          } else {
            throw new Error(rpcErrorMessage(linkError))
          }
        } else if (insLinks && insLinks.length > 0) {
          savedLinks = insLinks
        }
      }

      return { sublist: createdSub, items: savedItems, links: savedLinks }
    },
    onMutate: async ({ draft, itemIds = [], newItems = [] }) => {
      const allLinkIds = [...new Set([...itemIds, ...newItems.map((d) => d.id)])]
      beginLocalWrite(draft.id)
      for (const d of newItems) beginLocalWrite(d.id)
      for (const id of allLinkIds) beginLocalWrite(linkKey(draft.id, id))

      await Promise.all([
        client.cancelQueries({ queryKey: qk.sublists(listId) }),
        client.cancelQueries({ queryKey: qk.sublistLinks(listId) }),
        ...(newItems.length > 0 ? [client.cancelQueries({ queryKey: qk.items(listId) })] : []),
      ])

      const previousSublists = client.getQueryData<Sublist[]>(qk.sublists(listId))
      const previousLinks = client.getQueryData<SublistItem[]>(qk.sublistLinks(listId))
      const previousItems = client.getQueryData<Item[]>(qk.items(listId))

      const now = new Date().toISOString()
      upsertSublistInCache(client, listId, {
        id: draft.id,
        list_id: listId,
        name: draft.name,
        emoji: draft.emoji ?? null,
        note: draft.note ?? null,
        sort_order: draft.sort_order,
        created_by: user?.id ?? null,
        created_at: now,
        updated_at: now,
      })

      for (const d of newItems) {
        upsertItemInCache(client, listId, {
          id: d.id,
          list_id: listId,
          name: d.name,
          quantity: d.quantity ?? null,
          category: d.category ?? null,
          note: d.note ?? null,
          checked: false,
          added_by: user?.id ?? null,
          checked_by: null,
          checked_at: null,
          source: 'app',
          sort_order: d.sort_order,
          created_at: now,
          updated_at: now,
        })
      }

      for (const itemId of allLinkIds) {
        upsertSublistLinkInCache(client, listId, {
          sublist_id: draft.id,
          item_id: itemId,
          list_id: listId,
          created_at: now,
        })
      }

      return { previousSublists, previousLinks, previousItems, allLinkIds }
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.previousSublists) client.setQueryData(qk.sublists(listId), ctx.previousSublists)
      if (ctx?.previousLinks) client.setQueryData(qk.sublistLinks(listId), ctx.previousLinks)
      if (ctx?.previousItems) client.setQueryData(qk.items(listId), ctx.previousItems)
    },
    onSuccess: ({ sublist, items, links }) => {
      upsertSublistInCache(client, listId, sublist)
      for (const item of items) upsertItemInCache(client, listId, item)
      for (const link of links) upsertSublistLinkInCache(client, listId, link)
    },
    onSettled: (_d, _e, vars, ctx) => {
      endLocalWrite(vars.draft.id)
      for (const d of vars.newItems ?? []) endLocalWrite(d.id)
      for (const id of ctx?.allLinkIds ?? []) endLocalWrite(linkKey(vars.draft.id, id))
    },
  })
}

export function prepareSublistDraft(
  client: QueryClient,
  listId: string,
  input: NewSublistInput,
): (NewSublistInput & { id: string; sort_order: number }) | null {
  const name = input.name.trim().slice(0, 80)
  if (name.length === 0) return null
  return {
    id: input.id ?? newId(),
    name,
    emoji: input.emoji?.trim() ? input.emoji.trim().slice(0, 8) : null,
    note: input.note?.trim() ? input.note.trim().slice(0, 200) : null,
    sort_order: nextSublistSortOrder(client, listId),
  }
}

export type SublistEdits = {
  name: string
  emoji: string | null
  note: string | null
}

export function useUpdateSublist(listId: string) {
  const client = useQueryClient()
  const { queue } = useOutbox()

  return useMutation({
    mutationFn: async ({
      sublist,
      edits,
    }: {
      sublist: Sublist
      edits: SublistEdits
    }): Promise<Sublist> => {
      const patch = {
        name: edits.name.trim().slice(0, 80),
        emoji: edits.emoji,
        note: edits.note,
      }
      const locally = (): Sublist => ({
        ...sublist,
        ...patch,
        updated_at: new Date().toISOString(),
      })

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        await queue({ kind: 'update', table: 'sublists', id: sublist.id, payload: patch })
        return locally()
      }

      const { data, error } = await supabase
        .from('sublists')
        .update(patch)
        .eq('id', sublist.id)
        .select(SUBLIST_COLUMNS)
        .single()

      if (error) {
        if (isConnectivityError(error)) {
          await queue({ kind: 'update', table: 'sublists', id: sublist.id, payload: patch })
          return locally()
        }
        if (isMissingTableError(error)) {
          const updated = locally()
          const next = readLocalSublists(listId).map((s) => (s.id === sublist.id ? updated : s))
          writeLocalSublists(listId, next)
          return updated
        }
        throw new Error(rpcErrorMessage(error))
      }
      return data
    },
    onMutate: async ({ sublist, edits }) => {
      beginLocalWrite(sublist.id)
      await client.cancelQueries({ queryKey: qk.sublists(listId) })
      const previous = client.getQueryData<Sublist[]>(qk.sublists(listId))
      upsertSublistInCache(client, listId, {
        ...sublist,
        ...edits,
        updated_at: new Date().toISOString(),
      })
      return { previous }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) client.setQueryData(qk.sublists(listId), ctx.previous)
    },
    onSuccess: (sublist) => upsertSublistInCache(client, listId, sublist),
    onSettled: (_d, _e, vars) => endLocalWrite(vars.sublist.id),
  })
}

export function useDeleteSublist(listId: string) {
  const client = useQueryClient()
  const { queue } = useOutbox()

  return useMutation({
    mutationFn: async (sublist: Sublist): Promise<void> => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        await queue({ kind: 'delete', table: 'sublists', id: sublist.id })
        return
      }

      const { error } = await supabase.from('sublists').delete().eq('id', sublist.id)
      if (error) {
        if (isConnectivityError(error)) {
          await queue({ kind: 'delete', table: 'sublists', id: sublist.id })
          return
        }
        if (isMissingTableError(error)) {
          writeLocalSublists(
            listId,
            readLocalSublists(listId).filter((s) => s.id !== sublist.id),
          )
          writeLocalSublistLinks(
            listId,
            readLocalSublistLinks(listId).filter((l) => l.sublist_id !== sublist.id),
          )
          return
        }
        throw new Error(rpcErrorMessage(error))
      }
    },
    onMutate: async (sublist) => {
      beginLocalWrite(sublist.id)
      await client.cancelQueries({ queryKey: qk.sublists(listId) })
      await client.cancelQueries({ queryKey: qk.sublistLinks(listId) })
      const previousSublists = client.getQueryData<Sublist[]>(qk.sublists(listId))
      const previousLinks = client.getQueryData<SublistItem[]>(qk.sublistLinks(listId))
      removeSublistFromCache(client, listId, sublist.id)
      return { previousSublists, previousLinks }
    },
    onError: (_e, _s, ctx) => {
      if (ctx?.previousSublists) client.setQueryData(qk.sublists(listId), ctx.previousSublists)
      if (ctx?.previousLinks) client.setQueryData(qk.sublistLinks(listId), ctx.previousLinks)
    },
    onSettled: (_d, _e, sublist) => endLocalWrite(sublist.id),
  })
}

export function useLinkSublistItem(listId: string) {
  const client = useQueryClient()
  const { queue } = useOutbox()

  return useMutation({
    mutationFn: async ({
      sublistId,
      itemId,
    }: {
      sublistId: string
      itemId: string
    }): Promise<SublistItem> => {
      const row = { sublist_id: sublistId, item_id: itemId, list_id: listId }
      const localLink: SublistItem = { ...row, created_at: new Date().toISOString() }

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        await queue({ kind: 'insert', table: 'sublist_items', payload: row })
        return localLink
      }

      const { data, error } = await supabase
        .from('sublist_items')
        .upsert(row, { onConflict: 'sublist_id,item_id', ignoreDuplicates: true })
        .select(SUBLIST_LINK_COLUMNS)
        .maybeSingle()

      if (error) {
        if (isConnectivityError(error)) {
          await queue({ kind: 'insert', table: 'sublist_items', payload: row })
          return localLink
        }
        if (isMissingTableError(error)) {
          const existing = readLocalSublistLinks(listId)
          if (!existing.some((l) => l.sublist_id === sublistId && l.item_id === itemId)) {
            writeLocalSublistLinks(listId, [...existing, localLink])
          }
          return localLink
        }
        throw new Error(rpcErrorMessage(error))
      }
      return data ?? localLink
    },
    onMutate: async ({ sublistId, itemId }) => {
      const key = linkKey(sublistId, itemId)
      beginLocalWrite(key)
      await client.cancelQueries({ queryKey: qk.sublistLinks(listId) })
      const previous = client.getQueryData<SublistItem[]>(qk.sublistLinks(listId))
      upsertSublistLinkInCache(client, listId, {
        sublist_id: sublistId,
        item_id: itemId,
        list_id: listId,
        created_at: new Date().toISOString(),
      })
      return { previous, key }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) client.setQueryData(qk.sublistLinks(listId), ctx.previous)
    },
    onSuccess: (link) => upsertSublistLinkInCache(client, listId, link),
    onSettled: (_d, _e, vars) => endLocalWrite(linkKey(vars.sublistId, vars.itemId)),
  })
}

export function useUnlinkSublistItem(listId: string) {
  const client = useQueryClient()
  const { queue } = useOutbox()

  return useMutation({
    mutationFn: async ({
      sublistId,
      itemId,
    }: {
      sublistId: string
      itemId: string
    }): Promise<void> => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        await queue({
          kind: 'delete-link',
          table: 'sublist_items',
          sublist_id: sublistId,
          item_id: itemId,
        })
        return
      }

      const { error } = await supabase
        .from('sublist_items')
        .delete()
        .eq('sublist_id', sublistId)
        .eq('item_id', itemId)

      if (error) {
        if (isConnectivityError(error)) {
          await queue({
            kind: 'delete-link',
            table: 'sublist_items',
            sublist_id: sublistId,
            item_id: itemId,
          })
          return
        }
        if (isMissingTableError(error)) {
          writeLocalSublistLinks(
            listId,
            readLocalSublistLinks(listId).filter(
              (l) => !(l.sublist_id === sublistId && l.item_id === itemId),
            ),
          )
          return
        }
        throw new Error(rpcErrorMessage(error))
      }
    },
    onMutate: async ({ sublistId, itemId }) => {
      beginLocalWrite(linkKey(sublistId, itemId))
      await client.cancelQueries({ queryKey: qk.sublistLinks(listId) })
      const previous = client.getQueryData<SublistItem[]>(qk.sublistLinks(listId))
      removeSublistLinkFromCache(client, listId, sublistId, itemId)
      return { previous }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) client.setQueryData(qk.sublistLinks(listId), ctx.previous)
    },
    onSettled: (_d, _e, vars) => endLocalWrite(linkKey(vars.sublistId, vars.itemId)),
  })
}

/** Re-link restored items after Undo on a delete or clear-checked. */
export function useRestoreSublistLinks(listId: string) {
  const client = useQueryClient()
  const { queue } = useOutbox()

  return useMutation({
    mutationFn: async (links: SublistItem[]): Promise<SublistItem[]> => {
      if (links.length === 0) return []
      const rows = links.map((l) => ({
        sublist_id: l.sublist_id,
        item_id: l.item_id,
        list_id: listId,
      }))

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        for (const row of rows) {
          await queue({ kind: 'insert', table: 'sublist_items', payload: row })
        }
        return links
      }

      const { data, error } = await supabase
        .from('sublist_items')
        .upsert(rows, { onConflict: 'sublist_id,item_id', ignoreDuplicates: true })
        .select(SUBLIST_LINK_COLUMNS)

      if (error) {
        if (isConnectivityError(error)) {
          for (const row of rows) {
            await queue({ kind: 'insert', table: 'sublist_items', payload: row })
          }
          return links
        }
        if (isMissingTableError(error)) {
          const existing = readLocalSublistLinks(listId)
          const merged = [...existing]
          for (const l of links) {
            if (!merged.some((e) => e.sublist_id === l.sublist_id && e.item_id === l.item_id)) {
              merged.push(l)
            }
          }
          writeLocalSublistLinks(listId, merged)
          return links
        }
        throw new Error(rpcErrorMessage(error))
      }
      return data ?? []
    },
    onMutate: async (links) => {
      for (const l of links) beginLocalWrite(linkKey(l.sublist_id, l.item_id))
      await client.cancelQueries({ queryKey: qk.sublistLinks(listId) })
      const previous = client.getQueryData<SublistItem[]>(qk.sublistLinks(listId))
      for (const l of links) upsertSublistLinkInCache(client, listId, l)
      return { previous }
    },
    onError: (_e, _l, ctx) => {
      if (ctx?.previous) client.setQueryData(qk.sublistLinks(listId), ctx.previous)
    },
    onSuccess: (links) => {
      for (const l of links) upsertSublistLinkInCache(client, listId, l)
    },
    onSettled: (_d, _e, links) => {
      for (const l of links) endLocalWrite(linkKey(l.sublist_id, l.item_id))
    },
  })
}
