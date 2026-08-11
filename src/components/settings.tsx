import { useId, type ReactNode } from 'react'
import { Check } from 'lucide-react'

/* ── Section ──────────────────────────────────────────────────────────────── */

export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  const id = useId()
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="mb-1 px-1 text-sm font-semibold text-larder-700 dark:text-larder-300">
        {title}
      </h2>
      {description ? (
        <p className="mb-2 px-1 text-xs text-larder-600 dark:text-larder-400">{description}</p>
      ) : null}
      <div className="card divide-y divide-larder-200 overflow-hidden dark:divide-larder-800">
        {children}
      </div>
    </section>
  )
}

/* ── Toggle row ───────────────────────────────────────────────────────────── */

export function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  const id = useId()
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="min-w-0 flex-1">
        <label htmlFor={id} className="block text-sm font-medium text-larder-950 dark:text-larder-50">
          {label}
        </label>
        {description ? (
          <span id={`${id}-desc`} className="mt-0.5 block text-xs text-larder-600 dark:text-larder-400">
            {description}
          </span>
        ) : null}
      </span>

      {/* A real checkbox under the hood: keyboard, screen readers and form
          semantics all come for free, and the visual switch is just styling. */}
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-desc` : undefined}
        onClick={() => onChange(!checked)}
        className={`tap relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors ${
          checked ? 'bg-larder-600 dark:bg-larder-500' : 'bg-larder-300 dark:bg-larder-700'
        }`}
        style={{ minWidth: 51, minHeight: 44 }}
      >
        <span
          aria-hidden
          className="absolute left-0 top-1/2 block h-[27px] w-[27px] -translate-y-1/2 rounded-full bg-white shadow transition-transform"
          style={{ transform: `translate(${checked ? 22 : 2}px, -50%)` }}
        />
      </button>
    </div>
  )
}

/* ── Choice row (radio group) ─────────────────────────────────────────────── */

export type Choice<T extends string> = {
  value: T
  label: string
  hint?: string
}

export function ChoiceRow<T extends string>({
  label,
  description,
  value,
  choices,
  onChange,
}: {
  label: string
  description?: string
  value: T
  choices: ReadonlyArray<Choice<T>>
  onChange: (next: T) => void
}) {
  const id = useId()
  return (
    <fieldset className="px-4 py-3">
      <legend className="text-sm font-medium text-larder-950 dark:text-larder-50">{label}</legend>
      {description ? (
        <p className="mt-0.5 text-xs text-larder-600 dark:text-larder-400">{description}</p>
      ) : null}

      <div className="mt-3 flex flex-col gap-1.5 sm:flex-row" role="radiogroup" aria-labelledby={id}>
        <span id={id} className="sr-only">
          {label}
        </span>
        {choices.map((choice) => {
          const selected = choice.value === value
          return (
            <button
              key={choice.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(choice.value)}
              className={`tap flex-1 justify-between gap-2 rounded-xl border px-3 text-sm transition-colors sm:justify-center ${
                selected
                  ? 'border-larder-600 bg-larder-600 font-semibold text-white dark:border-larder-500 dark:bg-larder-500 dark:text-larder-950'
                  : 'border-larder-300 bg-white text-larder-800 hover:bg-larder-100 dark:border-larder-700 dark:bg-larder-900 dark:text-larder-100 dark:hover:bg-larder-800'
              }`}
            >
              <span className="flex flex-col items-start sm:items-center">
                <span>{choice.label}</span>
                {choice.hint ? (
                  <span className={`text-[11px] font-normal ${selected ? 'opacity-80' : 'opacity-70'}`}>
                    {choice.hint}
                  </span>
                ) : null}
              </span>
              {selected ? <Check className="h-4 w-4 shrink-0 sm:hidden" aria-hidden /> : null}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

/* ── Static info row ──────────────────────────────────────────────────────── */

export function InfoRow({
  icon,
  label,
  value,
}: {
  icon?: ReactNode
  label: string
  value: ReactNode
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      {icon ? <span className="shrink-0 text-larder-500">{icon}</span> : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-xs text-larder-600 dark:text-larder-400">{label}</span>
        <span className="truncate text-sm font-medium text-larder-950 dark:text-larder-50">
          {value}
        </span>
      </span>
    </div>
  )
}
