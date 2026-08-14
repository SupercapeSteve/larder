import { useEffect, useMemo, useState } from 'react'
import { Plus, Search, Trash2, X } from 'lucide-react'
import { useScrollLock } from '@/hooks/useScrollLock'
import { CATEGORY_EMOJI, toCategory } from '@/lib/categories'
import type { Staple } from '@/hooks/usePurchaseHistory'

type StaplesSheetProps = {
  open: boolean
  staples: readonly Staple[]
  /** Lowercased names already on the list, so nothing is offered twice. */
  onList: ReadonlySet<string>
  busy?: boolean
  onAdd: (staple: Staple) => void
  onForget: (nameKey: string) => void
  onClose: () => void
}

/**
 * One-tap re-add of the things this household actually buys.
 *
 * Anything already on the list is shown as such rather than hidden — seeing
 * "on the list" is more reassuring mid-shop than an item quietly missing.
 */
export function StaplesSheet({
  open,
  staples,
  onList,
  busy = false,
  onAdd,
  onForget,
  onClose,
}: StaplesSheetProps) {
  const [query, setQuery] = useState('')
  useScrollLock(open)

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length === 0) return staples
    return staples.filter((s) => s.name.toLowerCase().includes(q))
  }, [staples, query])

  if (!open) return null

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
        aria-labelledby="staples-title"
        className="safe-bottom animate-sheet-in scroll-y relative max-h-[85vh] w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl dark:bg-larder-900 sm:m-3 sm:rounded-2xl"
      >
        <div
          aria-hidden
          className="mx-auto mb-4 h-1 w-9 rounded-full bg-larder-300 dark:bg-larder-700 sm:hidden"
        />

        <div className="mb-3 flex items-center justify-between">
          <h2 id="staples-title" className="text-lg font-semibold text-larder-950 dark:text-larder-50">
            Buy again
          </h2>
          <button type="button" onClick={onClose} className="tap -mr-2 rounded-xl text-larder-500" aria-label="Close">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {staples.length === 0 ? (
          <p className="py-8 text-center text-sm text-larder-600 dark:text-larder-400">
            Nothing yet. Once you tick things off, they show up here for one-tap re-adding.
          </p>
        ) : (
          <>
            <div className="relative mb-3">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-larder-400"
                aria-hidden
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search your regulars…"
                aria-label="Search your regulars"
                className="field pl-9"
              />
            </div>

            <ul className="divide-y divide-larder-100 dark:divide-larder-800">
              {filtered.map((staple) => {
                const already = onList.has(staple.name.toLowerCase().trim())
                return (
                  <li key={staple.nameKey} className="flex items-center gap-3 py-2">
                    <span aria-hidden className="shrink-0 text-base">
                      {CATEGORY_EMOJI[toCategory(staple.category)]}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-larder-950 dark:text-larder-50">
                        {staple.name}
                      </span>
                      <span className="text-xs text-larder-500">
                        bought {staple.timesBought}×
                      </span>
                    </span>

                    {already ? (
                      <span className="shrink-0 text-xs text-larder-500">on the list</span>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onAdd(staple)}
                        className="tap shrink-0 rounded-xl text-larder-600 dark:text-larder-400"
                        aria-label={`Add ${staple.name}`}
                      >
                        <Plus className="h-5 w-5" aria-hidden />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onForget(staple.nameKey)}
                      className="tap shrink-0 rounded-xl text-larder-400"
                      aria-label={`Forget ${staple.name}`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </li>
                )
              })}
              {filtered.length === 0 ? (
                <li className="py-6 text-center text-sm text-larder-600 dark:text-larder-400">
                  Nothing matches “{query}”.
                </li>
              ) : null}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
