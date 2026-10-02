import type { User } from '@notion-alt/shared'
import { ref } from 'vue'
import { ApiError, api } from './api'

export const currentUser = ref<User | null>(null)
let loaded = false

/** Loads the current user once; returns null when not logged in. */
export async function loadCurrentUser(): Promise<User | null> {
  if (loaded) return currentUser.value
  try {
    currentUser.value = (await api.me()).user
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 401)) throw error
    currentUser.value = null
  }
  loaded = true
  return currentUser.value
}

export function setCurrentUser(user: User | null): void {
  currentUser.value = user
  loaded = true
}
