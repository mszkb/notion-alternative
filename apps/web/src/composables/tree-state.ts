import { reactive, watch } from 'vue'

const KEY = 'notion-alt.expanded'

function load(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

/** Expanded nodes of the page tree, remembered per browser (UI state only, not synced). */
export const expanded = reactive(new Set<string>(load()))

watch(expanded, () => {
  try {
    localStorage.setItem(KEY, JSON.stringify([...expanded]))
  } catch {
    // Not essential.
  }
})
