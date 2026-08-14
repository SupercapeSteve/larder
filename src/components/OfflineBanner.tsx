import { useEffect, useState } from 'react'
import { CloudOff, UploadCloud } from 'lucide-react'
import { useOutbox } from '@/hooks/useOutbox'

/**
 * A shop is exactly where the signal drops. Writes are queued rather than
 * lost, so this reports what is waiting instead of telling people their taps
 * failed.
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

  if (!offline && pending === 0) return null

  const waiting = pending > 0 ? `${pending} ${pending === 1 ? 'change' : 'changes'} waiting` : null

  return (
    <div
      role="status"
      aria-live="polite"
      className={`safe-top fixed inset-x-0 top-0 z-40 px-4 py-1.5 text-center text-xs font-medium ${
        offline ? 'bg-amber-500 text-amber-950' : 'bg-larder-600 text-white'
      }`}
    >
      <span className="inline-flex items-center gap-1.5">
        {offline ? (
          <>
            <CloudOff className="h-3.5 w-3.5" aria-hidden />
            Offline — {waiting ?? 'your changes will be saved when you reconnect'}
          </>
        ) : (
          <>
            <UploadCloud className="h-3.5 w-3.5" aria-hidden />
            Syncing — {waiting}
          </>
        )}
      </span>
    </div>
  )
}
