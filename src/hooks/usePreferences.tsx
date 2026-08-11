import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { readLocal, writeLocal } from '@/lib/storage'

export type ThemeChoice = 'system' | 'light' | 'dark'
export type TextSize = 'normal' | 'large' | 'x-large'

export type Preferences = {
  theme: ThemeChoice
  textSize: TextSize
  /** Group the list into aisle sections, or show one flat list. */
  groupByCategory: boolean
  /** Show the "added by / checked by" line under each item. */
  showAttribution: boolean
  /** Show the aisle emoji next to section headings. */
  showEmoji: boolean
  /** Collapse checked items into the bottom section automatically. */
  autoCollapseChecked: boolean
  /** Vibrate on long-press and check-off, where the device supports it. */
  haptics: boolean
}

const DEFAULTS: Preferences = {
  theme: 'system',
  textSize: 'normal',
  groupByCategory: true,
  showAttribution: true,
  showEmoji: true,
  autoCollapseChecked: true,
  haptics: true,
}

const STORAGE_KEY = 'preferences'

function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === 'system' || value === 'light' || value === 'dark'
}

function isTextSize(value: unknown): value is TextSize {
  return value === 'normal' || value === 'large' || value === 'x-large'
}

function readPreferences(): Preferences {
  const raw = readLocal(STORAGE_KEY)
  if (!raw) return DEFAULTS

  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return DEFAULTS
    const p = parsed as Record<string, unknown>

    return {
      theme: isThemeChoice(p.theme) ? p.theme : DEFAULTS.theme,
      textSize: isTextSize(p.textSize) ? p.textSize : DEFAULTS.textSize,
      groupByCategory:
        typeof p.groupByCategory === 'boolean' ? p.groupByCategory : DEFAULTS.groupByCategory,
      showAttribution:
        typeof p.showAttribution === 'boolean' ? p.showAttribution : DEFAULTS.showAttribution,
      showEmoji: typeof p.showEmoji === 'boolean' ? p.showEmoji : DEFAULTS.showEmoji,
      autoCollapseChecked:
        typeof p.autoCollapseChecked === 'boolean'
          ? p.autoCollapseChecked
          : DEFAULTS.autoCollapseChecked,
      haptics: typeof p.haptics === 'boolean' ? p.haptics : DEFAULTS.haptics,
    }
  } catch {
    return DEFAULTS
  }
}

type PreferencesContextValue = {
  preferences: Preferences
  setPreference: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void
  resetPreferences: () => void
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null)

/** Applied to <html> so Tailwind's `dark:` variants and the root font size follow. */
function applyToDocument(preferences: Preferences): void {
  const root = document.documentElement

  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const dark = preferences.theme === 'dark' || (preferences.theme === 'system' && prefersDark)
  root.classList.toggle('dark', dark)

  root.classList.remove('text-size-normal', 'text-size-large', 'text-size-x-large')
  root.classList.add(`text-size-${preferences.textSize}`)

  // Keeps form controls and the browser UI in step with the chosen theme.
  root.style.colorScheme = dark ? 'dark' : 'light'
  const themeColorMeta = document.querySelector('meta[name="theme-color"]')
  if (themeColorMeta) themeColorMeta.setAttribute('content', dark ? '#0e2117' : '#27583c')
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<Preferences>(readPreferences)

  useEffect(() => {
    applyToDocument(preferences)
    writeLocal(STORAGE_KEY, JSON.stringify(preferences))
  }, [preferences])

  // Follow the OS when the user has chosen "system" and flips it mid-session.
  useEffect(() => {
    if (preferences.theme !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyToDocument(preferences)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [preferences])

  const setPreference = useCallback(
    <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
      setPreferences((current) => ({ ...current, [key]: value }))
    },
    [],
  )

  const resetPreferences = useCallback(() => setPreferences(DEFAULTS), [])

  const value = useMemo(
    () => ({ preferences, setPreference, resetPreferences }),
    [preferences, setPreference, resetPreferences],
  )

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext)
  if (!ctx) throw new Error('usePreferences must be used inside <PreferencesProvider>')
  return ctx
}

/** Fire a short haptic tick, if the device supports it and the user wants it. */
export function useHaptic(): (ms?: number) => void {
  const { preferences } = usePreferences()
  return useCallback(
    (ms = 10) => {
      if (!preferences.haptics) return
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(ms)
      }
    },
    [preferences.haptics],
  )
}
