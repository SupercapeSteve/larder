/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst, StaleWhileRevalidate } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { createHandlerBoundToURL } from 'workbox-precaching'

/**
 * Custom service worker.
 *
 * generateSW cannot host a `push` listener, and push is the whole reason this
 * file exists. Everything else mirrors the previous generated config so the
 * offline behaviour is unchanged.
 */
declare const self: ServiceWorkerGlobalScope

// Injected at build time by vite-plugin-pwa (injectManifest strategy).
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

self.skipWaiting()
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// Deep links fall back to the app shell, or a hard refresh on /h/<id> 404s.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/functions\//, /^\/rest\//, /^\/auth\//],
  }),
)

registerRoute(
  ({ sameOrigin, url }) => sameOrigin && url.pathname.startsWith('/assets/'),
  new StaleWhileRevalidate({ cacheName: 'larder-assets' }),
)

// Only the accent actually in use ends up cached, rather than all ten sets.
registerRoute(
  ({ sameOrigin, url }) => sameOrigin && url.pathname.startsWith('/icons/'),
  new CacheFirst({
    cacheName: 'larder-accent-icons',
    plugins: [new ExpirationPlugin({ maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 90 })],
  }),
)

/* ── Push ──────────────────────────────────────────────────────────────────
 * iOS 16.4+ delivers web push to installed PWAs only — never to a tab in
 * Safari. That is a platform rule, not a bug in the subscription flow.
 */

type PushPayload = {
  title?: string
  body?: string
  url?: string
  tag?: string
}

self.addEventListener('push', (event) => {
  let payload: PushPayload = {}
  try {
    payload = event.data ? (event.data.json() as PushPayload) : {}
  } catch {
    payload = { body: event.data?.text() ?? 'Your list changed.' }
  }

  const title = payload.title ?? 'Larder'
  const options: NotificationOptions = {
    body: payload.body ?? 'Your list changed.',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    // A tag collapses repeats: five items added in a row is one notification,
    // not five buzzes while somebody is mid-shop.
    tag: payload.tag ?? 'larder-list',
    data: { url: payload.url ?? '/' },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data as { url?: string } | undefined)?.url ?? '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus an open copy rather than stacking another window.
      for (const client of clients) {
        if ('focus' in client) return client.focus()
      }
      return self.clients.openWindow(target)
    }),
  )
})
