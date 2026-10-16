/**
 * App-wide keyboard shortcuts as in Notion (#134, docs/product/ux-guide.md). Editor shortcuts
 * (bold, italic, code, link, undo) live in the editor; these act everywhere else.
 */
export type ShortcutCommand = 'palette' | 'newPage' | 'toggleTheme' | 'sidebar' | 'shortcuts'

/**
 * The command for a key press, or null. Ctrl/⌘+K opens the quick search everywhere, also in
 * text (#197); only with selected text the editor turns it into a link and marks the event as
 * handled.
 */
export function shortcutFor(event: KeyboardEvent): ShortcutCommand | null {
  if (event.defaultPrevented) return null
  const mod = event.ctrlKey || event.metaKey
  if (!mod) return null
  const key = event.key.toLowerCase()
  if (event.shiftKey && !event.altKey && key === 'l') return 'toggleTheme'
  if (event.shiftKey) return null
  if (key === 'p' && !event.altKey) return 'palette'
  if (key === 'k' && !event.altKey) return 'palette'
  if (key === 'n') return 'newPage'
  if (key === '\\' && !event.altKey) return 'sidebar'
  if (key === '/' && !event.altKey) return 'shortcuts'
  return null
}

/** Overview shown with Ctrl/⌘ + / (and in the sidebar under "Tastenkürzel"). */
export const SHORTCUT_OVERVIEW: { keys: string; action: string }[] = [
  { keys: 'Strg/⌘ + K oder Strg/⌘ + P', action: 'Schnellsuche und Befehle, auch beim Schreiben' },
  { keys: 'Strg/⌘ + N (im Browser: Strg/⌘ + Alt + N)', action: 'Neue Seite' },
  { keys: 'Strg/⌘ + \\', action: 'Seitenleiste ein-/ausblenden' },
  { keys: 'Strg/⌘ + Umschalt + L', action: 'Hell/Dunkel umschalten' },
  { keys: 'Strg/⌘ + /', action: 'Diese Übersicht' },
  { keys: 'Strg/⌘ + B / I / E', action: 'Fett, kursiv, Code (im Text)' },
  { keys: 'Strg/⌘ + K (Text markiert)', action: 'Markierten Text verlinken (Seite oder URL)' },
  { keys: 'Strg/⌘ + Z / Umschalt + Z', action: 'Rückgängig / Wiederholen' },
  { keys: '/ (im Text)', action: 'Block einfügen oder umwandeln' },
  { keys: 'Esc', action: 'Menü schließen, Blöcke auswählen' },
]
