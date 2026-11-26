import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Check, Sparkles, X } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useScrollLock } from '@/hooks/useScrollLock'
import { CURRENT_VERSION, LAST_SEEN_VERSION_KEY, PATCH_NOTES } from '@/lib/changelog'
import { readLocal, writeLocal } from '@/lib/storage'

const AUTH_PATHS = new Set([
  '/signin',
  '/signup',
  '/forgot-password',
  '/update-password',
  '/confirm',
  '/patch-notes',
])

/**
 * Lightweight "What's new" card shown once after Larder updates to a new
 * version. Clicking anywhere outside on the backdrop, pressing Escape, or
 * tapping Got it / × dismisses it immediately so it never gets in the way of
 * shopping.
 */
export function WhatsNewModal() {
  const { status } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  const latest = PATCH_NOTES[0]

  useEffect(() => {
    if (status !== 'signed-in') {
      setOpen(false)
      return
    }
    if (AUTH_PATHS.has(location.pathname)) return

    const seen = readLocal(LAST_SEEN_VERSION_KEY)
    if (seen === CURRENT_VERSION) return

    const timer = setTimeout(() => setOpen(true), 450)
    return () => clearTimeout(timer)
  }, [status, location.pathname])

  function dismiss() {
    writeLocal(LAST_SEEN_VERSION_KEY, CURRENT_VERSION)
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') dismiss()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  useScrollLock(open)

  if (!open || !latest) return null

  return (
    <div className="safe-x fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      {/* Clicking anywhere outside the card dismisses immediately. */}
      <button
        type="button"
        aria-label="Dismiss what's new"
        className="animate-backdrop-in absolute inset-0 cursor-default bg-black/40 backdrop-blur-[2px]"
        onClick={dismiss}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        className="safe-bottom animate-sheet-in scroll-y relative max-h-[calc(100dvh-1rem)] w-full max-w-md rounded-t-3xl bg-white p-4 shadow-2xl min-[380px]:p-5 sm:m-3 sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl dark:bg-larder-900"
      >
        <div
          aria-hidden
          className="mx-auto mb-3 h-1 w-9 rounded-full bg-larder-300 dark:bg-larder-700 sm:hidden"
        />

        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-larder-100 text-larder-700 dark:bg-larder-800 dark:text-larder-300">
              <Sparkles className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <h2
                  id="whats-new-title"
                  className="text-base font-semibold text-larder-950 dark:text-larder-50"
                >
                  What’s new in Larder
                </h2>
                <span className="rounded-full bg-larder-100 px-2 py-0.5 text-[11px] font-semibold text-larder-700 dark:bg-larder-800 dark:text-larder-300">
                  v{latest.version}
                </span>
              </div>
              <p className="text-xs text-larder-600 dark:text-larder-400">{latest.title}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={dismiss}
            className="tap -mr-2 -mt-1 shrink-0 rounded-xl text-larder-500 hover:text-larder-800 dark:hover:text-larder-200"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <ul className="mt-4 space-y-2.5 text-sm text-larder-800 dark:text-larder-200">
          {latest.highlights.map((point) => (
            <li key={point} className="flex items-start gap-2.5">
              <Check
                className="mt-1 h-4 w-4 shrink-0 text-larder-600 dark:text-larder-400"
                strokeWidth={2.5}
                aria-hidden
              />
              <span className="leading-snug">{point}</span>
            </li>
          ))}
        </ul>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              dismiss()
              navigate('/patch-notes')
            }}
            className="btn-ghost px-3 text-xs font-medium"
          >
            All patch notes
          </button>
          <button type="button" onClick={dismiss} className="btn-primary min-w-[7rem] flex-1 sm:flex-none">
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}
