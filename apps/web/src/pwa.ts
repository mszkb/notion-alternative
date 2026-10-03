import { ref } from 'vue'
import { flushPendingEdits } from './pending-edits'

/** A new app version is installed and waits for a reload. */
export const updateAvailable = ref(false)

let registration: ServiceWorkerRegistration | null = null
const hintListeners = new Set<() => void>()

/** Web Push hints relayed by the service worker (ADR 0005); they only trigger a sync. */
export function onPushHint(listener: () => void): () => void {
  hintListeners.add(listener)
  return () => hintListeners.delete(listener)
}

const checkForUpdate = () => void registration?.update().catch(() => undefined)

/** Registers the service worker (production builds only; it needs a secure context). */
export async function registerServiceWorker(): Promise<void> {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  try {
    registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  } catch (error) {
    // E.g. plain HTTP on a LAN address: the app still works, just without offline reload.
    console.warn('Service worker not available', error)
    return
  }
  const watch = (worker: ServiceWorker) =>
    worker.addEventListener('statechange', () => {
      // Installed while another version controls the page: an update, not the first install.
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        updateAvailable.value = true
      }
    })
  if (registration.waiting && navigator.serviceWorker.controller) updateAvailable.value = true
  if (registration.installing) watch(registration.installing)
  registration.addEventListener('updatefound', () => {
    if (registration?.installing) watch(registration.installing)
  })
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'sync-hint') for (const listener of hintListeners) listener()
  })
  window.addEventListener('focus', checkForUpdate)
  setInterval(checkForUpdate, 60 * 60_000)
}

/** The active registration (null in development or without service worker support). */
export function serviceWorkerRegistration(): ServiceWorkerRegistration | null {
  return registration
}

/** Activates the waiting version after all pending edits are saved, then reloads. */
export async function applyUpdate(): Promise<void> {
  await flushPendingEdits()
  const waiting = registration?.waiting
  if (!waiting) {
    window.location.reload()
    return
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), {
    once: true,
  })
  waiting.postMessage({ type: 'SKIP_WAITING' })
}

/**
 * Emergency path when an app version is stuck: removes the service worker and its caches, then
 * reloads from the server. Local data (IndexedDB) is not touched.
 */
export async function resetAppCache(): Promise<void> {
  await flushPendingEdits()
  for (const reg of (await navigator.serviceWorker?.getRegistrations()) ?? [])
    await reg.unregister()
  for (const key of await caches.keys()) if (key.startsWith('app-')) await caches.delete(key)
  window.location.reload()
}
