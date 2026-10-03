import { ref } from 'vue'
import { api } from './api'
import { isIos, isStandalone } from './install'
import { serviceWorkerRegistration } from './pwa'

/**
 * - `unsupported`: no service worker / Push API (e.g. development build, plain HTTP)
 * - `needs-install`: iOS only delivers push to the installed app
 * - `denied`: blocked in the browser settings
 */
export type NotificationState = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on'

export const notificationState = ref<NotificationState>('unsupported')

function base64urlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

export async function refreshNotificationState(): Promise<NotificationState> {
  const registration = serviceWorkerRegistration()
  if (isIos() && !isStandalone()) notificationState.value = 'needs-install'
  else if (!registration || !('PushManager' in window) || !('Notification' in window)) {
    notificationState.value = 'unsupported'
  } else if (Notification.permission === 'denied') notificationState.value = 'denied'
  else {
    const subscription = await registration.pushManager.getSubscription()
    notificationState.value = subscription ? 'on' : 'off'
  }
  return notificationState.value
}

/**
 * Asks for permission and subscribes this device. Must run from a user action (button click);
 * the app never asks on its own (ADR 0005). Push stays a hint: sync never depends on it.
 */
export async function enableNotifications(): Promise<NotificationState> {
  const registration = serviceWorkerRegistration()
  if (!registration) return refreshNotificationState()
  if ((await Notification.requestPermission()) !== 'granted') return refreshNotificationState()
  const { publicKey } = await api.pushPublicKey()
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64urlToBytes(publicKey),
  })
  const json = subscription.toJSON()
  await api.pushSubscribe({
    endpoint: subscription.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
  })
  return refreshNotificationState()
}

export async function disableNotifications(): Promise<NotificationState> {
  const subscription = await serviceWorkerRegistration()?.pushManager.getSubscription()
  if (subscription) {
    await api.pushUnsubscribe(subscription.endpoint).catch(() => undefined)
    await subscription.unsubscribe()
  }
  return refreshNotificationState()
}
