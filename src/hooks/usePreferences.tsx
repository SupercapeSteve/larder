import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { readLocal, writeLocal } from '@/lib/storage'
import { applyAccent, accentHex, toAccent, type Accent } from '@/lib/themes'

export type ThemeChoice = 'system' | 'light' | 'dark'
export type TextSize = 'normal' | 'large' | 'x-large'

export type Preferences = {
  /** App-wide accent. Re-themes every `larder-*` class in one assignment. */
  accent: Accent
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
  accent: 'larder',
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
      accent: toAccent(p.accent),
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

  // Eleven variables, and every `larder-*` class in the app follows.
  applyAccent(preferences.accent, root)

  // Keeps form controls and the browser UI in step with the chosen theme.
  root.style.colorScheme = dark ? 'dark' : 'light'

  // Tints Safari's UI and Android's status bar. Updates live.
  const themeColorMeta = document.querySelector('meta[name="theme-color"]')
  if (themeColorMeta) {
    themeColorMeta.setAttribute('content', accentHex(preferences.accent, dark ? 950 : 700))
  }

  // Point the install metadata at the matching icon set. This cannot change an
  // icon that is *already* on a home screen — iOS copies it at install time and
  // exposes no API to replace it — but it does mean the next install, on either
  // platform, gets the colour the user actually chose.
  const appleIcon = document.querySelector('link[rel="apple-touch-icon"]')
  if (appleIcon) {
    appleIcon.setAttribute('href', `/icons/${preferences.accent}/apple-touch-icon.png`)
  }
  const manifest = document.querySelector('link[rel="manifest"]')
  if (manifest) {
    manifest.setAttribute('href', `/icons/${preferences.accent}/manifest.webmanifest`)
  }
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
