import { liveQuery, type Subscription } from 'dexie'
import { onScopeDispose, type Ref, shallowRef, watch, type WatchSource } from 'vue'

/**
 * Reactive result of a Dexie query; re-runs whenever the tables it read change (also for writes
 * from other tabs). `source` restarts the query when e.g. a route parameter changes.
 */
export function useLiveQuery<T>(
  query: () => Promise<T>,
  initial: T,
  source?: WatchSource,
): Readonly<Ref<T>> {
  const value = shallowRef<T>(initial)
  let subscription: Subscription | null = null
  const start = () => {
    subscription?.unsubscribe()
    // An async querier lets Dexie track native awaits inside the store methods.
    subscription = liveQuery(async () => query()).subscribe({
      next: (result) => (value.value = result),
      error: (error) => console.error('Live query failed', error),
    })
  }
  if (source) watch(source, start, { immediate: true })
  else start()
  onScopeDispose(() => subscription?.unsubscribe())
  return value
}
