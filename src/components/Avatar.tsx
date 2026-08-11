import { AVATAR_CLASSES, colorForId, toAvatarColor } from '@/lib/avatars'

type AvatarProps = {
  userId: string | null
  displayName: string | null
  emoji?: string | null
  color?: string | null
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
 * Emoji if the person picked one, otherwise the first letter of their name.
 * Never an image request — nothing here can fail to load or leak a URL.
 */
export function Avatar({
  userId,
  displayName,
  emoji,
  color,
  size = 'md',
  className = '',
}: AvatarProps) {
  // An explicit choice wins; otherwise derive a stable colour from the id so
  // the same person looks the same on every device.
  const palette = color ? toAvatarColor(color) : userId ? colorForId(userId) : 'green'
  const initial = (displayName ?? '?').trim().charAt(0).toUpperCase() || '?'

  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${SIZES[size]} ${AVATAR_CLASSES[palette]} ${className}`}
    >
      {emoji ? <span className="leading-none">{emoji}</span> : initial}
    </span>
  )
}
