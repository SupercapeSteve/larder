import { useRef, useState, type FormEvent } from 'react'
import { Plus } from 'lucide-react'
import { parseItemInput } from '@/lib/parseItem'
import { categorise, CATEGORY_EMOJI } from '@/lib/categories'

/**
 * The bar that lives above the keyboard.
 *
 * Submitting keeps focus in the field, because the realistic use is standing in
 * a shop typing four things in a row. Losing focus after each one turns that
 * into eight taps instead of four.
 */
export function AddItemBar({ onAdd, disabled }: { onAdd: (raw: string) => void; disabled?: boolean }) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const preview = value.trim().length > 1 ? parseItemInput(value) : null
  const previewCategory = preview && preview.name.length > 0 ? categorise(preview.name) : null

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const raw = value.trim()
    if (raw.length === 0) return

    onAdd(raw)
    setValue('')
    // Refocus explicitly: iOS drops focus on some form submissions, which
    // dismisses the keyboard and breaks rapid entry.
    inputRef.current?.focus()
  }

  return (
    <form onSubmit={submit} className="py-2">
      {preview && previewCategory && preview.quantity ? (
        <p className="px-1 pb-1.5 text-xs text-larder-600 dark:text-larder-400" aria-live="polite">
          {CATEGORY_EMOJI[previewCategory]} {previewCategory} ·{' '}
          <span className="font-medium">{preview.quantity}</span> × {preview.name}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <label htmlFor="add-item" className="sr-only">
          Add an item
        </label>
        <input
          ref={inputRef}
          id="add-item"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Add an item…"
          autoComplete="off"
          autoCorrect="on"
          autoCapitalize="sentences"
          enterKeyHint="done"
          maxLength={220}
          disabled={disabled}
          className="field flex-1"
        />
        <button
          type="submit"
          disabled={disabled || value.trim().length === 0}
          className="btn-primary shrink-0 px-0"
          style={{ width: 48 }}
          aria-label="Add item"
        >
          <Plus className="h-5 w-5" aria-hidden />
        </button>
      </div>
    </form>
  )
}
