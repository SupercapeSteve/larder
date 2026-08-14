import { copyToClipboard } from '@/lib/clipboard'

/**
 * A snapshot worth pasting into a bug report.
 *
 * Three separate failures in this app's history were invisible — a rejected
 * write with no error handler, an avatar that never refetched, a save that
 * never left the browser. Each took multiple rounds to diagnose because there
 * was nothing to look at. This is that something.
 *
 * Deliberately excludes anything identifying: no email, no user id, no item
 * names, no tokens. Enough to debug, nothing worth leaking.
 */
export type Diagnostics = {
  when: string
  app: string
  url: string
  userAgent: string
  standalone: boolean
  online: boolean
  language: string
  viewport: string
  serviceWorker: 'active' | 'registered' | 'none' | 'unsupported'
  storage: 'ok' | 'unavailable'
  error?: string
}

function standaloneMode(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  const nav: unknown = window.navigator
  if (typeof nav === 'object' && nav !== null && 'standalone' in nav) {
    return (nav as { standalone?: unknown }).standalone === true
  }
  return false
}

export async function collectDiagnostics(error?: unknown): Promise<Diagnostics> {
  let serviceWorker: Diagnostics['serviceWorker'] = 'unsupported'
  if ('serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations()
      serviceWorker = registrations.length === 0 ? 'none' : registrations.some((r) => r.active) ? 'active' : 'registered'
    } catch {
      serviceWorker = 'none'
    }
  }

  let storage: Diagnostics['storage'] = 'ok'
  try {
    window.localStorage.setItem('larder.diagnostic-probe', '1')
    window.localStorage.removeItem('larder.diagnostic-probe')
  } catch {
    storage = 'unavailable'
  }

  return {
    when: new Date().toISOString(),
    app: 'Larder 1.1.0',
    // Path only — a URL can carry a household id, and a recovery link carries
    // tokens in its fragment.
    url: window.location.pathname,
    userAgent: navigator.userAgent,
    standalone: standaloneMode(),
    online: navigator.onLine,
    language: navigator.language,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    serviceWorker,
    storage,
    ...(error === undefined
      ? {}
      : { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }),
  }
}

export async function copyDiagnostics(error?: unknown): Promise<boolean> {
  const report = await collectDiagnostics(error)
  return copyToClipboard(JSON.stringify(report, null, 2))
}
