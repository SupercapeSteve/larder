import { CloudOff, RefreshCw, Wifi } from 'lucide-react'
import type { ConnectionStatus } from '@/hooks/useRealtimeItems'

const LABELS: Record<ConnectionStatus, string> = {
  connecting: 'Connecting',
  connected: 'Live',
  reconnecting: 'Reconnecting',
  offline: 'Offline',
}

export function ConnectionIndicator({ status }: { status: ConnectionStatus }) {
  const label = LABELS[status]

  if (status === 'connected') {
    return (
      <span
        className="flex items-center gap-1 text-xs font-medium text-larder-600 dark:text-larder-400"
        title="Changes appear here as they happen"
      >
        <span className="relative flex h-2 w-2" aria-hidden>
          <span className="absolute inline-flex h-full w-full rounded-full bg-larder-500 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-larder-500" />
        </span>
        <span className="sr-only">Connection status: </span>
        {label}
      </span>
    )
  }

  const isOffline = status === 'offline'

  return (
    <span
      role="status"
      className={`flex items-center gap-1 text-xs font-medium ${
        isOffline ? 'text-amber-700 dark:text-amber-400' : 'text-larder-500 dark:text-larder-400'
      }`}
    >
      {isOffline ? (
        <CloudOff className="h-3.5 w-3.5" aria-hidden />
      ) : status === 'reconnecting' ? (
        <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : (
        <Wifi className="h-3.5 w-3.5" aria-hidden />
      )}
      <span className="sr-only">Connection status: </span>
      {label}
    </span>
  )
}
