/**
 * localStorage with a guard. Safari in Private Mode throws on setItem, and an
 * unhandled throw here would take down the whole list screen over a preference.
 */

const PREFIX = 'larder.'

export function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(PREFIX + key)
  } catch {
    return null
  }
}

export function writeLocal(key: string, value: string): void {
  try {
    window.localStorage.setItem(PREFIX + key, value)
  } catch {
    /* Private mode, quota, or a locked-down browser. Preferences are optional. */
  }
}

export function removeLocal(key: string): void {
  try {
    window.localStorage.removeItem(PREFIX + key)
  } catch {
    /* see above */
  }
}

export const LAST_HOUSEHOLD_KEY = 'lastHousehold'
