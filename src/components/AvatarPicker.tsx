import { Check, X } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { AVATAR_COLORS, AVATAR_EMOJI, AVATAR_SWATCH, type AvatarColor } from '@/lib/avatars'

type AvatarPickerProps = {
  userId: string | null
  displayName: string | null
  emoji: string | null
  color: string | null
  onChange: (next: { emoji?: string | null; color?: AvatarColor }) => void
}

export function AvatarPicker({ userId, displayName, emoji, color, onChange }: AvatarPickerProps) {
  return (
    <div className="px-4 py-4">
      <div className="mb-4 flex items-center gap-4">
        <Avatar userId={userId} displayName={displayName} emoji={emoji} color={color} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-larder-950 dark:text-larder-50">
            {emoji ? 'Emoji avatar' : 'Your initial'}
          </p>
          <p className="mt-0.5 text-xs text-larder-600 dark:text-larder-400">
            Shown next to everything you add.
          </p>
        </div>
        {emoji ? (
          <button
            type="button"
            onClick={() => onChange({ emoji: null })}
            className="tap shrink-0 gap-1 rounded-xl px-2 text-xs font-medium text-larder-600 dark:text-larder-400"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            Clear
          </button>
        ) : null}
      </div>

      <fieldset>
        <legend className="mb-2 text-xs font-medium text-larder-700 dark:text-larder-300">
          Colour
        </legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Avatar colour">
          {AVATAR_COLORS.map((option) => {
            const selected = (color ?? '') === option
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={option}
                onClick={() => onChange({ color: option })}
                className={`flex h-11 w-11 items-center justify-center rounded-full transition-transform ${
                  selected ? 'ring-2 ring-larder-600 ring-offset-2 ring-offset-white dark:ring-larder-300 dark:ring-offset-larder-900' : ''
                }`}
              >
                <span className={`flex h-8 w-8 items-center justify-center rounded-full ${AVATAR_SWATCH[option]}`}>
                  {selected ? <Check className="h-4 w-4 text-white" aria-hidden /> : null}
                </span>
              </button>
            )
          })}
        </div>
      </fieldset>

      <fieldset className="mt-5">
        <legend className="mb-2 text-xs font-medium text-larder-700 dark:text-larder-300">
          Emoji
        </legend>
        <div className="grid grid-cols-8 gap-1.5" role="radiogroup" aria-label="Avatar emoji">
          {AVATAR_EMOJI.map((option) => {
            const selected = emoji === option
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={`Emoji ${option}`}
                onClick={() => onChange({ emoji: selected ? null : option })}
                className={`flex h-11 items-center justify-center rounded-xl text-xl transition-colors ${
                  selected
                    ? 'bg-larder-600 dark:bg-larder-500'
                    : 'bg-larder-100 dark:bg-larder-800'
                }`}
              >
                <span aria-hidden>{option}</span>
              </button>
            )
          })}
        </div>
      </fieldset>
    </div>
  )
}
