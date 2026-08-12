import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Sparkles, Trash2, Wand2 } from 'lucide-react'
import { AppShell } from '@/components/AppShell'
import { FullPageSpinner } from '@/components/ui'
import { ErrorState } from '@/components/ErrorState'
import { SettingsSection } from '@/components/settings'
import { useToast } from '@/components/Toast'
import { useDefaultList, useHouseholds } from '@/hooks/useHouseholds'
import { useItems, useUpdateItem } from '@/hooks/useItems'
import {
  useCategoryRules,
  useDeleteCategoryRule,
  useSaveCategoryRule,
} from '@/hooks/useCategoryRules'
import { useRealtimeProfiles } from '@/hooks/useRealtimeProfiles'
import {
  CATEGORIES,
  CATEGORY_DESCRIPTION,
  CATEGORY_EMOJI,
  CATEGORY_ORDER,
  toCategory,
  type Category,
} from '@/lib/categories'
import { can } from '@/lib/permissions'
import type { Item } from '@/types/database'

/**
 * Every aisle, what is currently filed in it, and the household's learned
 * corrections. Moving an item here also teaches the rule, so the same product
 * lands correctly next time instead of needing the same fix every shop.
 */
export default function Aisles() {
  const { householdId } = useParams<{ householdId: string }>()
  const { showToast } = useToast()

  const householdsQuery = useHouseholds()
  const { list, isPending: listPending } = useDefaultList(householdId)
  const itemsQuery = useItems(list?.id)
  const rulesQuery = useCategoryRules(householdId)
  const updateItem = useUpdateItem(list?.id ?? '')
  const saveRule = useSaveCategoryRule(householdId ?? '')
  const deleteRule = useDeleteCategoryRule(householdId ?? '')
  useRealtimeProfiles(householdId)

  const [moving, setMoving] = useState<Item | null>(null)

  const household = householdsQuery.data?.find((h) => h.id === householdId)
  const items = itemsQuery.data ?? []
  const rules = rulesQuery.data ?? []

  const grouped = useMemo(() => {
    const map = new Map<Category, Item[]>()
    for (const item of items) {
      const category = toCategory(item.category)
      const bucket = map.get(category)
      if (bucket) bucket.push(item)
      else map.set(category, [item])
    }
    return map
  }, [items])

  if (householdsQuery.isPending || listPending || itemsQuery.isPending) {
    return <FullPageSpinner label="Loading aisles" />
  }

  if (!household || !list) {
    return (
      <ErrorState
        title="Household not found"
        message="You're not a member of this household, or it no longer exists."
      />
    )
  }

  const canEdit = can(household.role, 'editItems')

  function move(item: Item, category: Category) {
    setMoving(null)
    if (toCategory(item.category) === category) return

    updateItem.mutate(
      {
        item,
        edits: {
          name: item.name,
          quantity: item.quantity,
          category,
          note: item.note,
        },
      },
      {
        onError: (error) => showToast({ message: (error as Error).message, tone: 'error' }),
      },
    )

    // Teach the household, keyed on this item's own name — so "red tortilla
    // chips" is filed as a snack without claiming every tortilla is one.
    saveRule.mutate(
      { keyword: item.name, category },
      {
        onSuccess: () =>
          showToast({
            message: `Moved to ${category}. "${item.name}" will go there from now on.`,
          }),
        onError: () =>
          showToast({ message: `Moved to ${category}, but couldn't save the rule.`, tone: 'error' }),
      },
    )
  }

  const usedCategories = CATEGORIES.filter((c) => (grouped.get(c)?.length ?? 0) > 0).sort(
    (a, b) => CATEGORY_ORDER[a] - CATEGORY_ORDER[b],
  )

  return (
    <AppShell
      header={
        <div className="flex min-h-tap items-center gap-1 py-3">
          <Link
            to={`/h/${householdId}`}
            className="tap -ml-2 rounded-xl text-larder-700 dark:text-larder-300"
            aria-label="Back to the list"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Link>
          <h1 className="text-lg font-semibold tracking-tight">Aisles</h1>
        </div>
      }
    >
      <div className="space-y-6 py-4 pb-12">
        {items.length === 0 ? (
          <p className="card px-4 py-8 text-center text-sm text-larder-600 dark:text-larder-400">
            Nothing on the list yet. Add something and it'll show up here, sorted into an aisle.
          </p>
        ) : (
          <SettingsSection
            title={`${items.length} ${items.length === 1 ? 'item' : 'items'}`}
            description={
              canEdit
                ? 'Tap an item to move it. Larder remembers where you put it.'
                : 'You have view-only access, so these cannot be changed.'
            }
          >
            {usedCategories.map((category) => (
              <div key={category} className="px-4 py-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-larder-800 dark:text-larder-200">
                  <span aria-hidden>{CATEGORY_EMOJI[category]}</span>
                  {category}
                  <span className="font-normal text-larder-500">
                    {grouped.get(category)?.length ?? 0}
                  </span>
                </h3>
                <p className="mt-0.5 text-xs text-larder-500">{CATEGORY_DESCRIPTION[category]}</p>

                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {(grouped.get(category) ?? []).map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        disabled={!canEdit}
                        onClick={() => setMoving(item)}
                        className="tap rounded-xl bg-larder-100 px-3 text-sm text-larder-900 disabled:opacity-60 dark:bg-larder-800 dark:text-larder-100"
                        aria-label={canEdit ? `Move ${item.name} to another aisle` : item.name}
                      >
                        {item.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </SettingsSection>
        )}

        {/* ── Learned rules ─────────────────────────────────────────────── */}
        <SettingsSection
          title="Learned rules"
          description="Corrections this household has taught Larder. These beat the built-in guesses."
        >
          {rules.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-larder-600 dark:text-larder-400">
              None yet. Move an item to a different aisle and the rule appears here.
            </p>
          ) : (
            rules.map((rule) => (
              <div key={rule.keyword} className="flex items-center gap-3 px-4 py-3">
                <Sparkles className="h-4 w-4 shrink-0 text-larder-400" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-larder-950 dark:text-larder-50">
                    “{rule.keyword}”
                  </span>
                  <span className="text-xs text-larder-600 dark:text-larder-400">
                    → {CATEGORY_EMOJI[toCategory(rule.category)]} {toCategory(rule.category)}
                  </span>
                </span>
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() =>
                      deleteRule.mutate(rule.keyword, {
                        onSuccess: () => showToast({ message: 'Rule removed.' }),
                        onError: (error) =>
                          showToast({ message: (error as Error).message, tone: 'error' }),
                      })
                    }
                    className="tap shrink-0 rounded-xl text-red-600 dark:text-red-400"
                    aria-label={`Forget the rule for ${rule.keyword}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                ) : null}
              </div>
            ))
          )}
        </SettingsSection>
      </div>

      {/* ── Move sheet ──────────────────────────────────────────────────── */}
      {moving ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <button
            type="button"
            aria-label="Cancel"
            className="animate-backdrop-in absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            onClick={() => setMoving(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Move ${moving.name}`}
            className="safe-bottom animate-sheet-in scroll-y relative max-h-[80vh] w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl dark:bg-larder-900 sm:m-3 sm:rounded-2xl"
          >
            <div
              aria-hidden
              className="mx-auto mb-4 h-1 w-9 rounded-full bg-larder-300 dark:bg-larder-700 sm:hidden"
            />
            <h2 className="text-lg font-semibold text-larder-950 dark:text-larder-50">
              Move “{moving.name}”
            </h2>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-larder-600 dark:text-larder-400">
              <Wand2 className="h-3.5 w-3.5" aria-hidden />
              Larder will remember this for next time.
            </p>

            <div className="mt-4 grid grid-cols-2 gap-2">
              {CATEGORIES.map((category) => {
                const current = toCategory(moving.category) === category
                return (
                  <button
                    key={category}
                    type="button"
                    onClick={() => move(moving, category)}
                    className={`tap justify-start gap-2 rounded-xl border px-3 text-sm ${
                      current
                        ? 'border-larder-600 bg-larder-100 font-semibold dark:border-larder-400 dark:bg-larder-800'
                        : 'border-larder-200 dark:border-larder-700'
                    }`}
                  >
                    <span aria-hidden>{CATEGORY_EMOJI[category]}</span>
                    {category}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  )
}
