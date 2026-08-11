import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { X } from 'lucide-react'

export type ToastAction = {
  label: string
  onAct: () => void
}

export type ToastOptions = {
  message: string
  /** Optional single action, e.g. Undo. */
  action?: ToastAction
  /** Milliseconds before auto-dismiss. Default 5000 — long enough to hit Undo. */
  durationMs?: number
  tone?: 'neutral' | 'error'
}

type Toast = ToastOptions & { id: number }

type ToastContextValue = {
  showToast: (options: ToastOptions) => void
  dismissToast: () => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const dismissToast = useCallback(() => {
    clearTimer()
    setToast(null)
  }, [clearTimer])

  const showToast = useCallback(
    (options: ToastOptions) => {
      clearTimer()
      const id = nextId++
      setToast({ ...options, id })
      timerRef.current = setTimeout(() => {
        setToast((current) => (current?.id === id ? null : current))
        timerRef.current = null
      }, options.durationMs ?? 5000)
    },
    [clearTimer],
  )

  useEffect(() => clearTimer, [clearTimer])

  const value = useMemo(() => ({ showToast, dismissToast }), [showToast, dismissToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast ? (
        <div
          className="safe-bottom pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-4"
          role="status"
          aria-live="polite"
        >
          <div
            className={`animate-toast-in pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-2xl px-4 py-3 shadow-lg ${
              toast.tone === 'error'
                ? 'bg-red-700 text-white'
                : 'bg-larder-900 text-larder-50 dark:bg-larder-100 dark:text-larder-950'
            }`}
          >
            <span className="min-w-0 flex-1 truncate text-sm">{toast.message}</span>

            {toast.action ? (
              <button
                type="button"
                className="tap shrink-0 rounded-lg px-3 text-sm font-semibold underline underline-offset-2"
                onClick={() => {
                  const act = toast.action?.onAct
                  dismissToast()
                  act?.()
                }}
              >
                {toast.action.label}
              </button>
            ) : null}

            <button
              type="button"
              className="tap shrink-0 rounded-lg opacity-70 hover:opacity-100"
              onClick={dismissToast}
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      ) : null}
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
