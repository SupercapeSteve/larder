/**
 * Live app-version synchronisation across every open tab and installed PWA.
 *
 * Why a single Service Worker check on load is not enough:
 *  - An installed home-screen PWA on iOS or an open desktop tab can stay alive
 *    for days without a full navigation, so `register('/sw.js')` on cold load
 *    never runs again.
 *  - Even on reload, a precache-first Service Worker serves the *previous*
 *    precached `index.html` + JS bundle first while fetching the new worker in
 *    the background — leaving the user one deploy behind unless `controllerchange`
 *    triggers a refresh.
 *  - Safari/WebKit in standalone mode can throttle SW byte-diff checks, so we
 *    pair `registration.update()` with a lightweight `/version.json` (`no-store`)
 *    check against the compiled `__APP_BUILD_ID__`.
 *
 * Reloads are deferred only while the user actually has unsaved text typed into
 * a focused field (`value.trim().length > 0`), and fire the instant that field
 * is submitted, cleared or blurred — so an idle cursor sitting in the empty
 * "Add an item…" bar never blocks an update.
 */

const CHECK_INTERVAL_MS = 60_000
const RELOAD_GUARD_KEY = 'larder.reloadedBuildId'

let reloading = false
let pendingReload = false
let listenersAttached = false

/** True only when the user has actual half-typed characters in a focused input. */
function hasUnsavedTypedInput(): boolean {
  const active = document.activeElement
  if (active instanceof HTMLInputElement) {
    const textLike = !['checkbox', 'radio', 'button', 'submit', 'range', 'file'].includes(
      active.type,
    )
    return textLike && active.value.trim().length > 0
  }
  if (active instanceof HTMLTextAreaElement) {
    return active.value.trim().length > 0
  }
  if (active instanceof HTMLElement && active.isContentEditable) {
    return (active.textContent ?? '').trim().length > 0
  }
  return false
}

function performReload(): void {
  if (reloading) return
  reloading = true
  pendingReload = false
  window.location.reload()
}

function scheduleReload(): void {
  if (reloading) return
  if (!hasUnsavedTypedInput()) {
    performReload()
    return
  }

  // User is mid-word. Wait until they submit, clear, or leave the field so we
  // never wipe what they are typing.
  pendingReload = true
  if (listenersAttached) return
  listenersAttached = true

  const checkReady = () => {
    if (pendingReload && !hasUnsavedTypedInput()) {
      performReload()
    }
  }

  document.addEventListener('focusout', () => setTimeout(checkReady, 50))
  document.addEventListener('submit', () => setTimeout(checkReady, 150))
  document.addEventListener('input', checkReady)
}

function readGuard(): string | null {
  try {
    return window.sessionStorage.getItem(RELOAD_GUARD_KEY)
  } catch {
    return null
  }
}

function writeGuard(buildId: string): void {
  try {
    window.sessionStorage.setItem(RELOAD_GUARD_KEY, buildId)
  } catch {
    /* private mode — proceed */
  }
}

export function startAppUpdater(): void {
  // Catch Vite chunk-hash 404s when navigating right across a deploy boundary.
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault()
    scheduleReload()
  })

  if (import.meta.env.DEV) return

  let swRegistration: ServiceWorkerRegistration | null = null
  const hadController = 'serviceWorker' in navigator && Boolean(navigator.serviceWorker.controller)
  let sawControllerChange = false

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      sawControllerChange = true
      // On very first install (`hadController === false`), claiming the tab
      // needs no reload — the tab is already running the fresh network bundle.
      if (!hadController) return
      scheduleReload()
    })

    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/', updateViaCache: 'none' })
        .then((reg) => {
          swRegistration = reg
          if (reg.waiting) {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' })
          }
          reg.addEventListener('updatefound', () => {
            const installing = reg.installing
            if (!installing) return
            installing.addEventListener('statechange', () => {
              if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                installing.postMessage({ type: 'SKIP_WAITING' })
              }
            })
          })
        })
        .catch(() => undefined)
    })
  }

  let checking = false

  async function checkForUpdate(): Promise<void> {
    if (checking || reloading) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    checking = true

    try {
      // 1. Nudge the Service Worker registration first.
      if (swRegistration) {
        await swRegistration.update().catch(() => undefined)
        if (swRegistration.waiting) {
          swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' })
        }
      }

      // 2. Compare the live server's /version.json against our compiled build ID.
      const response = await fetch(`/version.json?t=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      })
      if (!response.ok) return

      const data = (await response.json()) as { buildId?: unknown }
      const remoteBuildId = typeof data.buildId === 'string' ? data.buildId : null
      if (!remoteBuildId || remoteBuildId === __APP_BUILD_ID__) return

      // A newer build is live on the server! Ask the SW to pull the new
      // precache immediately; if no controllerchange fires within 1.5s (e.g.
      // browser without SW or SW already updated earlier), reload once per
      // remoteBuildId so we never loop.
      if (swRegistration) {
        await swRegistration.update().catch(() => undefined)
        if (swRegistration.waiting) {
          swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' })
        }
      }

      setTimeout(() => {
        if (reloading || sawControllerChange) return
        if (readGuard() === remoteBuildId) return
        writeGuard(remoteBuildId)
        scheduleReload()
      }, 1500)
    } catch {
      /* offline or captive portal — try again on next heartbeat */
    } finally {
      checking = false
    }
  }

  // Initial check shortly after boot (catches cold starts served from an older
  // SW precache), then on every foreground return, reconnect, and 60s tick.
  setTimeout(() => void checkForUpdate(), 2500)

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkForUpdate()
  })
  window.addEventListener('focus', () => void checkForUpdate())
  window.addEventListener('online', () => void checkForUpdate())
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) void checkForUpdate()
  })

  setInterval(() => {
    if (document.visibilityState === 'visible') void checkForUpdate()
  }, CHECK_INTERVAL_MS)
}
