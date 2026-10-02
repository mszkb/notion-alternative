import type { Workspace } from '@notion-alt/shared'
import { ref, shallowRef } from 'vue'
import { api } from '../api'
import { connection } from '../session'
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
const searches = new Map<string, Promise<WorkspaceSearch>>()

const PERSIST_REQUESTED = 'persistRequested'

export function openLocalStore(userId: string): Promise<LocalStore> {
  if (opening && openUserId === userId) return opening
  closeLocalStore()
  openUserId = userId
  opening = (async () => {
    const store = await LocalStore.open(new LocalDb(localDbName(userId)))
    localStore.value = store
    // Ask for persistent storage once on first start; afterwards only report the status.
    const asked = await store.db.meta.get(PERSIST_REQUESTED)
    persistence.value = await ensurePersistentStorage(undefined, !asked)
    if (!asked) await store.db.meta.put({ key: PERSIST_REQUESTED, value: true })
    workspaces.value = await store.cachedWorkspaces()
    return store
  })()
  opening.catch(() => {
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
  opening = null
  openUserId = null
}

export function requireStore(): LocalStore {
  if (!localStore.value) throw new Error('Local store is not open')
  return localStore.value
}

/** Re-asks the browser for persistent storage (button in the sidebar). */
export async function requestPersistence(): Promise<void> {
  persistence.value = await ensurePersistentStorage()
}

/** Refreshes the workspace cache from the server; keeps the cached list when offline. */
export async function refreshWorkspaces(store: LocalStore): Promise<Workspace[]> {
  if (connection.value === 'online') {
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

export function lastWorkspaceId(): string | null {
  try {
    return localStorage.getItem(LAST_WORKSPACE_KEY)
  } catch {
    return null
  }
}
