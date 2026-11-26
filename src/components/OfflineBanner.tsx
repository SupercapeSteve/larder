import { useEffect, useState } from 'react'
import { CloudOff, UploadCloud } from 'lucide-react'
import { useOutbox } from '@/hooks/useOutbox'

/**
 * A shop is exactly where the signal drops. Writes are queued rather than
 * lost, so this reports what is waiting instead of telling people their taps
 * failed.
 *
 * Rendered in normal flex flow above the route shell rather than `fixed` on top
 * of it, so it pushes the header down cleanly instead of obscuring the
 * household title and settings controls.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine === false : false,
  )
  const { pending } = useOutbox()

  useEffect(() => {
    function online() {
      setOffline(false)
    }
    function goneOffline() {
      setOffline(true)
    }
    window.addEventListener('online', online)
    window.addEventListener('offline', goneOffline)
    return () => {
      window.removeEventListener('online', online)
      window.removeEventListener('offline', goneOffline)
    }
  }, [])

  const visible = offline || pending > 0

  useEffect(() => {
    if (visible) {
      document.documentElement.setAttribute('data-top-banner', 'true')
    } else {
      document.documentElement.removeAttribute('data-top-banner')
    }
    return () => document.documentElement.removeAttribute('data-top-banner')
  }, [visible])

  if (!visible) return null

  const waiting = pending > 0 ? `${pending} ${pending === 1 ? 'change' : 'changes'} waiting` : null

  return (
    <div
      role="status"
      aria-live="polite"
      className={`safe-top safe-x shrink-0 px-3 py-1.5 text-center text-xs font-medium ${
        offline ? 'bg-amber-500 text-amber-950' : 'bg-larder-600 text-white'
      }`}
    >
      <span className="inline-flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5">
        {offline ? (
          <>
            <CloudOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>Offline — {waiting ?? 'changes save when you reconnect'}</span>
          </>
        ) : (
          <>
            <UploadCloud className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>Syncing — {waiting}</span>
          </>
        )}
      </span>
    </div>
  )
}
