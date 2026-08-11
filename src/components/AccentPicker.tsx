import { Check } from 'lucide-react'
import { ACCENTS, ACCENT_LABEL, accentCss, type Accent } from '@/lib/themes'

/**
 * Picks the app-wide accent. Swatches are painted from the ramp itself rather
 * than from Tailwind classes — those are already re-themed by the current
 * selection, so every swatch would otherwise be the same colour.
 */
export function AccentPicker({
  value,
  onChange,
}: {
  value: Accent
  onChange: (next: Accent) => void
}) {
  return (
    <fieldset className="px-4 py-3">
      <legend className="text-sm font-medium text-larder-950 dark:text-larder-50">App colour</legend>
      <p className="mt-0.5 text-xs text-larder-600 dark:text-larder-400">
        Re-themes the whole app. Saved on this device.
      </p>

      <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="App colour">
        {ACCENTS.map((accent) => {
          const selected = accent === value
          return (
            <button
              key={accent}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={ACCENT_LABEL[accent]}
              title={ACCENT_LABEL[accent]}
              onClick={() => onChange(accent)}
              className="flex h-11 w-11 items-center justify-center rounded-full"
              style={
                selected
                  ? { boxShadow: `0 0 0 2px ${accentCss(accent, 600)}, 0 0 0 4px transparent` }
                  : undefined
              }
            >
              <span
                className="flex h-8 w-8 items-center justify-center rounded-full"
                style={{ backgroundColor: accentCss(accent, 600) }}
              >
                {selected ? <Check className="h-4 w-4 text-white" aria-hidden /> : null}
              </span>
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
