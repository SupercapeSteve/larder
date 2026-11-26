import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Check, Search, Trash2, UtensilsCrossed, X } from 'lucide-react'
import { TextField } from '@/components/ui'
import { useScrollLock } from '@/hooks/useScrollLock'
import { CATEGORY_EMOJI, toCategory } from '@/lib/categories'
import {
  DEFAULT_SUBLIST_EMOJI,
  UNIQUE_SUBLIST_EMOJIS,
  suggestSublistEmoji,
} from '@/lib/sublists'
import { splitIntoItems } from '@/lib/parseItem'
import type { Item, Sublist } from '@/types/database'

export type SublistFormSubmit = {
  name: string
  emoji: string
  note: string | null
  /** Raw ingredient lines/phrases to create (or match) and attach on creation. */
  rawIngredients: string[]
  /** IDs of existing main-list items that should belong to this sub-list. */
  selectedItemIds: Set<string>
}

type SublistSheetProps = {
  open: boolean
  /** Null when creating a new sub-list; populated when editing an existing one. */
  sublist: Sublist | null
  allItems: readonly Item[]
  /** Item IDs currently linked to `sublist` (empty when creating). */
  linkedItemIds: ReadonlySet<string>
  onSave: (payload: SublistFormSubmit) => void
  onDelete?: (sublist: Sublist, alsoDeleteItems: boolean) => void
  onClose: () => void
}

/**
 * Create or manage a sub-list (dinner recipe, meal plan, party prep).
 *
 * Items added or ticked here always live on the household's main list too, so
 * you can plan by dish at home and still walk each supermarket aisle once.
 */
