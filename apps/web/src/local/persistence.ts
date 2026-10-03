export type PersistenceStatus = 'persisted' | 'not-persisted' | 'unsupported'

type StorageManagerLike = Pick<StorageManager, 'persisted' | 'persist'>

/**
 * Asks the browser to keep local data even under storage pressure (ADR 0001). Browsers may
 * refuse silently (Safari, Chrome without engagement); the UI then shows a hint.
 */
export async function ensurePersistentStorage(
  storage: StorageManagerLike | undefined = globalThis.navigator?.storage,
  request = true,
): Promise<PersistenceStatus> {
  if (!storage?.persisted || !storage.persist) return 'unsupported'
  try {
    if (await storage.persisted()) return 'persisted'
    if (!request) return 'not-persisted'
    return (await storage.persist()) ? 'persisted' : 'not-persisted'
  } catch {
    return 'not-persisted'
  }
}

export interface StorageUsage {
  usage: number
  quota: number
}

/** Space used by this site (all local data and caches) and the browser's quota for it. */
export async function storageUsage(
  storage: Pick<StorageManager, 'estimate'> | undefined = globalThis.navigator?.storage,
): Promise<StorageUsage | null> {
  if (!storage?.estimate) return null
  try {
    const { usage = 0, quota = 0 } = await storage.estimate()
    return { usage, quota }
  } catch {
    return null
  }
}

/** "12,3 MB" (decimal units like the browsers' own settings pages). */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit++
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1
  return `${value.toLocaleString('de-DE', { maximumFractionDigits: digits, minimumFractionDigits: digits })} ${units[unit]}`
}
