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
