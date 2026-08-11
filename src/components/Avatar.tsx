import { useEffect, useState } from 'react'
import { AVATAR_CLASSES, colorForId, toAvatarColor } from '@/lib/avatars'

type AvatarProps = {
  userId: string | null
  displayName: string | null
  emoji?: string | null
  color?: string | null
  imageUrl?: string | null
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
}

const SIZES: Record<NonNullable<AvatarProps['size']>, string> = {
  xs: 'h-4 w-4 text-[9px]',
  sm: 'h-7 w-7 text-xs',
  md: 'h-9 w-9 text-sm',
  lg: 'h-16 w-16 text-2xl',
}

/**
 * Uploaded picture if there is one, then a chosen emoji, then the first letter
 * of their name. The last two need no network and cannot fail, which is why
 * they stay as fallbacks rather than being replaced by uploads.
 */
export function Avatar({
  userId,
  displayName,
  emoji,
  color,
  imageUrl,
  size = 'md',
  className = '',
}: AvatarProps) {
  const [failed, setFailed] = useState(false)

  // A new URL deserves a fresh attempt; without this, one broken image would
  // suppress every later one for the life of the component.
  useEffect(() => setFailed(false), [imageUrl])

  // An explicit choice wins; otherwise derive a stable colour from the id so
  // the same person looks the same on every device.
  const palette = color ? toAvatarColor(color) : userId ? colorForId(userId) : 'green'
  const initial = (displayName ?? '?').trim().charAt(0).toUpperCase() || '?'

  const base = `flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold ${SIZES[size]} ${className}`

  if (imageUrl && !failed) {
    return (
      <span aria-hidden className={`${base} bg-larder-200 dark:bg-larder-800`}>
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      </span>
    )
  }

  return (
    <span aria-hidden className={`${base} ${AVATAR_CLASSES[palette]}`}>
      {emoji ? <span className="leading-none">{emoji}</span> : initial}
    </span>
  )
}
