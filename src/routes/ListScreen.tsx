import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ChevronDown,
  Eye,
  History,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Settings,
  ShoppingBasket,
  Trash2,
  UserCircle2,
  UtensilsCrossed,
  X,
} from 'lucide-react'
import { StaplesSheet } from '@/components/StaplesSheet'
import { SublistSheet, type SublistFormSubmit } from '@/components/SublistSheet'
import { useForgetStaple, usePurchaseHistory } from '@/hooks/usePurchaseHistory'
import { AppShell } from '@/components/AppShell'
import { AddItemBar } from '@/components/AddItemBar'
import { ItemRow } from '@/components/ItemRow'
import { ItemEditSheet } from '@/components/ItemEditSheet'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ConnectionIndicator } from '@/components/ConnectionIndicator'
import { ErrorState } from '@/components/ErrorState'
import { useToast } from '@/components/Toast'
import { useHouseholds, useDefaultList, useMembers } from '@/hooks/useHouseholds'
import {
  draftFromInput,
  useAddItem,
  useClearChecked,
  useDeleteItem,
  useItems,
  useRestoreItems,
  useToggleItem,
  useUpdateItem,
  type ItemEdits,
} from '@/hooks/useItems'
import {
  prepareSublistDraft,
  useCreateSublist,
  useDeleteSublist,
  useLinkSublistItem,
  useRestoreSublistLinks,
  useSublistLinks,
  useSublists,
  useUnlinkSublistItem,
  useUpdateSublist,
} from '@/hooks/useSublists'
import { useRealtimeItems } from '@/hooks/useRealtimeItems'
import { useRealtimeProfiles } from '@/hooks/useRealtimeProfiles'
import { useCategoryRules, useSaveCategoryRule } from '@/hooks/useCategoryRules'
import { usePreferences } from '@/hooks/usePreferences'
import {
  CATEGORY_DESCRIPTION,
  CATEGORY_EMOJI,
  CATEGORY_ORDER,
  toCategory,
  type Category,
} from '@/lib/categories'
import { DEFAULT_SUBLIST_EMOJI } from '@/lib/sublists'
import { can } from '@/lib/permissions'
import { LAST_HOUSEHOLD_KEY, writeLocal } from '@/lib/storage'
import { useQueryClient } from '@tanstack/react-query'
import type { Item, Sublist } from '@/types/database'

