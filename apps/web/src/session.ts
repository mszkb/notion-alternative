import { type User, userSchema } from '@notion-alt/shared'
import { ref } from 'vue'
import { ApiError, api } from './api'

/**
 * - `online`: server reachable, session valid.
 * - `offline`: server or network unreachable; working on local data (ADR 0009).
 * - `expired`: server reachable but session invalid; local data stays usable, sync needs login.
 */
export type ConnectionState = 'online' | 'offline' | 'expired'

export const currentUser = ref<User | null>(null)
export const connection = ref<ConnectionState>('online')
let loaded = false

const LAST_USER_KEY = 'notion-alt.lastUser'

/** Last signed-in user (id and email only, never a token) for offline start. */
export function readLastUser(storage: Storage | undefined = globalThis.localStorage): User | null {
  try {
    const raw = storage?.getItem(LAST_USER_KEY)
    if (!raw) return null
    const parsed = userSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function writeLastUser(user: User | null, storage: Storage | undefined = globalThis.localStorage) {
  try {
    if (user) storage?.setItem(LAST_USER_KEY, JSON.stringify(user))
    else storage?.removeItem(LAST_USER_KEY)
  } catch {
    // Storage unavailable (private mode): offline start is then not possible, nothing else breaks.
  }
}

export interface ResolvedSession {
  user: User | null
  connection: ConnectionState
}

/** Decides who is signed in, falling back to the cached user when the server is unavailable. */
export async function resolveSession(
  me: () => Promise<{ user: User }>,
  cached: User | null,
): Promise<ResolvedSession> {
  try {
    return { user: (await me()).user, connection: 'online' }
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      // An expired session must not lock the user out of local data (ADR 0007, ADR 0009).
      return cached ? { user: cached, connection: 'expired' } : { user: null, connection: 'online' }
    }
    if (cached) return { user: cached, connection: 'offline' }
    throw error
  }
}

/** Loads the current user once; returns null when nobody is (or was) signed in. */
export async function loadCurrentUser(): Promise<User | null> {
  if (loaded) return currentUser.value
  await refreshSession()
  return currentUser.value
}

/** Re-checks the server (startup, focus, `online` event). */
export async function refreshSession(): Promise<ConnectionState> {
  const resolved = await resolveSession(() => api.me(), readLastUser())
  if (resolved.connection === 'online' && resolved.user) writeLastUser(resolved.user)
  // Never switch accounts underneath an open local database because of a background check.
  if (!loaded || !currentUser.value || resolved.user?.id === currentUser.value.id) {
    currentUser.value = resolved.user
  }
  connection.value = resolved.connection
  loaded = true
  return resolved.connection
}

export function setCurrentUser(user: User | null): void {
  currentUser.value = user
  connection.value = 'online'
  writeLastUser(user)
  loaded = true
}
