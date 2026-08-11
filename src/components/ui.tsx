import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'

/* ── Text field ───────────────────────────────────────────────────────────── */

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string
  hint?: string
  error?: string | null
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, id, ...props },
  ref,
) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const describedBy = [hint ? `${inputId}-hint` : null, error ? `${inputId}-error` : null]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-sm font-medium text-larder-800 dark:text-larder-200">
        {label}
      </label>
      <input
        {...props}
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy.length > 0 ? describedBy : undefined}
        className={`field ${error ? 'border-red-500 dark:border-red-500' : ''} ${props.className ?? ''}`}
      />
      {hint && !error ? (
        <p id={`${inputId}-hint`} className="text-xs text-larder-600 dark:text-larder-400">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${inputId}-error`} className="text-xs font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  )
})

/* ── Inline banners ───────────────────────────────────────────────────────── */

export function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-red-300 bg-red-50 px-3 py-2.5 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/60 dark:text-red-200"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </div>
  )
}

export function SuccessBanner({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-xl border border-larder-300 bg-larder-100 px-3 py-2.5 text-sm text-larder-900 dark:border-larder-700 dark:bg-larder-900 dark:text-larder-100"
    >
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </div>
  )
}

/* ── Spinner ──────────────────────────────────────────────────────────────── */

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} aria-hidden />
}

export function FullPageSpinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex h-full items-center justify-center" role="status" aria-live="polite">
      <Spinner className="h-8 w-8 text-larder-500" />
      <span className="sr-only">{label}</span>
    </div>
  )
}

/* ── Submit button with a built-in busy state ─────────────────────────────── */

export function SubmitButton({
  busy,
  children,
  className = '',
  ...props
}: { busy?: boolean; children: ReactNode } & InputHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      type="submit"
      disabled={busy || props.disabled}
      className={`btn-primary w-full ${className}`}
    >
      {busy ? <Spinner className="mr-2 h-4 w-4" /> : null}
      {children}
    </button>
  )
}
