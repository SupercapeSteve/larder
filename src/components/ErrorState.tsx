import { AlertTriangle, RefreshCw } from 'lucide-react'

export function ErrorState({
  title,
  message,
  onRetry,
}: {
  title: string
  message: string
  onRetry?: () => void
}) {
  return (
    <div className="safe-top safe-bottom safe-x flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">
        <AlertTriangle className="h-6 w-6" aria-hidden />
      </div>
      <h2 className="text-lg font-semibold text-larder-950 dark:text-larder-50">{title}</h2>
      <p className="mt-1.5 max-w-sm text-sm text-larder-600 dark:text-larder-400">{message}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="btn-primary mt-6 gap-2">
          <RefreshCw className="h-4 w-4" aria-hidden />
          Try again
        </button>
      ) : null}
    </div>
  )
}
