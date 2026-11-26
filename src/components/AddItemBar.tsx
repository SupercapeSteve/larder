import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { parseItemInput } from '@/lib/parseItem'
import { useHaptic } from '@/hooks/usePreferences'
import { categorise, CATEGORY_EMOJI, type CategoryRule } from '@/lib/categories'
import { DEFAULT_SUBLIST_EMOJI } from '@/lib/sublists'
import type { Sublist } from '@/types/database'

type AddItemBarProps = {
  onAdd: (raw: string) => void
  disabled?: boolean
  activeSublist?: Sublist | null
  rules?: readonly CategoryRule[]
  /** Compact leading control (e.g. "Buy again") so short landscape viewports
   *  don't burn a second row of footer height. */
  leadingAction?: ReactNode
}

/**
 * The bar that lives above the keyboard.
 *
 * Submitting keeps focus in the field, because the realistic use is standing in
 * a shop typing four things in a row. Losing focus after each one turns that
 * into eight taps instead of four.
 */
export function AddItemBar({
  onAdd,
  disabled,
  activeSublist,
  rules = [],
  leadingAction,
}: AddItemBarProps) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const haptic = useHaptic()

  const multiParts = value
    .split(/[,;\r\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  const preview =
    multiParts.length === 1 && value.trim().length > 1 ? parseItemInput(value) : null
  const previewCategory =
    preview && preview.name.length > 0 ? categorise(preview.name, rules) : null

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const raw = value.trim()
    if (raw.length === 0) return

    onAdd(raw)
    haptic(8)
    setValue('')
    // Refocus explicitly: iOS drops focus on some form submissions, which
    // dismisses the keyboard and breaks rapid entry.
    inputRef.current?.focus()
  }

  const placeholder = activeSublist
    ? `Add to ${activeSublist.emoji ?? DEFAULT_SUBLIST_EMOJI} ${activeSublist.name}…`
    : 'Add an item…'

  return (
    <form onSubmit={submit} className="py-2">
      {multiParts.length > 1 ? (
        <p className="truncate px-1 pb-1.5 text-xs text-larder-600 dark:text-larder-400" aria-live="polite">
          Adding {multiParts.length} items{activeSublist ? ` to ${activeSublist.name}` : ''}
        </p>
      ) : preview && previewCategory && preview.quantity ? (
        <p className="truncate px-1 pb-1.5 text-xs text-larder-600 dark:text-larder-400" aria-live="polite">
          {CATEGORY_EMOJI[previewCategory]} {previewCategory} ·{' '}
          <span className="font-medium">{preview.quantity}</span> × {preview.name}
        </p>
      ) : null}

      <div className="flex min-w-0 items-center gap-1.5 min-[380px]:gap-2">
        {leadingAction}

        <label htmlFor="add-item" className="sr-only">
          {placeholder}
        </label>
        <input
          ref={inputRef}
          id="add-item"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          autoCorrect="on"
          autoCapitalize="sentences"
          enterKeyHint="done"
          maxLength={400}
          disabled={disabled}
          className="field min-w-0 flex-1"
        />
        <button
          type="submit"
          disabled={disabled || value.trim().length === 0}
          className="btn-primary shrink-0 px-0"
          style={{ width: 46 }}
          aria-label="Add item"
        >
          <Plus className="h-5 w-5" aria-hidden />
        </button>
      </div>
    </form>
  )
}