export default function ListScreen() {
  const { householdId } = useParams<{ householdId: string }>()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const { preferences } = usePreferences()

  const householdsQuery = useHouseholds()
  const listQuery = useDefaultList(householdId)
  const list = listQuery.list
  const membersQuery = useMembers(householdId)
  const itemsQuery = useItems(list?.id)
  const sublistsQuery = useSublists(list?.id)
  const sublistLinksQuery = useSublistLinks(list?.id)
  const { status: connection } = useRealtimeItems(list?.id)
  useRealtimeProfiles(householdId)
  const rules = useCategoryRules(householdId).data ?? []
  const saveRule = useSaveCategoryRule(householdId ?? '')
  const staples = usePurchaseHistory(householdId).data ?? []
  const forgetStaple = useForgetStaple(householdId ?? '')

  const listId = list?.id ?? ''
  const addItem = useAddItem(listId)
  const toggleItem = useToggleItem(listId)
  const updateItem = useUpdateItem(listId)
  const deleteItem = useDeleteItem(listId)
  const restoreItems = useRestoreItems(listId)
  const clearChecked = useClearChecked(listId)

  const createSublist = useCreateSublist(listId)
  const updateSublist = useUpdateSublist(listId)
  const deleteSublist = useDeleteSublist(listId)
  const linkSublistItem = useLinkSublistItem(listId)
  const unlinkSublistItem = useUnlinkSublistItem(listId)
  const restoreSublistLinks = useRestoreSublistLinks(listId)

  const [query, setQuery] = useState('')
  const [activeSublistId, setActiveSublistId] = useState<string | null>(null)
  const [sublistModal, setSublistModal] = useState<
    { open: false } | { open: true; sublist: Sublist | null; seedItem: Item | null }
  >({ open: false })
  const [showStaples, setShowStaples] = useState(false)
  const [editing, setEditing] = useState<Item | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [showChecked, setShowChecked] = useState(true)
  const [confirmClear, setConfirmClear] = useState(false)

  const household = householdsQuery.data?.find((h) => h.id === householdId)
  const sublists = sublistsQuery.data ?? []
  const sublistLinks = sublistLinksQuery.data ?? []

  // Remembered so a cold start lands straight back on this list rather than
  // the picker. In an effect, not in render — render must stay side-effect free.
  useEffect(() => {
    if (household) writeLocal(LAST_HOUSEHOLD_KEY, household.id)
  }, [household])

  // If the currently viewed sub-list was deleted on another phone, fall back
  // gracefully to the main list rather than stranding the user on an empty view.
  const activeSublist = useMemo(
    () => (activeSublistId ? (sublists.find((s) => s.id === activeSublistId) ?? null) : null),
    [activeSublistId, sublists],
  )
  useEffect(() => {
    if (activeSublistId && !sublistsQuery.isPending && !activeSublist) {
      setActiveSublistId(null)
    }
  }, [activeSublistId, activeSublist, sublistsQuery.isPending])

  // Fast lookups between items and sub-lists.
  const { sublistsByItem, itemIdsBySublist } = useMemo(() => {
    const byId = new Map(sublists.map((s) => [s.id, s]))
    const byItem = new Map<string, Sublist[]>()
    const bySublist = new Map<string, Set<string>>()

    for (const link of sublistLinks) {
      const sub = byId.get(link.sublist_id)
      if (!sub) continue
      const itemSubs = byItem.get(link.item_id)
      if (itemSubs) itemSubs.push(sub)
      else byItem.set(link.item_id, [sub])

      const set = bySublist.get(link.sublist_id)
      if (set) set.add(link.item_id)
      else bySublist.set(link.sublist_id, new Set([link.item_id]))
    }

    return { sublistsByItem: byItem, itemIdsBySublist: bySublist }
  }, [sublists, sublistLinks])

  const memberFor = useMemo(() => {
    const byId = new Map(
      (membersQuery.data ?? []).map((m) => [
        m.userId,
        {
          displayName: m.isYou ? 'you' : m.displayName,
          avatarEmoji: m.avatarEmoji,
          avatarColor: m.avatarColor,
          avatarUrl: m.avatarUrl,
        },
      ]),
    )
    return (userId: string | null) => (userId ? (byId.get(userId) ?? null) : null)
  }, [membersQuery.data])

  const allItems = itemsQuery.data ?? []

  // Scope items to the active sub-list (if any) BEFORE applying search.
  // Search narrows what is rendered, never what is counted or cleared —
  // acting on a search-filtered view would let somebody clear items they cannot see.
  const scopedItems = useMemo(() => {
    if (!activeSublist) return allItems
    const memberIds = itemIdsBySublist.get(activeSublist.id)
    if (!memberIds) return []
    return allItems.filter((i) => memberIds.has(i.id))
  }, [allItems, activeSublist, itemIdsBySublist])

  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length === 0) return scopedItems
    return scopedItems.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        (i.note ?? '').toLowerCase().includes(q) ||
        (i.category ?? '').toLowerCase().includes(q),
    )
  }, [scopedItems, query])

  const onListNames = useMemo(() => {
    const basis = activeSublist ? scopedItems : allItems
    return new Set(basis.map((i) => i.name.trim().toLowerCase()))
  }, [allItems, scopedItems, activeSublist])

  const { groups, checkedItems, flat } = useMemo(
    () => arrangeItems(items, preferences.groupByCategory, preferences.autoCollapseChecked),
    [items, preferences.groupByCategory, preferences.autoCollapseChecked],
  )

  const outstanding = scopedItems.filter((i) => !i.checked).length
  const checkedInScope = useMemo(() => scopedItems.filter((i) => i.checked), [scopedItems])

  function toggleCollapsed(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  /** Insert or link a single parsed phrase, optionally attaching to `targetSublist`. */
  function addSinglePhrase(
    raw: string,
    targetSublist: Sublist | null,
    silentDuplicate = false,
    allowSameAsSublist = false,
  ) {
    if (!listId) return
    const draft = draftFromInput(queryClient, listId, raw, rules)
    if (!draft) return

    // Guard against accidentally typing the sub-list's own title (e.g. "Nachos"
    // while inside the "Nachos" sub-list), which creates a grocery item named
    // after the sub-list itself instead of an ingredient.
    if (
      targetSublist &&
      !allowSameAsSublist &&
      draft.name.trim().toLowerCase() === targetSublist.name.trim().toLowerCase()
    ) {
      showToast({
        message: `You're in ${targetSublist.name} — type the ingredients needed for it.`,
        action: {
          label: `Add "${draft.name}" anyway`,
          onAct: () => addSinglePhrase(raw, targetSublist, silentDuplicate, true),
        },
      })
      return
    }

    const existing = allItems.find(
      (i) => i.name.trim().toLowerCase() === draft.name.trim().toLowerCase(),
    )

    if (existing) {
      // If we are inside a sub-list and the item is already on the main list
      // without belonging to this sub-list yet, link it rather than duplicating!
      if (targetSublist) {
        const alreadyInSublist = itemIdsBySublist.get(targetSublist.id)?.has(existing.id) ?? false
        if (!alreadyInSublist) {
          linkSublistItem.mutate(
            { sublistId: targetSublist.id, itemId: existing.id },
            {
              onError: (error) =>
                showToast({ message: (error as Error).message, tone: 'error' }),
            },
          )
          if (existing.checked) onToggle(existing)
          if (!silentDuplicate) {
            showToast({ message: `Added ${existing.name} to ${targetSublist.name}.` })
          }
          return
        }
      }

      if (existing.checked) onToggle(existing)
      if (!silentDuplicate) {
        showToast({
          message: existing.checked
            ? `${existing.name} was ticked off — back on the list.`
            : `${existing.name} is already on the list.`,
          action: {
            label: 'Add anyway',
            onAct: () => {
              addItem.mutate(
                { ...draft, sublistId: targetSublist?.id ?? null },
                {
                  onError: (error) =>
                    showToast({ message: (error as Error).message, tone: 'error' }),
                },
              )
            },
          },
        })
      }
      return
    }

    addItem.mutate(
      { ...draft, sublistId: targetSublist?.id ?? null },
      {
        onError: (error) => showToast({ message: (error as Error).message, tone: 'error' }),
      },
    )
  }

  function onAdd(raw: string) {
    if (!listId) return
    const parts = raw
      .split(/[,;\r\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)

    if (parts.length === 0) return
    if (parts.length === 1) {
      addSinglePhrase(parts[0], activeSublist, false)
      return
    }

    let floor = Date.now()
    for (const part of parts) {
      const draft = draftFromInput(queryClient, listId, part, rules, floor)
      if (!draft) continue
      floor = draft.sort_order + 1
      const existing = allItems.find(
        (i) => i.name.trim().toLowerCase() === draft.name.trim().toLowerCase(),
      )
      if (existing) {
        if (existing.checked) onToggle(existing)
        if (activeSublist && !(itemIdsBySublist.get(activeSublist.id)?.has(existing.id) ?? false)) {
          linkSublistItem.mutate({ sublistId: activeSublist.id, itemId: existing.id })
        }
      } else {
        addItem.mutate(
          { ...draft, sublistId: activeSublist?.id ?? null },
          {
            onError: (error) => showToast({ message: (error as Error).message, tone: 'error' }),
          },
        )
      }
    }
    showToast({
      message: `Added ${parts.length} items${activeSublist ? ` to ${activeSublist.name}` : ''}.`,
    })
  }

  function onDelete(item: Item) {
    if (household && !can(household.role, 'editItems')) return
    const savedLinks = sublistLinks.filter((l) => l.item_id === item.id)

    deleteItem.mutate(item, {
      onError: (error) => showToast({ message: (error as Error).message, tone: 'error' }),
    })
    showToast({
      message: `Deleted ${item.name}.`,
      action: {
        label: 'Undo',
        onAct: () => {
          restoreItems.mutate([item], {
            onSuccess: () => {
              if (savedLinks.length > 0) restoreSublistLinks.mutate(savedLinks)
            },
            onError: (error) => showToast({ message: (error as Error).message, tone: 'error' }),
          })
        },
      },
    })
  }

  // Always through here, never a bare mutate(). A rejected toggle rolls the
  // optimistic update back, and without a message that reads as "the checkbox
  // is broken" rather than "the server said no".
  function onToggle(item: Item) {
    if (household && !can(household.role, 'checkItems')) return
    toggleItem.mutate(
      { item, checked: !item.checked },
      { onError: (error) => showToast({ message: (error as Error).message, tone: 'error' }) },
    )
  }

  function onSaveEdits(item: Item, edits: ItemEdits, nextSublistIds?: ReadonlySet<string>) {
    updateItem.mutate(
      { item, edits },
      { onError: (error) => showToast({ message: (error as Error).message, tone: 'error' }) },
    )

    // Changing the aisle by hand is a correction — remember it, so the same
    // thing is filed properly next shop instead of needing the same fix again.
    if (edits.category && edits.category !== item.category && householdId) {
      saveRule.mutate({ keyword: edits.name, category: edits.category })
    }

    if (nextSublistIds) {
      const currentIds = new Set(
        sublistLinks.filter((l) => l.item_id === item.id).map((l) => l.sublist_id),
      )
      for (const sid of nextSublistIds) {
        if (!currentIds.has(sid)) {
          linkSublistItem.mutate(
            { sublistId: sid, itemId: item.id },
            { onError: (error) => showToast({ message: (error as Error).message, tone: 'error' }) },
          )
        }
      }
      for (const sid of currentIds) {
        if (!nextSublistIds.has(sid)) {
          unlinkSublistItem.mutate(
            { sublistId: sid, itemId: item.id },
            { onError: (error) => showToast({ message: (error as Error).message, tone: 'error' }) },
          )
        }
      }
    }
  }

  function onSaveSublistSheet(payload: SublistFormSubmit) {
    if (!listId || !sublistModal.open) return
    const editingSub = sublistModal.sublist
    const onErr = (error: unknown) =>
      showToast({ message: (error as Error).message, tone: 'error' })

    // Split raw ingredient phrases into existing main-list matches vs brand-new items.
    const extraMatchedIds = new Set<string>()
    const newItemDrafts: Array<
      NonNullable<ReturnType<typeof draftFromInput>>
    > = []

    let floor = Date.now()
    for (const phrase of payload.rawIngredients) {
      const draft = draftFromInput(queryClient, listId, phrase, rules, floor)
      if (!draft) continue
      floor = draft.sort_order + 1

      const match = allItems.find(
        (i) => i.name.trim().toLowerCase() === draft.name.trim().toLowerCase(),
      )
      if (match) {
        if (match.checked) onToggle(match)
        extraMatchedIds.add(match.id)
      } else {
        newItemDrafts.push(draft)
      }
    }

    const desiredExistingIds = new Set([...payload.selectedItemIds, ...extraMatchedIds])

    if (editingSub) {
      const currentSet = itemIdsBySublist.get(editingSub.id) ?? new Set<string>()
      updateSublist.mutate(
        {
          sublist: editingSub,
          edits: { name: payload.name, emoji: payload.emoji, note: payload.note },
        },
        { onError: onErr },
      )

      for (const itemId of desiredExistingIds) {
        if (!currentSet.has(itemId)) {
          linkSublistItem.mutate({ sublistId: editingSub.id, itemId }, { onError: onErr })
        }
      }
      for (const itemId of currentSet) {
        if (!payload.selectedItemIds.has(itemId) && !extraMatchedIds.has(itemId)) {
          unlinkSublistItem.mutate({ sublistId: editingSub.id, itemId }, { onError: onErr })
        }
      }
      for (const draft of newItemDrafts) {
        addItem.mutate({ ...draft, sublistId: editingSub.id }, { onError: onErr })
      }

      showToast({ message: `Updated ${payload.name}.` })
      return
    }

    const draft = prepareSublistDraft(queryClient, listId, {
      name: payload.name,
      emoji: payload.emoji,
      note: payload.note,
    })
    if (!draft) return

    // One atomic mutation: populates the sub-list, new items, and all links in
    // cache at 0ms, and commits `sublists` → `items` → `sublist_items` in order.
    setActiveSublistId(draft.id)
    createSublist.mutate(
      {
        draft,
        itemIds: [...desiredExistingIds],
        newItems: newItemDrafts,
      },
      {
        onError: (error) => {
          setActiveSublistId(null)
          onErr(error)
        },
      },
    )
    showToast({ message: `Created ${payload.emoji} ${payload.name}.` })
  }

  function onDeleteSublist(sublist: Sublist, alsoDeleteItems: boolean) {
    const memberIds = itemIdsBySublist.get(sublist.id) ?? new Set<string>()
    const memberItems = allItems.filter((i) => memberIds.has(i.id))

    if (activeSublistId === sublist.id) setActiveSublistId(null)

    deleteSublist.mutate(sublist, {
      onError: (error) => showToast({ message: (error as Error).message, tone: 'error' }),
    })

    if (alsoDeleteItems && memberItems.length > 0) {
      clearChecked.mutate(memberItems, {
        onError: (error) => showToast({ message: (error as Error).message, tone: 'error' }),
      })
      showToast({
        message: `Removed ${sublist.name} and ${memberItems.length} ${
          memberItems.length === 1 ? 'item' : 'items'
        }.`,
      })
    } else {
      showToast({ message: `Removed ${sublist.name}. Items stayed on the main list.` })
    }
  }

  function uncheckAllInSublist(sublist: Sublist) {
    const memberIds = itemIdsBySublist.get(sublist.id)
    if (!memberIds) return
    const toUncheck = allItems.filter((i) => memberIds.has(i.id) && i.checked)
    for (const item of toUncheck) {
      toggleItem.mutate(
        { item, checked: false },
        { onError: (error) => showToast({ message: (error as Error).message, tone: 'error' }) },
      )
    }
    if (toUncheck.length > 0) {
      showToast({
        message: `${toUncheck.length} ${toUncheck.length === 1 ? 'item' : 'items'} back on the list for ${sublist.name}.`,
      })
    }
  }

  if (householdsQuery.isError) {
    return (
      <ErrorState
        title="Couldn't load your household"
        message={
          householdsQuery.error instanceof Error ? householdsQuery.error.message : 'Something went wrong.'
        }
        onRetry={() => void householdsQuery.refetch()}
      />
    )
  }

  if (!householdsQuery.isPending && !household) {
    return (
      <ErrorState
        title="Household not found"
        message="You're not a member of this household, or it no longer exists."
      />
    )
  }

  const canAdd = household ? can(household.role, 'addItems') : true
  const canCheck = household ? can(household.role, 'checkItems') : true
  const canEdit = household ? can(household.role, 'editItems') : true

  const header = (
    <div className="shell-header-inner flex min-h-tap items-center gap-1.5 py-2.5 min-[380px]:gap-2 sm:py-3">
      <ShoppingBasket className="h-5 w-5 shrink-0 text-larder-600 min-[380px]:h-6 min-[380px]:w-6 dark:text-larder-400" aria-hidden />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold leading-tight tracking-tight min-[380px]:text-lg">
          {household?.name ?? 'Groceries'}
        </h1>
        <ConnectionIndicator status={connection} />
      </div>
      <Link
        to={`/h/${householdId}/household`}
        className="tap shrink-0 rounded-xl text-larder-600 dark:text-larder-400"
        aria-label="Household settings"
      >
        <Settings className="h-5 w-5" aria-hidden />
      </Link>
      <Link
        to="/account"
        className="tap -mr-2 shrink-0 rounded-xl text-larder-600 dark:text-larder-400"
        aria-label="Your settings"
      >
        <UserCircle2 className="h-5 w-5" aria-hidden />
      </Link>
    </div>
  )

  const showSearch = allItems.length > 4 || query.length > 0
  const showSublistStrip = sublists.length > 0 || canEdit

  const toolbar =
    showSearch || showSublistStrip ? (
      <div className="space-y-2 pt-2">
        {/* ── Sub-lists pill strip + search (side-by-side on wide screens) ── */}
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          {showSublistStrip ? (
            <div
              role="tablist"
              aria-label="Filter by sub-list or dish"
              className="scroll-x-pills -mx-1 flex min-w-0 items-center gap-1.5 px-1 py-0.5 lg:flex-1"
            >
              {sublists.length > 0 ? (
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeSublist === null}
                  onClick={() => setActiveSublistId(null)}
                  className={`inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    activeSublist === null
                      ? 'border-larder-600 bg-larder-600 text-white shadow-sm dark:border-larder-400 dark:bg-larder-500 dark:text-larder-950'
                      : 'border-larder-200 bg-white text-larder-700 hover:bg-larder-100 dark:border-larder-800 dark:bg-larder-900 dark:text-larder-300 dark:hover:bg-larder-800'
                  }`}
                >
                  <span>All items</span>
                  <span
                    className={`rounded-full px-1.5 py-0.2 text-[11px] ${
                      activeSublist === null
                        ? 'bg-white/20 text-white dark:bg-black/15 dark:text-larder-950'
                        : 'bg-larder-100 text-larder-600 dark:bg-larder-800 dark:text-larder-400'
                    }`}
                  >
                    {allItems.filter((i) => !i.checked).length}
                  </span>
                </button>
              ) : null}

              {sublists.map((sub) => {
                const selected = activeSublist?.id === sub.id
                const memberIds = itemIdsBySublist.get(sub.id)
                const subItems = memberIds ? allItems.filter((i) => memberIds.has(i.id)) : []
                const needed = subItems.filter((i) => !i.checked).length
                const allDone = subItems.length > 0 && needed === 0

                return (
                  <button
                    key={sub.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setActiveSublistId(selected ? null : sub.id)}
                    className={`inline-flex min-h-[36px] max-w-[13rem] shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      selected
                        ? 'border-larder-600 bg-larder-600 text-white shadow-sm dark:border-larder-400 dark:bg-larder-500 dark:text-larder-950'
                        : 'border-larder-200 bg-white text-larder-800 hover:bg-larder-100 dark:border-larder-800 dark:bg-larder-900 dark:text-larder-200 dark:hover:bg-larder-800'
                    }`}
                  >
                    <span aria-hidden>{sub.emoji ?? DEFAULT_SUBLIST_EMOJI}</span>
                    <span className="truncate">{sub.name}</span>
                    <span
                      className={`shrink-0 rounded-full px-1.5 text-[11px] ${
                        selected
                          ? 'bg-white/20 text-white dark:bg-black/15 dark:text-larder-950'
                          : allDone
                            ? 'bg-larder-100 text-larder-700 dark:bg-larder-800 dark:text-larder-300'
                            : 'bg-larder-100 text-larder-600 dark:bg-larder-800 dark:text-larder-400'
                      }`}
                    >
                      {allDone ? '✓' : needed}
                    </span>
                  </button>
                )
              })}

              {canEdit ? (
                <button
                  type="button"
                  onClick={() => setSublistModal({ open: true, sublist: null, seedItem: null })}
                  className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-full border border-dashed border-larder-300 bg-larder-50/70 px-3 py-1 text-xs font-medium text-larder-700 hover:bg-larder-100 dark:border-larder-700 dark:bg-larder-900/60 dark:text-larder-300 dark:hover:bg-larder-800"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  <span>{sublists.length === 0 ? 'Plan a dish / sub-list' : 'New dish'}</span>
                </button>
              ) : null}
            </div>
          ) : null}

          {showSearch ? (
            <div className="relative w-full lg:w-64 xl:w-72">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-larder-400"
                aria-hidden
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={activeSublist ? `Search ${activeSublist.name}…` : 'Search the list…'}
                aria-label="Search the list"
                className="field py-2 pl-9 text-sm"
              />
            </div>
          ) : null}
        </div>

        {/* ── Active sub-list context card ───────────────────────────────── */}
        {activeSublist ? (
          <div className="card flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span aria-hidden className="text-base">
                  {activeSublist.emoji ?? DEFAULT_SUBLIST_EMOJI}
                </span>
                <h2 className="truncate text-sm font-semibold text-larder-950 dark:text-larder-50">
                  {activeSublist.name}
                </h2>
              </div>
              <p className="mt-0.5 text-xs text-larder-600 dark:text-larder-400">
                {scopedItems.length === 0
                  ? 'No ingredients yet — add below or pick from your main list.'
                  : outstanding === 0
                    ? `All ${scopedItems.length} ${scopedItems.length === 1 ? 'item' : 'items'} in the basket!`
                    : `${outstanding} of ${scopedItems.length} still needed`}
                {activeSublist.note ? ` · ${activeSublist.note}` : ''}
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-1">
              {canCheck && checkedInScope.length > 0 ? (
                <button
                  type="button"
                  onClick={() => uncheckAllInSublist(activeSublist)}
                  className="inline-flex min-h-[36px] items-center gap-1 rounded-xl px-2.5 text-xs font-medium text-larder-700 hover:bg-larder-100 dark:text-larder-300 dark:hover:bg-larder-800"
                  title="Uncheck items to shop this dish again"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                  <span>Shop again</span>
                </button>
              ) : null}
              {canEdit ? (
                <button
                  type="button"
                  onClick={() =>
                    setSublistModal({ open: true, sublist: activeSublist, seedItem: null })
                  }
                  className="inline-flex min-h-[36px] items-center gap-1 rounded-xl px-2.5 text-xs font-medium text-larder-700 hover:bg-larder-100 dark:text-larder-300 dark:hover:bg-larder-800"
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                  <span>Edit</span>
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setActiveSublistId(null)}
                aria-label="Back to all items"
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-larder-500 hover:bg-larder-100 dark:hover:bg-larder-800"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>
        ) : null}
      </div>
    ) : null

  const staplesButton = (
    <button
      type="button"
      onClick={() => setShowStaples(true)}
      aria-label="Buy again from purchase history"
      title="Buy again"
      className="btn-secondary shrink-0 gap-1.5 px-2.5 text-xs font-medium sm:px-3"
      style={{ minHeight: 46 }}
    >
      <History className="h-4 w-4 shrink-0 text-larder-600 dark:text-larder-400" aria-hidden />
      <span className="hidden min-[420px]:inline">Buy again</span>
      {staples.length > 0 ? (
        <span className="hidden text-larder-400 sm:inline">· {staples.length}</span>
      ) : null}
    </button>
  )

  const footer = canAdd ? (
    <AddItemBar
      onAdd={onAdd}
      disabled={!listId}
      activeSublist={activeSublist}
      rules={rules}
      leadingAction={staplesButton}
    />
  ) : (
    <p className="flex items-center justify-center gap-2 py-2.5 text-xs text-larder-600 dark:text-larder-400">
      <Eye className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>You have view-only access to this list.</span>
    </p>
  )

  // One gate for the whole screen. Members resolve alongside items, so
  // attribution is present on first paint instead of popping in a beat later
  // and reflowing every row.
  const stillLoading =
    householdsQuery.isPending || listQuery.isPending || itemsQuery.isPending || membersQuery.isPending

  if (stillLoading) {
    return (
      <AppShell header={header} footer={footer} wide>
        <ListSkeleton />
      </AppShell>
    )
  }

  if (itemsQuery.isError) {
    return (
      <AppShell header={header} footer={footer} wide>
        <ErrorState
          title="Couldn't load the list"
          message={itemsQuery.error instanceof Error ? itemsQuery.error.message : 'Something went wrong.'}
          onRetry={() => void itemsQuery.refetch()}
        />
      </AppShell>
    )
  }

  const clearButton =
    canEdit && checkedInScope.length > 0 ? (
      <button
        type="button"
        onClick={() => setConfirmClear(true)}
        className="tap gap-1.5 rounded-xl px-2 text-xs font-medium text-larder-600 hover:text-red-600 dark:text-larder-400 dark:hover:text-red-400"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
        <span>
          Clear checked{activeSublist ? ` (${checkedInScope.length})` : ''}
        </span>
      </button>
    ) : null

  // Helper: sub-list badges to display on a row. When narrowed to a specific
  // sub-list, hide that sub-list's own badge so every row isn't repeating the
  // heading, while still showing any *other* dish that shares the ingredient.
  function badgesFor(itemId: string): readonly Sublist[] {
    const all = sublistsByItem.get(itemId)
    if (!all || all.length === 0) return []
    if (!activeSublist) return all
    return all.filter((s) => s.id !== activeSublist.id)
  }

  const multiColumnAisles = groups.length > 1

  return (
    <AppShell header={header} footer={footer} wide>
      {/* Announced on change, so a screen-reader user hears the list shrink as
          they shop without having to re-read the whole thing. */}
      <p className="sr-only" aria-live="polite">
        {outstanding === 0
          ? 'Nothing left to get.'
          : `${outstanding} ${outstanding === 1 ? 'item' : 'items'} still to get.`}
      </p>

      {toolbar}

      {scopedItems.length > 0 && items.length === 0 ? (
        <p className="py-12 text-center text-sm text-larder-600 dark:text-larder-400">
          Nothing matches “{query}”.
        </p>
      ) : items.length === 0 ? (
        activeSublist ? (
          <SublistEmptyState
            sublist={activeSublist}
            canEdit={canEdit}
            hasMainItems={allItems.length > 0}
            onPickExisting={() =>
              setSublistModal({ open: true, sublist: activeSublist, seedItem: null })
            }
          />
        ) : (
          <EmptyState
            canEdit={canEdit}
            onCreateSublist={() =>
              setSublistModal({ open: true, sublist: null, seedItem: null })
            }
          />
        )
      ) : (
        <div className="space-y-4 py-3 pb-8 sm:py-4">
          {preferences.groupByCategory ? (
            <div
              className={
                multiColumnAisles
                  ? 'space-y-4 lg:columns-2 lg:gap-5 lg:space-y-0 2xl:columns-3'
                  : 'space-y-4'
              }
            >
              {groups.map(([category, categoryItems]) => {
                const isCollapsed = collapsed.has(category)
                return (
                  <section
                    key={category}
                    aria-labelledby={`cat-${category}`}
                    className={multiColumnAisles ? 'lg:mb-4 lg:break-inside-avoid' : undefined}
                  >
                    <button
                      type="button"
                      onClick={() => toggleCollapsed(category)}
                      aria-expanded={!isCollapsed}
                      aria-controls={`cat-panel-${category}`}
                      className="tap flex w-full items-center justify-between rounded-xl px-1 text-left"
                    >
                      <span
                        id={`cat-${category}`}
                        className="flex min-w-0 items-center gap-2 text-sm font-semibold text-larder-800 dark:text-larder-200"
                      >
                        {preferences.showEmoji ? <span aria-hidden>{CATEGORY_EMOJI[category]}</span> : null}
                        <span className="truncate">{category}</span>
                        <span className="sr-only">, {CATEGORY_DESCRIPTION[category]},</span>
                        <span className="font-normal text-larder-500">{categoryItems.length}</span>
                      </span>
                      <ChevronDown
                        className={`h-4 w-4 shrink-0 text-larder-500 transition-transform ${
                          isCollapsed ? '-rotate-90' : ''
                        }`}
                        aria-hidden
                      />
                    </button>

                    <div className="collapsible mt-1.5" data-collapsed={isCollapsed}>
                      <div>
                        <ul
                          id={`cat-panel-${category}`}
                          aria-label={category}
                          className="card divide-y divide-larder-100 overflow-hidden dark:divide-larder-800"
                        >
                          {categoryItems.map((item) => (
                            <ItemRow
                              key={item.id}
                              item={item}
                              sublists={badgesFor(item.id)}
                              memberFor={memberFor}
                              canCheck={canCheck}
                              canEdit={canEdit}
                              onToggle={onToggle}
                              onEdit={setEditing}
                              onDelete={onDelete}
                              onSelectSublist={setActiveSublistId}
                            />
                          ))}
                        </ul>
                      </div>
                    </div>
                  </section>
                )
              })}
            </div>
          ) : (
            <section aria-label="Shopping list">
              {clearButton ? <div className="mb-1.5 flex justify-end px-1">{clearButton}</div> : null}
              <ul className="card divide-y divide-larder-100 overflow-hidden dark:divide-larder-800">
                {flat.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    sublists={badgesFor(item.id)}
                    memberFor={memberFor}
                    canCheck={canCheck}
                    canEdit={canEdit}
                    onToggle={onToggle}
                    onEdit={setEditing}
                    onDelete={onDelete}
                    onSelectSublist={setActiveSublistId}
                  />
                ))}
              </ul>
            </section>
          )}

          {preferences.groupByCategory && checkedItems.length > 0 ? (
            <section aria-labelledby="checked-heading" className="pt-2">
              <div className="flex flex-wrap items-center gap-2 px-1">
                <button
                  type="button"
                  onClick={() => setShowChecked((v) => !v)}
                  aria-expanded={showChecked}
                  aria-controls="checked-panel"
                  className="tap flex min-w-0 flex-1 items-center gap-2 rounded-xl text-left text-sm font-semibold text-larder-600 dark:text-larder-400"
                >
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 transition-transform ${showChecked ? '' : '-rotate-90'}`}
                    aria-hidden
                  />
                  <span id="checked-heading" className="truncate">
                    In the basket
                  </span>
                  <span className="font-normal text-larder-500">{checkedItems.length}</span>
                </button>
                {clearButton}
              </div>

              <div className="collapsible mt-1.5" data-collapsed={!showChecked}>
                <div>
                  <ul
                    id="checked-panel"
                    aria-label="Checked off"
                    className="card divide-y divide-larder-100 overflow-hidden opacity-75 dark:divide-larder-800"
                  >
                    {checkedItems.map((item) => (
                      <ItemRow
                        key={item.id}
                        item={item}
                        sublists={badgesFor(item.id)}
                        memberFor={memberFor}
                        canCheck={canCheck}
                        canEdit={canEdit}
                        onToggle={onToggle}
                        onEdit={setEditing}
                        onDelete={onDelete}
                        onSelectSublist={setActiveSublistId}
                      />
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          ) : null}
        </div>
      )}

      <StaplesSheet
        open={showStaples}
        staples={staples}
        onList={onListNames}
        busy={addItem.isPending}
        onClose={() => setShowStaples(false)}
        onAdd={(staple) =>
          addSinglePhrase(
            staple.quantity ? `${staple.quantity} ${staple.name}` : staple.name,
            activeSublist,
            true,
          )
        }
        onForget={(nameKey) =>
          forgetStaple.mutate(nameKey, {
            onError: (error) => showToast({ message: (error as Error).message, tone: 'error' }),
          })
        }
      />

      <ItemEditSheet
        item={editing}
        sublists={sublists}
        itemSublistIds={
          editing
            ? new Set((sublistsByItem.get(editing.id) ?? []).map((s) => s.id))
            : undefined
        }
        onSave={onSaveEdits}
        onDelete={onDelete}
        onNewSublist={
          canEdit
            ? (forItem) => setSublistModal({ open: true, sublist: null, seedItem: forItem })
            : undefined
        }
        onClose={() => setEditing(null)}
      />

      <SublistSheet
        open={sublistModal.open}
        sublist={sublistModal.open ? sublistModal.sublist : null}
        allItems={allItems}
        linkedItemIds={
          sublistModal.open
            ? sublistModal.sublist
              ? (itemIdsBySublist.get(sublistModal.sublist.id) ?? new Set())
              : sublistModal.seedItem
                ? new Set([sublistModal.seedItem.id])
                : new Set()
            : new Set()
        }
        onSave={onSaveSublistSheet}
        onDelete={canEdit ? onDeleteSublist : undefined}
        onClose={() => setSublistModal({ open: false })}
      />

      <ConfirmDialog
        open={confirmClear}
        title={
          activeSublist
            ? `Clear ${checkedInScope.length} checked ${
                checkedInScope.length === 1 ? 'item' : 'items'
              } from ${activeSublist.name}?`
            : `Clear ${checkedInScope.length} checked ${
                checkedInScope.length === 1 ? 'item' : 'items'
              }?`
        }
        body="They'll be removed from the main list too. You can undo straight after."
        confirmLabel="Clear"
        tone="danger"
        busy={clearChecked.isPending}
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          setConfirmClear(false)
          const cleared = checkedInScope
          const clearedIds = new Set(cleared.map((i) => i.id))
          const savedLinks = sublistLinks.filter((l) => clearedIds.has(l.item_id))

          clearChecked.mutate(cleared, {
            onError: (error) => showToast({ message: (error as Error).message, tone: 'error' }),
          })
          showToast({
            message: `Cleared ${cleared.length} ${cleared.length === 1 ? 'item' : 'items'}.`,
            action: {
              label: 'Undo',
              onAct: () => {
                restoreItems.mutate(cleared, {
                  onSuccess: () => {
                    if (savedLinks.length > 0) restoreSublistLinks.mutate(savedLinks)
                  },
                  onError: (error) =>
                    showToast({ message: (error as Error).message, tone: 'error' }),
                })
              },
            },
          })
        }}
      />
    </AppShell>
  )
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function arrangeItems(
  items: readonly Item[],
  groupByCategory: boolean,
  collapseChecked: boolean,
): {
  groups: Array<[Category, Item[]]>
  checkedItems: Item[]
  flat: Item[]
} {
  const byCategory = new Map<Category, Item[]>()
  const checkedItems: Item[] = []

  for (const item of items) {
    // Checked items only move to their own section when the user wants them to;
    // otherwise they stay in place, ticked.
    if (item.checked && collapseChecked) {
      checkedItems.push(item)
      continue
    }
    // `category` is free text in the database and may be null or something we
    // no longer recognise — narrow it rather than indexing blindly.
    const category = toCategory(item.category)
    const bucket = byCategory.get(category)
    if (bucket) bucket.push(item)
    else byCategory.set(category, [item])
  }

  const groups = groupByCategory
    ? [...byCategory.entries()].sort((a, b) => CATEGORY_ORDER[a[0]] - CATEGORY_ORDER[b[0]])
    : []

  checkedItems.sort(
    (a, b) => Date.parse(b.checked_at ?? b.updated_at) - Date.parse(a.checked_at ?? a.updated_at),
  )

  const flat = collapseChecked ? items.filter((i) => !i.checked) : [...items]

  return { groups, checkedItems, flat }
}

function EmptyState({
  canEdit,
  onCreateSublist,
}: {
  canEdit: boolean
  onCreateSublist: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-10 text-center sm:py-16">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-larder-100 sm:mb-4 sm:h-16 sm:w-16 dark:bg-larder-900">
        <ShoppingBasket className="h-7 w-7 text-larder-500 sm:h-8 sm:w-8" aria-hidden />
      </div>
      <h2 className="text-base font-semibold text-larder-950 dark:text-larder-50">
        Empty larder, clean slate
      </h2>
      <p className="mt-1.5 max-w-xs text-sm text-larder-600 dark:text-larder-400">
        Add the first thing below. Type it however you'd say it — "2 loaves of bread" sorts itself
        out.
      </p>
      {canEdit ? (
        <button
          type="button"
          onClick={onCreateSublist}
          className="btn-secondary mt-5 gap-2 text-xs"
        >
          <UtensilsCrossed className="h-4 w-4 text-larder-600 dark:text-larder-400" aria-hidden />
          Plan a dinner or recipe sub-list
        </button>
      ) : null}
    </div>
  )
}

function SublistEmptyState({
  sublist,
  canEdit,
  hasMainItems,
  onPickExisting,
}: {
  sublist: Sublist
  canEdit: boolean
  hasMainItems: boolean
  onPickExisting: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-10 text-center sm:py-14">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-larder-100 text-2xl dark:bg-larder-900">
        <span aria-hidden>{sublist.emoji ?? DEFAULT_SUBLIST_EMOJI}</span>
      </div>
      <h2 className="text-base font-semibold text-larder-950 dark:text-larder-50">
        Nothing in {sublist.name} yet
      </h2>
      <p className="mt-1.5 max-w-xs text-sm text-larder-600 dark:text-larder-400">
        Add ingredients below — they'll appear here and in the right supermarket aisle on your main
        list.
      </p>
      {canEdit && hasMainItems ? (
        <button
          type="button"
          onClick={onPickExisting}
          className="btn-secondary mt-4 gap-2 text-xs"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Include items from main list
        </button>
      ) : null}
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="space-y-4 py-4 lg:grid lg:grid-cols-2 lg:gap-5 lg:space-y-0" role="status" aria-live="polite">
      <span className="sr-only">Loading your list</span>
      {[0, 1].map((section) => (
        <div key={section} aria-hidden>
          <div className="skeleton mb-2 h-4 w-24" />
          <div className="card divide-y divide-larder-100 overflow-hidden dark:divide-larder-800">
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex items-center gap-3 px-3 py-3">
                <div className="skeleton h-6 w-6 rounded-full" />
                <div className="skeleton h-4 flex-1" style={{ maxWidth: `${70 - row * 12}%` }} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
