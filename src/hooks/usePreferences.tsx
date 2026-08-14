import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { readLocal, removeLocal, writeLocal } from '@/lib/storage'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
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

/** Narrow anything — a localStorage string or a jsonb column — into Preferences. */
function parsePreferences(raw: unknown): Preferences | null {
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
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
}

function readLocalPreferences(): Preferences {
  return parsePreferences(readLocal(STORAGE_KEY)) ?? DEFAULTS
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

/**
 * Appearance settings, stored against the account.
 *
 * localStorage is still written on every change — it is what the pre-paint
 * script in index.html reads, so the right theme is on screen before React
 * mounts, and it keeps the app themed while offline. The account copy in
 * `profiles.preferences` is the source of truth: signing in on a new device
 * pulls it down, and signing out clears the device so the next person starts
 * from defaults rather than inheriting somebody else's purple.
 *
 * Must be nested *inside* AuthProvider — it needs to know who is signed in.
 */
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [preferences, setPreferences] = useState<Preferences>(readLocalPreferences)

  // Read inside async callbacks without making them depend on every change.
  const latest = useRef(preferences)
  latest.current = preferences

  // Tracks whose preferences are currently loaded, so a change of account can
  // be told apart from a re-render.
  const loadedFor = useRef<string | null>(null)

  // Paint and persist locally on every change, signed in or not.
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

  // Depend on the id, not the user object.
  //
  // AuthProvider sets the session twice on load — once from getSession() and
  // once from the INITIAL_SESSION event — producing two different user objects
  // with the same id. Keying this effect on the object made it run twice: the
  // first run claimed the id and started the fetch, the cleanup cancelled that
  // fetch, and the second run saw the id already claimed and returned without
  // fetching. Preferences were never loaded. A string dependency makes the
  // second render a no-op instead.
  const userId = user?.id ?? null

  // Sign in → adopt the account's settings. Sign out / switch → start clean.
  useEffect(() => {
    const id = userId
    if (id === loadedFor.current) return

    const previous = loadedFor.current
    loadedFor.current = id

    if (previous !== null) {
      // Signed out, or signed in as somebody else. Either way this device must
      // not keep the last account's look.
      setPreferences(DEFAULTS)
      removeLocal(STORAGE_KEY)
    }

    if (!id) return

    let active = true
    void supabase
      .from('profiles')
      .select('preferences')
      .eq('id', id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return
        if (error) {
          // Not fatal — the device keeps whatever it has — but silence here is
          // what made the original failure so hard to see.
          console.warn('[larder] could not load account preferences:', error.message)
          return
        }

        const remote = parsePreferences(data?.preferences)
        if (remote) {
          setPreferences(remote)
          return
        }

        // No saved settings yet — this is the first sign-in since the feature
        // landed. Keep whatever is already on this device and adopt it as the
        // account's, rather than resetting somebody's existing choices.
        void supabase.from('profiles').update({ preferences: latest.current }).eq('id', id)
      })

    return () => {
      active = false
    }
  }, [userId])

  /** Persist a user-initiated change to the account. */
  const save = useCallback((next: Preferences) => {
    const id = loadedFor.current
    if (!id) return
    // Fire and forget: the change is already applied locally, and a failed
    // write should not block the UI or throw an error at somebody for
    // picking a colour. It will be re-sent on the next change.
    void supabase.from('profiles').update({ preferences: next }).eq('id', id)
  }, [])

  const setPreference = useCallback(
    <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
      setPreferences((current) => {
        const next = { ...current, [key]: value }
        save(next)
        return next
      })
    },
    [save],
  )

  const resetPreferences = useCallback(() => {
    setPreferences(DEFAULTS)
    save(DEFAULTS)
  }, [save])

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
