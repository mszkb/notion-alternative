/// <reference lib="webworker" />
// Service worker: app shell offline, never API data (that lives in IndexedDB, ADR 0001).
// Built by service-worker.plugin.ts, which prepends VERSION and PRECACHE.

declare const VERSION: string
declare const PRECACHE: string[]

const sw = self as unknown as ServiceWorkerGlobalScope
const CACHE = `app-${VERSION}`
/** Wait this long for the network before serving the cached page (unreachable server). */
const NAVIGATION_TIMEOUT_MS = 3000
// Precached requests carry no Origin header, module scripts do: ignore `Vary` when matching.
const MATCH: CacheQueryOptions = { ignoreVary: true }

sw.addEventListener('install', (event) => {
  // No skipWaiting here: a new version waits until the page agrees (see "update" in pwa.ts).
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)))
})

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('app-') && key !== CACHE) await caches.delete(key)
      }
      await sw.clients.claim()
    })(),
  )
})

sw.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void sw.skipWaiting()
})

/** Network first for pages (new releases arrive), cached shell when offline or too slow. */
async function navigation(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE)
  try {
    const response = await Promise.race([
      fetch(request),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), NAVIGATION_TIMEOUT_MS),
      ),
    ])
    if (response.ok) await cache.put('/index.html', response.clone())
    return response
  } catch {
    // The SPA handles every route itself: the shell is the answer for all of them.
    return (await cache.match('/index.html', MATCH)) ?? Response.error()
  }
}

/** Hashed assets never change: cache first, fill the cache on a miss. */
async function cacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE)
  const cached = await cache.match(request, MATCH)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) await cache.put(request, response.clone())
  return response
}

/** Icons, manifest: answer from the cache, refresh in the background. */
async function staleWhileRevalidate(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE)
  const cached = await cache.match(request, MATCH)
  const refresh = fetch(request)
    .then(async (response) => {
      if (response.ok) await cache.put(request, response.clone())
      return response
    })
    .catch(() => undefined)
  return cached ?? (await refresh) ?? Response.error()
}

sw.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== sw.location.origin) return
  // API responses are never cached: data comes from the local database and the sync.
  if (url.pathname.startsWith('/api/')) return
  if (request.mode === 'navigate') event.respondWith(navigation(request))
  else if (url.pathname.startsWith('/assets/')) event.respondWith(cacheFirst(request))
  else event.respondWith(staleWhileRevalidate(request))
})

// ------------------------------------------------------------------ Web Push (ADR 0005)

/** The payload never carries content, only a hint that changes are waiting. */
sw.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      const windows = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of windows) client.postMessage({ type: 'sync-hint' })
      // A dot on the app icon until the app has synced (cleared by the app).
      await (sw.navigator as WorkerNavigator & { setAppBadge?: () => Promise<void> })
        .setAppBadge?.()
        .catch(() => undefined)
      // Visible apps sync silently; otherwise a generic notice (browsers require one).
      if (!windows.some((client) => client.visibilityState === 'visible')) {
        await sw.registration.showNotification('Neue Änderungen', {
          body: 'Auf einem anderen Gerät wurde etwas geändert.',
          icon: '/icons/icon-192.png',
          tag: 'sync-available',
        })
      }
    })(),
  )
})

sw.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    (async () => {
      const windows = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const open = windows[0]
      if (open) await open.focus()
      else await sw.clients.openWindow('/')
    })(),
  )
})
