import type { AttachmentUsage } from '@notion-alt/shared'
import { ref } from 'vue'
import { api } from './api'

const LIMITS_KEY = 'notion-alt.attachmentLimits'
const DEFAULT_MAX_FILE_BYTES = 25_000_000

function readCached(): number {
  try {
    const value = Number(localStorage.getItem(LIMITS_KEY))
    return value > 0 ? value : DEFAULT_MAX_FILE_BYTES
  } catch {
    return DEFAULT_MAX_FILE_BYTES
  }
}

/** Largest file the server accepts (operator setting, #64); remembered for offline checks. */
export const maxFileBytes = ref(
  typeof localStorage === 'undefined' ? DEFAULT_MAX_FILE_BYTES : readCached(),
)

/** Fetches storage use and limits of a workspace; null when the server is unreachable. */
export async function refreshAttachmentUsage(workspaceId: string): Promise<AttachmentUsage | null> {
  try {
    const usage = await api.attachmentUsage(workspaceId)
    maxFileBytes.value = usage.maxFileBytes
    try {
      localStorage.setItem(LIMITS_KEY, String(usage.maxFileBytes))
    } catch {
      // Not essential: the default applies offline.
    }
    return usage
  } catch {
    return null
  }
}
