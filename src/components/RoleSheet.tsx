import { useEffect } from 'react'
import { Check, X } from 'lucide-react'
import { useScrollLock } from '@/hooks/useScrollLock'
import {
  CAPABILITIES,
  ROLES,
  ROLE_LABEL,
  ROLE_SUMMARY,
  can,
  canActOn,
  type Role,
} from '@/lib/permissions'

type RoleSheetProps = {
  open: boolean
  /** Name of the person whose role is being set. */
  personName: string
  current: Role
  /** The role of whoever is doing the changing. */
  actorRole: Role
  busy?: boolean
  onSelect: (role: Role) => void
  onClose: () => void
}

/**
 * Role picker that also explains what each role means. The capability list is
 * the point — "admin" tells somebody nothing on its own.
 */
export function RoleSheet({
  open,
  personName,
  current,
  actorRole,
  busy = false,
  onSelect,
  onClose,
}: RoleSheetProps) {
  useScrollLock(open)

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

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
        aria-labelledby="role-sheet-title"
        className="safe-bottom animate-sheet-in scroll-y relative max-h-[85vh] w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl dark:bg-larder-900 sm:m-3 sm:rounded-2xl"
      >
        <div
          aria-hidden
          className="mx-auto mb-4 h-1 w-9 rounded-full bg-larder-300 dark:bg-larder-700 sm:hidden"
        />

        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2
              id="role-sheet-title"
              className="text-lg font-semibold text-larder-950 dark:text-larder-50"
            >
              {personName}'s role
            </h2>
            <p className="mt-0.5 text-xs text-larder-600 dark:text-larder-400">
              Changes apply immediately.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="tap -mr-2 shrink-0 rounded-xl text-larder-500"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div role="radiogroup" aria-label="Role" className="space-y-2">
          {ROLES.map((role) => {
            const selected = role === current
            // You cannot grant a role you could not act on afterwards.
            const allowed = canActOn(actorRole, role) || role === current
            return (
              <button
                key={role}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={busy || !allowed}
                onClick={() => onSelect(role)}
                className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors disabled:opacity-40 ${
                  selected
                    ? 'border-larder-600 bg-larder-100 dark:border-larder-400 dark:bg-larder-800'
                    : 'border-larder-200 dark:border-larder-700'
                }`}
              >
                <span
                  aria-hidden
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                    selected
                      ? 'border-larder-600 bg-larder-600 text-white dark:border-larder-400 dark:bg-larder-400 dark:text-larder-950'
                      : 'border-larder-300 dark:border-larder-600'
                  }`}
                >
                  {selected ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-larder-950 dark:text-larder-50">
                    {ROLE_LABEL[role]}
                  </span>
                  <span className="mt-0.5 block text-xs text-larder-600 dark:text-larder-400">
                    {ROLE_SUMMARY[role]}
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        {/* ── What each role can actually do ─────────────────────────────── */}
        <h3 className="mb-2 mt-6 text-sm font-semibold text-larder-950 dark:text-larder-50">
          What each role can do
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <caption className="sr-only">
              Capabilities granted by each household role
            </caption>
            <thead>
              <tr>
                <th scope="col" className="pb-2 pr-2 font-medium text-larder-600 dark:text-larder-400">
                  Can
                </th>
                {ROLES.map((role) => (
                  <th
                    key={role}
                    scope="col"
                    className="pb-2 text-center font-medium text-larder-600 dark:text-larder-400"
                  >
                    {ROLE_LABEL[role].slice(0, 3)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CAPABILITIES.map((capability) => (
                <tr key={capability.key} className="border-t border-larder-100 dark:border-larder-800">
                  <th
                    scope="row"
                    className="py-1.5 pr-2 font-normal text-larder-800 dark:text-larder-200"
                  >
                    {capability.label}
                  </th>
                  {ROLES.map((role) => {
                    const allowed = can(role, capability.key)
                    return (
                      <td key={role} className="py-1.5 text-center">
                        <span className="sr-only">
                          {ROLE_LABEL[role]}: {allowed ? 'yes' : 'no'}
                        </span>
                        {allowed ? (
                          <Check
                            className="mx-auto h-3.5 w-3.5 text-larder-600 dark:text-larder-400"
                            aria-hidden
                          />
                        ) : (
                          <span aria-hidden className="text-larder-300 dark:text-larder-700">
                            ·
                          </span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
