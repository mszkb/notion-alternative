import { type User, userSchema } from '@notion-alt/shared'
import { ref } from 'vue'
import { ApiError, api } from './api'

/**
 * - `online`: server reachable, session valid.
 * - `offline`: server or network unreachable; working on local data (ADR 0009).
 * - `expired`: server reachable but session invalid; local data stays usable, sync needs login.
 * - `local`: nobody signed in; working in the local area without an account (ADR 0023), no
 *   requests to the server until the user signs in.
 */
export type ConnectionState = 'online' | 'offline' | 'expired' | 'local'

export const currentUser = ref<User | null>(null)
export const connection = ref<ConnectionState>('online')
let loaded = false

const LAST_USER_KEY = 'notion-alt.lastUser'
const START_KEY = 'notion-alt.start'

/**
 * Where the app starts when nobody is signed in (ADR 0023): in the local area without an account
 * (default, also on the very first start) or on the login page (after signing out).
 */
export type StartMode = 'local' | 'login'

export function readStartMode(storage: Storage | undefined = globalThis.localStorage): StartMode {
  try {
    return storage?.getItem(START_KEY) === 'login' ? 'login' : 'local'
  } catch {
    return 'local'
  }
}

export function writeStartMode(
  mode: StartMode,
  storage: Storage | undefined = globalThis.localStorage,
): void {
  try {
    if (mode === 'login') storage?.setItem(START_KEY, 'login')
    else storage?.removeItem(START_KEY)
  } catch {
    // Storage unavailable: the app starts without an account, nothing else breaks.
  }
}

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
  start: StartMode = 'login',
): Promise<ResolvedSession> {
  try {
    return { user: (await me()).user, connection: 'online' }
  } catch (error) {
    // Nobody signed in on this device: work without an account unless the login was asked for.
    if (!cached && start === 'local') return { user: null, connection: 'local' }
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

/**
 * Re-checks the server (startup, focus, `online` event). Without an account only the startup
 * asks once whether a session exists (e.g. the cached sign-in was cleared); later checks send
 * nothing (ADR 0023).
 */
export async function refreshSession(): Promise<ConnectionState> {
  if (loaded && connection.value === 'local' && !currentUser.value) return 'local'
  const resolved = await resolveSession(() => api.me(), readLastUser(), readStartMode())
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

/** Continues without an account in the local area (ADR 0023); sign in later at any time. */
export function continueWithoutAccount(): void {
  writeStartMode('local')
  currentUser.value = null
  connection.value = 'local'
  loaded = true
}

/** After signing out the app shows the login, with the choice to continue without an account. */
export function signedOut(): void {
  writeStartMode('login')
  setCurrentUser(null)
}
