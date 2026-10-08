import { ref } from 'vue'

/** Pages opened last on this device, per workspace (#134, quick search). Newest first. */
const MAX = 8
const key = (workspaceId: string) => `notion-alt.recent.${workspaceId}`

export const recentPages = ref<string[]>([])

export function loadRecentPages(workspaceId: string): string[] {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(key(workspaceId)) ?? '[]')
    recentPages.value = Array.isArray(value) ? value.filter((v) => typeof v === 'string') : []
  } catch {
    recentPages.value = []
  }
  return recentPages.value
}

export function rememberVisit(workspaceId: string, documentId: string): void {
  recentPages.value = [documentId, ...recentPages.value.filter((id) => id !== documentId)].slice(
    0,
    MAX,
  )
  try {
    globalThis.localStorage?.setItem(key(workspaceId), JSON.stringify(recentPages.value))
  } catch {
    // Not remembered; the list still works for this session.
  }
}
