import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronDown, Eye, Settings, ShoppingBasket, Trash2, UserCircle2 } from 'lucide-react'
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
import { useRealtimeItems } from '@/hooks/useRealtimeItems'
import { usePreferences } from '@/hooks/usePreferences'
import {
  CATEGORY_DESCRIPTION,
  CATEGORY_EMOJI,
  CATEGORY_ORDER,
  toCategory,
  type Category,
} from '@/lib/categories'
import { can } from '@/lib/permissions'
import { LAST_HOUSEHOLD_KEY, writeLocal } from '@/lib/storage'
import { useQueryClient } from '@tanstack/react-query'
import type { Item } from '@/types/database'

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
  const { status: connection } = useRealtimeItems(list?.id)

  const listId = list?.id ?? ''
  const addItem = useAddItem(listId)
  const toggleItem = useToggleItem(listId)
  const updateItem = useUpdateItem(listId)
  const deleteItem = useDeleteItem(listId)
  const restoreItems = useRestoreItems(listId)
  const clearChecked = useClearChecked(listId)

  const [editing, setEditing] = useState<Item | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [showChecked, setShowChecked] = useState(true)
  const [confirmClear, setConfirmClear] = useState(false)

  const household = householdsQuery.data?.find((h) => h.id === householdId)

  // Remembered so a cold start lands straight back on this list rather than
  // the picker. In an effect, not in render â€” render must stay side-effect free.
  useEffect(() => {
    if (household) writeLocal(LAST_HOUSEHOLD_KEY, household.id)
  }, [household])

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

  const items = itemsQuery.data ?? []
  const { groups, checkedItems, flat } = useMemo(
    () => arrangeItems(items, preferences.groupByCategory, preferences.autoCollapseChecked),
    [items, preferences.groupByCategory, preferences.autoCollapseChecked],
  )
  const outstanding = items.filter((i) => !i.checked).length

  function toggleCollapsed(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function onAdd(raw: string) {
    if (!listId) return
    const draft = draftFromInput(queryClient, listId, raw)
    if (!draft) return
    addItem.mutate(draft, {
      onError: (error) => showToast({ message: (error as Error).message, tone: 'error' }),
    })
  }

  function onDelete(item: Item) {
    deleteItem.mutate(item, {
      onError: (error) => showToast({ message: (error as Error).message, tone: 'error' }),
    })
    showToast({
      message: `Deleted ${item.name}.`,
      action: {
        label: 'Undo',
        onAct: () =>
          restoreItems.mutate([item], {
            onError: (error) => showToast({ message: (error as Error).message, tone: 'error' }),
          }),
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

  function onSaveEdits(item: Item, edits: ItemEdits) {
    updateItem.mutate(
      { item, edits },
      { onError: (error) => showToast({ message: (error as Error).message, tone: 'error' }) },
    )
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

  const header = (
    <div className="flex min-h-tap items-center gap-2 py-3">
      <ShoppingBasket className="h-6 w-6 shrink-0 text-larder-600 dark:text-larder-400" aria-hidden />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-lg font-semibold leading-tight tracking-tight">
          {household?.name ?? 'Groceries'}
        </h1>
        <ConnectionIndicator status={connection} />
      </div>
      <Link
        to={`/h/${householdId}/household`}
        className="tap rounded-xl text-larder-600 dark:text-larder-400"
        aria-label="Household settings"
      >
        <Settings className="h-5 w-5" aria-hidden />
      </Link>
      <Link
        to="/account"
        className="tap -mr-2 rounded-xl text-larder-600 dark:text-larder-400"
        aria-label="Your settings"
      >
        <UserCircle2 className="h-5 w-5" aria-hidden />
      </Link>
    </div>
  )

  // A viewer's writes are refused by RLS, so offering the controls would only
  // produce error toasts. Say why instead.
  const canEdit = household ? can(household.role, 'addItems') : true

  const footer = canEdit ? (
    <AddItemBar onAdd={onAdd} disabled={!listId} />
  ) : (
    <p className="flex items-center justify-center gap-2 py-3 text-xs text-larder-600 dark:text-larder-400">
      <Eye className="h-3.5 w-3.5" aria-hidden />
      You have view-only access to this list.
    </p>
  )

  // One gate for the whole screen. Members resolve alongside items, so
  // attribution is present on first paint instead of popping in a beat later
  // and reflowing every row.
  const stillLoading =
    householdsQuery.isPending || listQuery.isPending || itemsQuery.isPending || membersQuery.isPending

  if (stillLoading) {
    return (
      <AppShell header={header} footer={footer}>
        <ListSkeleton />
      </AppShell>
    )
  }

  if (itemsQuery.isError) {
    return (
      <AppShell header={header} footer={footer}>
        <ErrorState
          title="Couldn't load the list"
          message={itemsQuery.error instanceof Error ? itemsQuery.error.message : 'Something went wrong.'}
          onRetry={() => void itemsQuery.refetch()}
        />
      </AppShell>
    )
  }

  const clearButton =
    checkedItems.length > 0 || items.some((i) => i.checked) ? (
      <button
        type="button"
        onClick={() => setConfirmClear(true)}
        className="tap gap-1.5 rounded-xl px-2 text-xs font-medium text-larder-600 hover:text-red-600 dark:text-larder-400 dark:hover:text-red-400"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
        Clear checked
      </button>
    ) : null

  return (
    <AppShell header={header} footer={footer}>
      {/* Announced on change, so a screen-reader user hears the list shrink as
          they shop without having to re-read the whole thing. */}
      <p className="sr-only" aria-live="polite">
        {outstanding === 0
          ? 'Nothing left to get.'
          : `${outstanding} ${outstanding === 1 ? 'item' : 'items'} still to get.`}
      </p>

      {items.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-4 py-4 pb-8">
          {preferences.groupByCategory ? (
            groups.map(([category, categoryItems]) => {
              const isCollapsed = collapsed.has(category)
              return (
                <section key={category} aria-labelledby={`cat-${category}`}>
                  <button
                    type="button"
                    onClick={() => toggleCollapsed(category)}
                    aria-expanded={!isCollapsed}
                    aria-controls={`cat-panel-${category}`}
                    className="tap flex w-full items-center justify-between rounded-xl px-1 text-left"
                  >
                    <span
                      id={`cat-${category}`}
                      className="flex items-center gap-2 text-sm font-semibold text-larder-800 dark:text-larder-200"
                    >
                      {preferences.showEmoji ? <span aria-hidden>{CATEGORY_EMOJI[category]}</span> : null}
                      {category}
                      <span className="sr-only">, {CATEGORY_DESCRIPTION[category]},</span>
                      <span className="font-normal text-larder-500">{categoryItems.length}</span>
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 text-larder-500 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
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
                            memberFor={memberFor}
                            onToggle={onToggle}
                            onEdit={setEditing}
                            onDelete={onDelete}
                          />
                        ))}
                      </ul>
                    </div>
                  </div>
                </section>
              )
            })
          ) : (
            <section aria-label="Shopping list">
              {clearButton ? <div className="mb-1.5 flex justify-end px-1">{clearButton}</div> : null}
              <ul className="card divide-y divide-larder-100 overflow-hidden dark:divide-larder-800">
                {flat.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    memberFor={memberFor}
                    onToggle={onToggle}
                    onEdit={setEditing}
                    onDelete={onDelete}
                  />
                ))}
              </ul>
            </section>
          )}

          {preferences.groupByCategory && checkedItems.length > 0 ? (
            <section aria-labelledby="checked-heading" className="pt-2">
              <div className="flex items-center gap-2 px-1">
                <button
                  type="button"
                  onClick={() => setShowChecked((v) => !v)}
                  aria-expanded={showChecked}
                  aria-controls="checked-panel"
                  className="tap flex flex-1 items-center gap-2 rounded-xl text-left text-sm font-semibold text-larder-600 dark:text-larder-400"
                >
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${showChecked ? '' : '-rotate-90'}`}
                    aria-hidden
                  />
                  <span id="checked-heading">In the basket</span>
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
                        memberFor={memberFor}
                        onToggle={onToggle}
                        onEdit={setEditing}
                        onDelete={onDelete}
                      />
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          ) : null}
        </div>
      )}

      <ItemEditSheet
        item={editing}
        onSave={onSaveEdits}
        onDelete={onDelete}
        onClose={() => setEditing(null)}
      />

      <ConfirmDialog
        open={confirmClear}
        title={`Clear ${items.filter((i) => i.checked).length} checked ${
          items.filter((i) => i.checked).length === 1 ? 'item' : 'items'
        }?`}
        body="They'll be removed from the list. You can undo straight after."
        confirmLabel="Clear"
        tone="danger"
        busy={clearChecked.isPending}
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          setConfirmClear(false)
          const cleared = items.filter((i) => i.checked)
          clearChecked.mutate(cleared, {
            onError: (error) => showToast({ message: (error as Error).message, tone: 'error' }),
          })
          showToast({
            message: `Cleared ${cleared.length} ${cleared.length === 1 ? 'item' : 'items'}.`,
            action: {
              label: 'Undo',
              onAct: () =>
                restoreItems.mutate(cleared, {
                  onError: (error) => showToast({ message: (error as Error).message, tone: 'error' }),
                }),
            },
          })
        }}
      />
    </AppShell>
  )
}

/* â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

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
    // no longer recognise â€” narrow it rather than indexing blindly.
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

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-larder-100 dark:bg-larder-900">
        <ShoppingBasket className="h-8 w-8 text-larder-500" aria-hidden />
      </div>
      <h2 className="text-base font-semibold text-larder-950 dark:text-larder-50">
        Empty larder, clean slate
      </h2>
      <p className="mt-1.5 max-w-xs text-sm text-larder-600 dark:text-larder-400">
        Add the first thing below. Type it however you'd say it â€” "2 loaves of bread" sorts itself
        out.
      </p>
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="space-y-4 py-4" role="status" aria-live="polite">
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

