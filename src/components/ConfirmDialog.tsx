import { useEffect, useRef } from 'react'

type ConfirmDialogProps = {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  cancelLabel?: string
  tone?: 'default' | 'danger'
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * A modal that behaves: Escape closes it, focus lands on the confirm button,
 * the backdrop is clickable, and the whole thing is announced as a dialog.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'default',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    confirmRef.current?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onCancel}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        className="safe-bottom animate-slide-up relative m-3 w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl dark:bg-larder-900"
      >
        <h2 id="confirm-title" className="text-lg font-semibold text-larder-950 dark:text-larder-50">
          {title}
        </h2>
        <p id="confirm-body" className="mt-1.5 text-sm text-larder-600 dark:text-larder-400">
          {body}
        </p>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} className="btn-secondary sm:min-w-[6rem]">
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`${tone === 'danger' ? 'btn-danger' : 'btn-primary'} sm:min-w-[6rem]`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
