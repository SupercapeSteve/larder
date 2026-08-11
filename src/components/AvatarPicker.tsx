import { useRef, useState, type ChangeEvent } from 'react'
import { Check, ImageUp, Trash2, X } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { ImageCropper } from '@/components/ImageCropper'
import { Spinner } from '@/components/ui'
import { AVATAR_COLORS, AVATAR_EMOJI, AVATAR_SWATCH, type AvatarColor } from '@/lib/avatars'

/** Refuse absurd files before spending time decoding them. */
const MAX_INPUT_BYTES = 25 * 1024 * 1024

type AvatarPickerProps = {
  userId: string | null
  displayName: string | null
  emoji: string | null
  color: string | null
  imageUrl: string | null
  uploading?: boolean
  onChange: (next: { emoji?: string | null; color?: AvatarColor }) => void
  /** Receives the cropped 256×256 JPEG, not the original file. */
  onUpload: (blob: Blob) => void
  onRemoveImage: () => void
  onError: (message: string) => void
}

export function AvatarPicker({
  userId,
  displayName,
  emoji,
  color,
  imageUrl,
  uploading = false,
  onChange,
  onUpload,
  onRemoveImage,
  onError,
}: AvatarPickerProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [cropping, setCropping] = useState<File | null>(null)

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Reset immediately so choosing the same file twice still fires onChange.
    event.target.value = ''
    if (!file) return

    if (!file.type.startsWith('image/')) {
      onError('Pick an image file — a JPEG, PNG or WebP.')
      return
    }
    if (file.size > MAX_INPUT_BYTES) {
      onError('That image is enormous. Pick one under 25 MB.')
      return
    }

    // Straight into the cropper; nothing uploads until the framing is chosen.
    setCropping(file)
  }

  return (
    <div className="px-4 py-4">
      <div className="mb-4 flex items-center gap-4">
        <Avatar
          userId={userId}
          displayName={displayName}
          emoji={emoji}
          color={color}
          imageUrl={imageUrl}
          size="lg"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-larder-950 dark:text-larder-50">
            {imageUrl ? 'Your photo' : emoji ? 'Emoji avatar' : 'Your initial'}
          </p>
          <p className="mt-0.5 text-xs text-larder-600 dark:text-larder-400">
            Shown next to everything you add.
          </p>
        </div>
        {emoji && !imageUrl ? (
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

      {/* ── Upload ──────────────────────────────────────────────────────── */}
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={onPick}
        className="sr-only"
        aria-label="Choose a profile picture"
      />
      <div className="mb-5 flex gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="btn-secondary flex-1 gap-2 text-sm"
        >
          {uploading ? <Spinner /> : <ImageUp className="h-4 w-4" aria-hidden />}
          {imageUrl ? 'Change photo' : 'Upload a photo'}
        </button>
        {imageUrl ? (
          <button
            type="button"
            onClick={onRemoveImage}
            disabled={uploading}
            className="btn-secondary shrink-0 gap-2 text-sm text-red-600 dark:text-red-400"
            aria-label="Remove photo"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
      </div>

      {imageUrl ? (
        <p className="mb-5 text-xs text-larder-500">
          Your photo is used while it's set. Remove it to go back to an emoji or your initial.
        </p>
      ) : null}

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

      <ImageCropper
        file={cropping}
        busy={uploading}
        onCancel={() => setCropping(null)}
        onConfirm={(blob) => {
          setCropping(null)
          onUpload(blob)
        }}
      />
    </div>
  )
}
