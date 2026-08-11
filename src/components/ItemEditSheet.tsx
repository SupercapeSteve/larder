import { useEffect, useRef, useState } from 'react'
import { Trash2, X } from 'lucide-react'
import { TextField } from '@/components/ui'
import { useScrollLock } from '@/hooks/useScrollLock'
import { CATEGORIES, CATEGORY_EMOJI, toCategory } from '@/lib/categories'
import type { Item } from '@/types/database'
import type { ItemEdits } from '@/hooks/useItems'

type ItemEditSheetProps = {
  item: Item | null
  onSave: (item: Item, edits: ItemEdits) => void
  onDelete: (item: Item) => void
  onClose: () => void
}

export function ItemEditSheet({ item, onSave, onDelete, onClose }: ItemEditSheetProps) {
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('')
  const [category, setCategory] = useState<string>('Other')
  const [note, setNote] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!item) return
    setName(item.name)
    setQuantity(item.quantity ?? '')
    setCategory(toCategory(item.category))
    setNote(item.note ?? '')
    setNameError(null)
    // Do not autofocus: on iOS that yanks the keyboard up over the sheet the
    // instant it opens, hiding the fields the user was aiming for.
  }, [item])

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

  function save() {
    if (!item) return
    const trimmed = name.trim()
    if (trimmed.length === 0) {
      setNameError('An item needs a name.')
      nameRef.current?.focus()
      return
    }
    onSave(item, {
      name: trimmed.slice(0, 200),
      quantity: quantity.trim().length > 0 ? quantity.trim() : null,
      category,
      note: note.trim().length > 0 ? note.trim() : null,
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
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
        className="safe-bottom animate-sheet-in scroll-y relative max-h-[85vh] w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl dark:bg-larder-900 sm:m-3 sm:rounded-2xl"
      >
        {/* Reads as a bottom sheet at a glance, and marks the drag affordance
            people instinctively reach for. */}
        <div
          aria-hidden
          className="mx-auto mb-4 h-1 w-9 rounded-full bg-larder-300 dark:bg-larder-700 sm:hidden"
        />

        <div className="mb-4 flex items-center justify-between">
          <h2 id="edit-item-title" className="text-lg font-semibold text-larder-950 dark:text-larder-50">
            Edit item
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="tap -mr-2 rounded-xl text-larder-500"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="space-y-4">
          <TextField
            ref={nameRef}
            label="Name"
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
            error={nameError}
          />

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

          <TextField
            label="Note"
            placeholder="The oat one, not the almond one"
            value={note}
            maxLength={200}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div className="mt-6 flex gap-2">
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
          <button type="button" onClick={save} className="btn-primary flex-1">
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
