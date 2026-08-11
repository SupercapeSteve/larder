/**
 * Avatars without a storage bucket.
 *
 * An emoji plus a palette key renders identically on every device, needs no
 * upload, no CDN, no moderation, and works offline. Storing the palette *key*
 * rather than a hex value keeps theming in the app, so dark mode can pick a
 * different shade of the same colour.
 */

export const AVATAR_COLORS = [
  'green',
  'teal',
  'blue',
  'indigo',
  'violet',
  'pink',
  'red',
  'orange',
  'amber',
  'slate',
] as const

export type AvatarColor = (typeof AVATAR_COLORS)[number]

export const DEFAULT_AVATAR_COLOR: AvatarColor = 'green'

/** Tailwind classes per palette key, light and dark. */
export const AVATAR_CLASSES: Record<AvatarColor, string> = {
  green: 'bg-larder-200 text-larder-800 dark:bg-larder-700 dark:text-larder-100',
  teal: 'bg-teal-200 text-teal-900 dark:bg-teal-800 dark:text-teal-100',
  blue: 'bg-sky-200 text-sky-900 dark:bg-sky-800 dark:text-sky-100',
  indigo: 'bg-indigo-200 text-indigo-900 dark:bg-indigo-800 dark:text-indigo-100',
  violet: 'bg-violet-200 text-violet-900 dark:bg-violet-800 dark:text-violet-100',
  pink: 'bg-pink-200 text-pink-900 dark:bg-pink-800 dark:text-pink-100',
  red: 'bg-red-200 text-red-900 dark:bg-red-800 dark:text-red-100',
  orange: 'bg-orange-200 text-orange-900 dark:bg-orange-800 dark:text-orange-100',
  amber: 'bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-100',
  slate: 'bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-slate-100',
}

/** Swatch colours for the picker itself. */
export const AVATAR_SWATCH: Record<AvatarColor, string> = {
  green: 'bg-larder-500',
  teal: 'bg-teal-500',
  blue: 'bg-sky-500',
  indigo: 'bg-indigo-500',
  violet: 'bg-violet-500',
  pink: 'bg-pink-500',
  red: 'bg-red-500',
  orange: 'bg-orange-500',
  amber: 'bg-amber-500',
  slate: 'bg-slate-500',
}

export const AVATAR_EMOJI = [
  '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐸', '🐧',
  '🦉', '🦄', '🐢', '🐙', '🦕', '🐝', '🦋', '🐳',
  '🌻', '🌵', '🍄', '🌙', '⭐️', '🔥', '🍕', '🍩',
  '🥑', '🍋', '🍒', '🧁', '☕️', '🎸', '⚽️', '🚀',
] as const

export function toAvatarColor(value: string | null | undefined): AvatarColor {
  if (!value) return DEFAULT_AVATAR_COLOR
  return (AVATAR_COLORS as readonly string[]).includes(value)
    ? (value as AvatarColor)
    : DEFAULT_AVATAR_COLOR
}

/**
 * A stable colour for anyone who has not chosen one, derived from their id so
 * the same person is always the same colour on every device.
 */
export function colorForId(id: string): AvatarColor {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}