export function SublistSheet({
  open,
  sublist,
  allItems,
  linkedItemIds,
  onSave,
  onDelete,
  onClose,
}: SublistSheetProps) {
  const [name, setName] = useState('')
  const [customEmoji, setCustomEmoji] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [ingredientsText, setIngredientsText] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [itemFilter, setItemFilter] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [confirmDeleteMode, setConfirmDeleteMode] = useState(false)

  const nameRef = useRef<HTMLInputElement>(null)

  useScrollLock(open)

  useEffect(() => {
    if (!open) return
    if (sublist) {
      setName(sublist.name)
      setCustomEmoji(sublist.emoji ?? DEFAULT_SUBLIST_EMOJI)
      setNote(sublist.note ?? '')
      setSelectedIds(new Set(linkedItemIds))
    } else {
      setName('')
      setCustomEmoji(null)
      setNote('')
      setSelectedIds(new Set())
    }
    setIngredientsText('')
    setItemFilter('')
    setNameError(null)
    setConfirmDeleteMode(false)
  }, [open, sublist, linkedItemIds])

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const activeEmoji = customEmoji ?? suggestSublistEmoji(name)

  const parsedPreview = useMemo(
    () => (ingredientsText.trim().length > 0 ? splitIntoItems(ingredientsText) : []),
    [ingredientsText],
  )

  const filteredExisting = useMemo(() => {
    const q = itemFilter.trim().toLowerCase()
    const base = [...allItems].sort((a, b) => a.name.localeCompare(b.name))
    if (q.length === 0) return base
    return base.filter((i) => i.name.toLowerCase().includes(q))
  }, [allItems, itemFilter])

  if (!open) return null

  function toggleExisting(itemId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = name.trim()
    if (trimmed.length === 0) {
      setNameError('Give this sub-list a name — e.g. "Taco Tuesday".')
      nameRef.current?.focus()
      return
    }
    onSave({
      name: trimmed.slice(0, 80),
      emoji: activeEmoji,
      note: note.trim().length > 0 ? note.trim().slice(0, 200) : null,
      rawIngredients: parsedPreview,
      selectedItemIds: selectedIds,
    })
    onClose()
  }

  return (
    <div className="safe-x fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close"
        className="animate-backdrop-in absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sublist-sheet-title"
        className="safe-bottom animate-sheet-in scroll-y relative max-h-[calc(100dvh-0.75rem)] w-full max-w-lg rounded-t-3xl bg-white p-4 shadow-2xl dark:bg-larder-900 min-[380px]:p-5 sm:m-3 sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl"
      >
        <div
          aria-hidden
          className="mx-auto mb-3 h-1 w-9 rounded-full bg-larder-300 dark:bg-larder-700 sm:hidden"
        />

        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2
              id="sublist-sheet-title"
              className="flex items-center gap-2 text-lg font-semibold text-larder-950 dark:text-larder-50"
            >
              <UtensilsCrossed
                className="h-5 w-5 shrink-0 text-larder-600 dark:text-larder-400"
                aria-hidden
              />
              <span className="truncate">{sublist ? 'Edit sub-list' : 'New sub-list'}</span>
            </h2>
            <p className="mt-0.5 text-xs text-larder-600 dark:text-larder-400">
              Track ingredients for a recipe, dinner plan or trip. Everything stays on the main list too.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="tap -mr-2 -mt-1 shrink-0 rounded-xl text-larder-500"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextField
              ref={nameRef}
              label="Dish or plan name"
              placeholder="Pasta Carbonara, Taco night…"
              value={name}
              maxLength={80}
              onChange={(e) => {
                setName(e.target.value)
                if (nameError) setNameError(null)
              }}
              error={nameError}
              required
            />

            <TextField
              label="Note (optional)"
              placeholder="Friday dinner · serves 4"
              value={note}
              maxLength={200}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {/* ── Icon picker ───────────────────────────────────────────────── */}
          <fieldset>
            <legend className="mb-1.5 text-xs font-medium text-larder-700 dark:text-larder-300">
              Icon
            </legend>
            <div
              className="flex flex-wrap gap-1.5"
              role="radiogroup"
              aria-label="Sub-list icon"
            >
              {UNIQUE_SUBLIST_EMOJIS.map((emoji) => {
                const selected = activeEmoji === emoji
                return (
                  <button
                    key={emoji}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={`Icon ${emoji}`}
                    onClick={() => setCustomEmoji(emoji)}
                    className={`flex h-10 w-10 items-center justify-center rounded-xl text-lg transition-colors ${
                      selected
                        ? 'bg-larder-600 text-white ring-2 ring-larder-600 ring-offset-1 ring-offset-white dark:bg-larder-500 dark:ring-larder-400 dark:ring-offset-larder-900'
                        : 'bg-larder-100 hover:bg-larder-200 dark:bg-larder-800 dark:hover:bg-larder-700'
                    }`}
                  >
                    <span aria-hidden>{emoji}</span>
                  </button>
                )
              })}
            </div>
          </fieldset>

          {/* ── Quick recipe batch-add ────────────────────────────────────── */}
          <div className="space-y-1.5">
            <label
              htmlFor="sublist-ingredients"
              className="block text-sm font-medium text-larder-800 dark:text-larder-200"
            >
              {sublist ? 'Add more ingredients' : 'Recipe ingredients (optional)'}
            </label>
            <textarea
              id="sublist-ingredients"
              rows={2}
              value={ingredientsText}
              onChange={(e) => setIngredientsText(e.target.value)}
              placeholder="400g spaghetti, guanciale, pecorino, 6 eggs…"
              className="field min-h-[68px] resize-y py-2.5 text-sm leading-snug"
            />
            <p className="text-xs text-larder-600 dark:text-larder-400">
              {parsedPreview.length > 0
                ? `Will add or link ${parsedPreview.length} ${parsedPreview.length === 1 ? 'item' : 'items'}, sorted by aisle.`
                : 'Separate with commas or new lines — quantities like "500g flour" sort themselves out, or add items one by one afterwards.'}
            </p>
          </div>

          {/* ── Include existing main-list items ──────────────────────────── */}
          {allItems.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-larder-800 dark:text-larder-200">
                  Items already on your main list
                </span>
                <span className="text-xs text-larder-500">
                  {selectedIds.size} selected
                </span>
              </div>

              {allItems.length > 5 ? (
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-larder-400"
                    aria-hidden
                  />
                  <input
                    type="search"
                    value={itemFilter}
                    onChange={(e) => setItemFilter(e.target.value)}
                    placeholder="Filter existing items…"
                    aria-label="Filter existing items"
                    className="field py-2 pl-9 text-sm"
                  />
                </div>
              ) : null}

              <ul className="scroll-y max-h-40 divide-y divide-larder-100 rounded-xl border border-larder-200 bg-larder-50/50 dark:divide-larder-800 dark:border-larder-800 dark:bg-larder-950/40">
                {filteredExisting.map((item) => {
                  const included = selectedIds.has(item.id)
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => toggleExisting(item.id)}
                        aria-pressed={included}
                        className="flex min-h-tap w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-larder-100/70 dark:hover:bg-larder-800/50"
                      >
                        <span
                          aria-hidden
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                            included
                              ? 'border-larder-600 bg-larder-600 text-white dark:border-larder-400 dark:bg-larder-400 dark:text-larder-950'
                              : 'border-larder-300 dark:border-larder-600'
                          }`}
                        >
                          {included ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
                        </span>
                        <span aria-hidden className="shrink-0 text-sm">
                          {CATEGORY_EMOJI[toCategory(item.category)]}
                        </span>
                        <span
                          className={`min-w-0 flex-1 truncate ${
                            item.checked ? 'line-through opacity-50' : 'text-larder-950 dark:text-larder-50'
                          }`}
                        >
                          {item.name}
                        </span>
                        {item.quantity ? (
                          <span className="shrink-0 rounded bg-larder-200/70 px-1.5 py-0.5 text-xs text-larder-700 dark:bg-larder-800 dark:text-larder-300">
                            {item.quantity}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  )
                })}
                {filteredExisting.length === 0 ? (
                  <li className="px-3 py-4 text-center text-xs text-larder-500">
                    Nothing matches “{itemFilter}”.
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}

          {/* ── Delete controls when editing ──────────────────────────────── */}
          {sublist && onDelete ? (
            confirmDeleteMode ? (
              <div className="space-y-2 rounded-2xl border border-red-200 bg-red-50/70 p-3 dark:border-red-900/70 dark:bg-red-950/30">
                <p className="text-xs font-medium text-red-900 dark:text-red-200">
                  Remove “{sublist.name}”? Choose what happens to its items on the main list:
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => {
                      onDelete(sublist, false)
                      onClose()
                    }}
                    className="btn-secondary flex-1 text-xs font-semibold text-red-700 dark:text-red-300"
                  >
                    Remove plan, keep items
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onDelete(sublist, true)
                      onClose()
                    }}
                    className="btn-danger flex-1 text-xs"
                  >
                    Remove plan &amp; its items
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteMode(false)}
                  className="btn-ghost w-full text-xs"
                >
                  Cancel
                </button>
              </div>
            ) : null
          ) : null}

          <div className="flex flex-wrap gap-2 pt-1">
            {sublist && onDelete && !confirmDeleteMode ? (
              <button
                type="button"
                onClick={() => setConfirmDeleteMode(true)}
                className="btn-secondary shrink-0 gap-2 text-red-600 dark:text-red-400"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                Remove
              </button>
            ) : null}
            <button type="submit" className="btn-primary min-w-[8rem] flex-1">
              {sublist ? 'Save changes' : 'Create sub-list'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
