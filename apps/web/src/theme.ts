import { ref } from 'vue'

/** Colour theme (#131): follow the system, or the user's choice on this device. */
export type ThemePreference = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'notion-alt.theme'

export const themePreference = ref<ThemePreference>('system')

function read(): ThemePreference {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    // Storage blocked (private mode): follow the system.
    return 'system'
  }
}

function apply(preference: ThemePreference) {
  const root = globalThis.document?.documentElement
  if (!root) return
  if (preference === 'system') delete root.dataset.theme
  else root.dataset.theme = preference
}

/** Applies the stored choice; call before mounting so the first paint has the right colours. */
export function initTheme(): void {
  themePreference.value = read()
  apply(themePreference.value)
}

export function setTheme(preference: ThemePreference): void {
  themePreference.value = preference
  apply(preference)
  try {
    if (preference === 'system') globalThis.localStorage?.removeItem(STORAGE_KEY)
    else globalThis.localStorage?.setItem(STORAGE_KEY, preference)
  } catch {
    // Not remembered, but applied for this session.
  }
}

/** The theme currently shown, resolving "system". */
export function effectiveTheme(): 'light' | 'dark' {
  if (themePreference.value !== 'system') return themePreference.value
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** Switches between light and dark (Ctrl/⌘+Shift+L). */
export function toggleTheme(): void {
  setTheme(effectiveTheme() === 'dark' ? 'light' : 'dark')
}
