import type { Workspace } from '@notion-alt/shared'
import { Dexie } from 'dexie'
import { ref, shallowRef } from 'vue'
import { api } from '../api'
import { deviceStatus, registerDevice } from '../device'
import { connection } from '../session'
import { stopSync } from '../sync/engine'
import { LocalDb, localDbName } from './db'
import { ensurePersistentStorage, type PersistenceStatus } from './persistence'
import { WorkspaceSearch } from './search'
import { LocalStore } from './store'

/** App-wide handle to the signed-in user's local database. */
export const localStore = shallowRef<LocalStore | null>(null)
export const persistence = ref<PersistenceStatus | 'unknown'>('unknown')
export const workspaces = ref<Workspace[]>([])

let openUserId: string | null = null
let opening: Promise<LocalStore> | null = null
/** Identifies the current open; a superseded open (user switch, logout) must not touch state. */
let generation: object | null = null
const searches = new Map<string, Promise<WorkspaceSearch>>()

const PERSIST_REQUESTED = 'persistRequested'

export function openLocalStore(userId: string): Promise<LocalStore> {
  if (opening && openUserId === userId) return opening
  closeLocalStore()
  openUserId = userId
  const token = {}
  generation = token
  opening = (async () => {
    const store = await LocalStore.open(new LocalDb(localDbName(userId)))
    const superseded = () => {
      if (generation === token) return false
      store.db.close()
      return true
    }
    if (superseded()) throw new Error('Opening the local store was superseded')
    // Ask for persistent storage once on first start; afterwards only report the status.
    const asked = await store.db.meta.get(PERSIST_REQUESTED)
    const status = await ensurePersistentStorage(undefined, !asked)
    if (!asked) await store.db.meta.put({ key: PERSIST_REQUESTED, value: true })
    const cached = await store.cachedWorkspaces()
    if (superseded()) throw new Error('Opening the local store was superseded')
    localStore.value = store
    persistence.value = status
    workspaces.value = cached
    return store
  })()
  opening.catch(() => {
    if (generation !== token) return
    opening = null
    openUserId = null
  })
  return opening
}

export function closeLocalStore(): void {
  for (const search of searches.values()) void search.then((s) => s.stop())
  searches.clear()
  localStore.value?.db.close()
  localStore.value = null
  workspaces.value = []
  deviceStatus.value = 'unknown'
  stopSync()
  opening = null
  openUserId = null
  generation = null
}

export function requireStore(): LocalStore {
  if (!localStore.value) throw new Error('Local store is not open')
  return localStore.value
}

/** Re-asks the browser for persistent storage (button in the sidebar). */
export async function requestPersistence(): Promise<void> {
  persistence.value = await ensurePersistentStorage()
}

/**
 * Online refresh: registers this device (idempotent, also after an offline start) and refreshes
 * the workspace cache; keeps the cached list when offline.
 */
export async function refreshWorkspaces(store: LocalStore): Promise<Workspace[]> {
  if (connection.value === 'online') {
    await registerDevice(store.deviceId)
    try {
      await store.cacheWorkspaces((await api.listWorkspaces()).workspaces)
    } catch {
      // Unreachable or expired: the cached list stays authoritative for local work.
    }
  }
  workspaces.value = await store.cachedWorkspaces()
  return workspaces.value
}

export function workspaceSearch(store: LocalStore, workspaceId: string): Promise<WorkspaceSearch> {
  let search = searches.get(workspaceId)
  if (!search) {
    const instance = new WorkspaceSearch(store, workspaceId)
    search = instance.start().then(() => instance)
    searches.set(workspaceId, search)
  }
  return search
}

const LAST_WORKSPACE_KEY = 'notion-alt.lastWorkspace'

export function rememberWorkspace(workspaceId: string): void {
  try {
    localStorage.setItem(LAST_WORKSPACE_KEY, workspaceId)
  } catch {
    // Not essential.
  }
}

/**
 * Removes everything this app stored locally for the user: the local database (pages, queue,
 * device id) and the remembered workspace. Only after explicit confirmation (shared devices).
 */
export async function deleteLocalData(userId: string): Promise<void> {
  closeLocalStore()
  // Other tabs close their connection on `versionchange` (Dexie default), so this completes.
  await Dexie.delete(localDbName(userId))
  try {
    localStorage.removeItem(LAST_WORKSPACE_KEY)
    // Ids of pages expanded in the tree are traces of the content too.
    localStorage.removeItem('notion-alt.expanded')
  } catch {
    // Storage unavailable: nothing stored there either.
  }
}

export function lastWorkspaceId(): string | null {
  try {
    return localStorage.getItem(LAST_WORKSPACE_KEY)
  } catch {
    return null
  }
}
