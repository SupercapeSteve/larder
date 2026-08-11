import { useEffect, useState } from 'react'
import { CloudOff } from 'lucide-react'

/**
 * A shop is exactly where the signal drops. Say so plainly rather than letting
 * every tap fail silently.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine === false : false,
  )

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

  if (!offline) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="safe-top fixed inset-x-0 top-0 z-40 bg-amber-500 px-4 py-1.5 text-center text-xs font-medium text-amber-950"
    >
      <span className="inline-flex items-center gap-1.5">
        <CloudOff className="h-3.5 w-3.5" aria-hidden />
        Offline — changes will not save until you reconnect
      </span>
    </div>
  )
}
