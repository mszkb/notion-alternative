import { ref, shallowRef } from 'vue'

/** Chromium's install prompt event (not in the DOM typings). */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const IOS_HINT_DISMISSED = 'notion-alt.iosInstallHintDismissed'

/** Deferred install prompt (Chromium, Android); null when the browser offers none. */
export const installPrompt = shallowRef<BeforeInstallPromptEvent | null>(null)
export const installed = ref(false)

/** Running as installed app (home screen / app window). */
export function isStandalone(
  matchMedia: (query: string) => { matches: boolean } = (q) => window.matchMedia(q),
  nav: Navigator & { standalone?: boolean } = navigator,
): boolean {
  return matchMedia('(display-mode: standalone)').matches || nav.standalone === true
}

/** iPhone, iPad (also iPadOS reporting as Mac), iPod: installation only via the share menu. */
export function isIos(
  nav: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> = navigator,
) {
  return (
    /iPhone|iPad|iPod/.test(nav.userAgent) ||
    (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)
  )
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(IOS_HINT_DISMISSED) === '1'
  } catch {
    return false
  }
}

/** Show the "Zum Home-Bildschirm" hint: iOS, not installed yet, not dismissed. */
export const showIosHint = ref(false)

export function dismissIosHint(): void {
  showIosHint.value = false
  try {
    localStorage.setItem(IOS_HINT_DISMISSED, '1')
  } catch {
    // Shown again next time; not essential.
  }
}

/**
 * Starts listening for install events. `onInstalled` runs after an installation, e.g. to ask
 * for persistent storage again (browsers grant it more readily to installed apps).
 */
export function setupInstall(onInstalled: () => void): void {
  installed.value = isStandalone()
  showIosHint.value = !installed.value && isIos() && !readDismissed()
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    installPrompt.value = event as BeforeInstallPromptEvent
  })
  window.addEventListener('appinstalled', () => {
    installed.value = true
    installPrompt.value = null
    onInstalled()
  })
}

/** Shows the browser's install dialog (only after a user action). */
export async function installApp(): Promise<boolean> {
  const prompt = installPrompt.value
  if (!prompt) return false
  await prompt.prompt()
  const { outcome } = await prompt.userChoice
  // A prompt can be used once; the browser fires a new event if it may ask again.
  installPrompt.value = null
  return outcome === 'accepted'
}
