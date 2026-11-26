/**
 * Sub-list helpers — meal/plan emoji suggestions and graceful local fallback.
 *
 * Sub-lists let a household group items needed for a specific dish, recipe or
 * occasion ("Taco Tuesday", "Sunday Roast", "Camping trip") without pulling
 * those items out of the main aisle-sorted grocery list.
 */

import { readLocal, writeLocal } from '@/lib/storage'
import type { Sublist, SublistItem } from '@/types/database'

export const DEFAULT_SUBLIST_EMOJI = '🍽️'

export const SUBLIST_EMOJIS = [
  '🍽️', '🍝', '🌮', '🍛', '🍕', '🥗', '🍲', '🥘',
  '🍔', '🥩', '🐟', '🍣', '🍜', '🥞', '🍳', '🥪',
  '🎂', '🧁', '🥂', '🧺', '🏕️', '🎉', '🍱', '🥘',
] as const

/** Deduplicated palette for the picker UI. */
export const UNIQUE_SUBLIST_EMOJIS = [...new Set(SUBLIST_EMOJIS)]

const DISH_KEYWORDS: ReadonlyArray<readonly [string, string]> = [
  ['taco', '🌮'],
  ['fajita', '🌮'],
  ['burrito', '🌯'],
  ['enchilada', '🌮'],
  ['nacho', '🌮'],
  ['mexican', '🌮'],
  ['pasta', '🍝'],
  ['spaghetti', '🍝'],
  ['carbonara', '🍝'],
  ['bolognese', '🍝'],
  ['lasagn', '🍝'],
  ['risotto', '🍚'],
  ['curry', '🍛'],
  ['tikka', '🍛'],
  ['katsu', '🍛'],
  ['thai', '🍛'],
  ['pizza', '🍕'],
  ['salad', '🥗'],
  ['caesar', '🥗'],
  ['soup', '🍲'],
  ['stew', '🍲'],
  ['chilli', '🍲'],
  ['chili', '🍲'],
  ['casserole', '🍲'],
  ['stir fry', '🥘'],
  ['stir-fry', '🥘'],
  ['paella', '🥘'],
  ['fajitas', '🥘'],
  ['roast', '🥩'],
  ['steak', '🥩'],
  ['sunday', '🥩'],
  ['bbq', '🍔'],
  ['barbecue', '🍔'],
  ['burger', '🍔'],
  ['fish', '🐟'],
  ['salmon', '🐟'],
  ['sushi', '🍣'],
  ['ramen', '🍜'],
  ['noodle', '🍜'],
  ['pho', '🍜'],
  ['pancake', '🥞'],
  ['waffle', '🧇'],
  ['brunch', '🥞'],
  ['breakfast', '🍳'],
  ['omelette', '🍳'],
  ['sandwich', '🥪'],
  ['lunch', '🥪'],
  ['packed lunch', '🍱'],
  ['meal prep', '🍱'],
  ['birthday', '🎂'],
  ['cake', '🎂'],
  ['bake', '🧁'],
  ['baking', '🧁'],
  ['dessert', '🧁'],
  ['pudding', '🧁'],
  ['party', '🎉'],
  ['dinner party', '🥂'],
  ['drinks', '🥂'],
  ['christmas', '🎄'],
  ['thanksgiving', '🦃'],
  ['holiday', '🎉'],
  ['picnic', '🧺'],
  ['camp', '🏕️'],
]

const SORTED_DISH_KEYWORDS = [...DISH_KEYWORDS].sort((a, b) => b[0].length - a[0].length)

/** Pick a sensible emoji from the dish/plan name when the user hasn't chosen one. */
export function suggestSublistEmoji(name: string): string {
  const haystack = name.toLowerCase().trim()
  if (haystack.length === 0) return DEFAULT_SUBLIST_EMOJI
  for (const [keyword, emoji] of SORTED_DISH_KEYWORDS) {
    if (haystack.includes(keyword)) return emoji
  }
  return DEFAULT_SUBLIST_EMOJI
}

/* ── Pre-migration local fallback ─────────────────────────────────────────── *
 * If a deployment updates its frontend bundle before running `supabase db push`
 * for 20261126000000_sublists_and_fixes.sql, PostgREST reports 42P01 / PGRST205
 * ("relation does not exist"). Falling back to localStorage keeps sub-lists
 * usable right away instead of surfacing raw schema errors, and yields cleanly
 * to Postgres the moment the migration is applied.
 * ─────────────────────────────────────────────────────────────────────────── */

export function isMissingTableError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const e = error as { code?: string; message?: string }
  const code = e.code ?? ''
  const msg = (e.message ?? '').toLowerCase()
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    msg.includes('sublists') && (msg.includes('does not exist') || msg.includes('schema cache'))
  )
}

export function readLocalSublists(listId: string): Sublist[] {
  const raw = readLocal(`sublists.${listId}`)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Sublist[]) : []
  } catch {
    return []
  }
}

export function writeLocalSublists(listId: string, rows: readonly Sublist[]): void {
  writeLocal(`sublists.${listId}`, JSON.stringify(rows))
}

export function readLocalSublistLinks(listId: string): SublistItem[] {
  const raw = readLocal(`sublistItems.${listId}`)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as SublistItem[]) : []
  } catch {
    return []
  }
}

export function writeLocalSublistLinks(listId: string, rows: readonly SublistItem[]): void {
  writeLocal(`sublistItems.${listId}`, JSON.stringify(rows))
}
