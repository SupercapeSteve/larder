import { useEffect, useRef, useState } from 'react'
import { Check, Plus, Trash2, X } from 'lucide-react'
import { TextField } from '@/components/ui'
import { useScrollLock } from '@/hooks/useScrollLock'
import { CATEGORIES, CATEGORY_EMOJI, toCategory } from '@/lib/categories'
import { DEFAULT_SUBLIST_EMOJI } from '@/lib/sublists'
import type { Item, Sublist } from '@/types/database'
import type { ItemEdits } from '@/hooks/useItems'

type ItemEditSheetProps = {
  item: Item | null
  sublists?: readonly Sublist[]
  itemSublistIds?: ReadonlySet<string>
  onSave: (item: Item, edits: ItemEdits, nextSublistIds?: ReadonlySet<string>) => void
  onDelete: (item: Item) => void
  onNewSublist?: (forItem: Item) => void
  onClose: () => void
}

export function ItemEditSheet({
  item,
  sublists = [],
  itemSublistIds,
  onSave,
  onDelete,
  onNewSublist,
  onClose,
}: ItemEditSheetProps) {
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('')
  const [category, setCategory] = useState<string>('Other')
  const [note, setNote] = useState('')
  const [selectedSublists, setSelectedSublists] = useState<Set<string>>(new Set())
  const [nameError, setNameError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!item) return
    setName(item.name)
    setQuantity(item.quantity ?? '')
    setCategory(toCategory(item.category))
    setNote(item.note ?? '')
    setSelectedSublists(new Set(itemSublistIds ?? []))
    setNameError(null)
    // Do not autofocus: on iOS that yanks the keyboard up over the sheet the
    // instant it opens, hiding the fields the user was aiming for.
  }, [item, itemSublistIds])

  useEffect(() => {
    if (!item) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [item, onClose])

  useScrollLock(item !== null)

  if (!item) return null

  function toggleSublist(sublistId: string) {
    setSelectedSublists((prev) => {
      const next = new Set(prev)
      if (next.has(sublistId)) next.delete(sublistId)
      else next.add(sublistId)
      return next
    })
  }

  function save() {
    if (!item) return
    const trimmed = name.trim()
    if (trimmed.length === 0) {
      setNameError('An item needs a name.')
      nameRef.current?.focus()
      return
    }
    onSave(
      item,
      {
        name: trimmed.slice(0, 200),
        quantity: quantity.trim().length > 0 ? quantity.trim() : null,
        category,
        note: note.trim().length > 0 ? note.trim() : null,
      },
      selectedSublists,
    )
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
        aria-labelledby="edit-item-title"
        className="safe-bottom animate-sheet-in scroll-y relative max-h-[calc(100dvh-0.75rem)] w-full max-w-md rounded-t-3xl bg-white p-4 shadow-2xl dark:bg-larder-900 min-[380px]:p-5 sm:m-3 sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl"
      >
        {/* Reads as a bottom sheet at a glance, and marks the drag affordance
            people instinctively reach for. */}
        <div
          aria-hidden
          className="mx-auto mb-3 h-1 w-9 rounded-full bg-larder-300 dark:bg-larder-700 sm:hidden"
        />

        <div className="mb-3 flex items-center justify-between gap-2">
          <h2
            id="edit-item-title"
            className="truncate text-lg font-semibold text-larder-950 dark:text-larder-50"
          >
            Edit item
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="tap -mr-2 shrink-0 rounded-xl text-larder-500"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="space-y-3.5">
          <TextField
            ref={nameRef}
            label="Name"
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
            error={nameError}
          />

          <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2">
            <TextField
              label="Quantity"
              placeholder="2, 500g, a bunch…"
              value={quantity}
              maxLength={40}
              onChange={(e) => setQuantity(e.target.value)}
            />

            <div className="space-y-1.5">
              <label
                htmlFor="edit-category"
                className="block text-sm font-medium text-larder-800 dark:text-larder-200"
              >
                Aisle
              </label>
              <select
                id="edit-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="field"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_EMOJI[c]} {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <TextField
            label="Note"
            placeholder="The oat one, not the almond one"
            value={note}
            maxLength={200}
            onChange={(e) => setNote(e.target.value)}
          />

          {/* ── Sub-list assignment ───────────────────────────────────────── */}
          {sublists.length > 0 || onNewSublist ? (
            <div className="space-y-1.5">
              <span className="block text-sm font-medium text-larder-800 dark:text-larder-200">
                Sub-lists &amp; dishes
              </span>
              <div className="flex flex-wrap gap-1.5">
                {sublists.map((sublist) => {
                  const active = selectedSublists.has(sublist.id)
                  return (
                    <button
                      key={sublist.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleSublist(sublist.id)}
                      className={`inline-flex min-h-[38px] max-w-full items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors ${
                        active
                          ? 'border-larder-600 bg-larder-600 text-white dark:border-larder-400 dark:bg-larder-500 dark:text-larder-950'
                          : 'border-larder-200 bg-larder-50 text-larder-800 hover:bg-larder-100 dark:border-larder-700 dark:bg-larder-800/70 dark:text-larder-200'
                      }`}
                    >
                      <span aria-hidden>{sublist.emoji ?? DEFAULT_SUBLIST_EMOJI}</span>
                      <span className="truncate">{sublist.name}</span>
                      {active ? <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={3} aria-hidden /> : null}
                    </button>
                  )
                })}
                {onNewSublist ? (
                  <button
                    type="button"
                    onClick={() => {
                      const target = item
                      onClose()
                      onNewSublist(target)
                    }}
                    className="inline-flex min-h-[38px] items-center gap-1 rounded-xl border border-dashed border-larder-300 px-3 py-1.5 text-xs font-medium text-larder-600 hover:bg-larder-100 dark:border-larder-700 dark:text-larder-400 dark:hover:bg-larder-800"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                    New dish
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              onDelete(item)
              onClose()
            }}
            className="btn-secondary shrink-0 gap-2 text-red-600 dark:text-red-400"
            aria-label={`Delete ${item.name}`}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            Delete
          </button>
          <button type="button" onClick={save} className="btn-primary min-w-[7rem] flex-1">
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
