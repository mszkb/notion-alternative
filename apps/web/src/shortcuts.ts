/**
 * App-wide keyboard shortcuts as in Notion (#134, docs/product/ux-guide.md). Editor shortcuts
 * (bold, italic, code, link, undo) live in the editor; these act everywhere else.
 */
export type ShortcutCommand = 'palette' | 'newPage' | 'toggleTheme' | 'sidebar' | 'shortcuts'

/**
 * The command for a key press, or null. `inText`: the focus is in an editable field, where
 * Ctrl/⌘+K inserts a link instead (the editor handles it and marks the event as handled).
 */
export function shortcutFor(event: KeyboardEvent, inText: boolean): ShortcutCommand | null {
  if (event.defaultPrevented) return null
  const mod = event.ctrlKey || event.metaKey
  if (!mod) return null
  const key = event.key.toLowerCase()
  if (event.shiftKey && !event.altKey && key === 'l') return 'toggleTheme'
  if (event.shiftKey) return null
  if (key === 'p' && !event.altKey) return 'palette'
  if (key === 'k' && !event.altKey && !inText) return 'palette'
  if (key === 'n') return 'newPage'
  if (key === '\\' && !event.altKey) return 'sidebar'
  if (key === '/' && !event.altKey) return 'shortcuts'
  return null
}

/** Whether the event comes from a text input or an editable block. */
export function isTextTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.closest !== 'function') return false
  return !!el.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')
}

/** Overview shown with Ctrl/⌘ + / (and in the sidebar under "Tastenkürzel"). */
export const SHORTCUT_OVERVIEW: { keys: string; action: string }[] = [
  { keys: 'Strg/⌘ + K oder Strg/⌘ + P', action: 'Schnellsuche und Befehle' },
  { keys: 'Strg/⌘ + N (im Browser: Strg/⌘ + Alt + N)', action: 'Neue Seite' },
  { keys: 'Strg/⌘ + \\', action: 'Seitenleiste ein-/ausblenden' },
  { keys: 'Strg/⌘ + Umschalt + L', action: 'Hell/Dunkel umschalten' },
  { keys: 'Strg/⌘ + /', action: 'Diese Übersicht' },
  { keys: 'Strg/⌘ + B / I / E', action: 'Fett, kursiv, Code (im Text)' },
  { keys: 'Strg/⌘ + K (im Text)', action: 'Link auf eine Seite einfügen' },
  { keys: 'Strg/⌘ + Z / Umschalt + Z', action: 'Rückgängig / Wiederholen' },
  { keys: 'Esc', action: 'Menü schließen, Blöcke auswählen' },
]
