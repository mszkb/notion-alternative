import { ref } from 'vue'

/**
 * Sidebar state on wide screens (#132): collapsed or not, and its width. Remembered per device
 * and browser; narrow screens use the overlay instead and ignore both.
 */
export const SIDEBAR_MIN_WIDTH = 200
export const SIDEBAR_MAX_WIDTH = 480
const DEFAULT_WIDTH = 272
const COLLAPSED_KEY = 'notion-alt.sidebar.collapsed'
const WIDTH_KEY = 'notion-alt.sidebar.width'

function load(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function save(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value)
  } catch {
    // Not remembered (storage blocked); the state still applies until reload.
  }
}

export function clampSidebarWidth(width: number): number {
  return Math.round(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width)))
}

export const sidebarCollapsed = ref(load(COLLAPSED_KEY) === 'true')
export const sidebarWidth = ref(clampSidebarWidth(Number(load(WIDTH_KEY)) || DEFAULT_WIDTH))

export function setSidebarCollapsed(collapsed: boolean): void {
  sidebarCollapsed.value = collapsed
  save(COLLAPSED_KEY, String(collapsed))
}

export function setSidebarWidth(width: number): void {
  sidebarWidth.value = clampSidebarWidth(width)
  save(WIDTH_KEY, String(sidebarWidth.value))
}

/** Ctrl/⌘ + \ (as in Notion). */
export function isSidebarShortcut(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && event.key === '\\'
}
