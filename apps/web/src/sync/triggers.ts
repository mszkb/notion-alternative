import { connection } from '../session'

export interface TriggerOptions {
  /** Regular sync while the app is visible (ADR 0002: 5 minutes). */
  intervalMs: number
  /** How often to look whether a run is due; also re-checks an unreachable server sooner. */
  checkMs: number
  /** Delay after a local change before its operations are sent. */
  afterChangeMs: number
}

export const DEFAULT_TRIGGERS: TriggerOptions = {
  intervalMs: 5 * 60_000,
  checkMs: 60_000,
  afterChangeMs: 1500,
}

/**
 * Starts the sync triggers independent of Web Push (principle 4, T-OFF-06): app start, focus,
 * tab becoming visible, `online`, a timer while visible, and local changes (debounced). Returns
 * a function to stop them plus `changed()` to call after local writes.
 */
export function startSyncTriggers(
  run: () => Promise<void>,
  options: TriggerOptions = DEFAULT_TRIGGERS,
  /** Lighter run after local changes (no session or workspace refresh needed). */
  runAfterChange: () => Promise<void> = run,
): { stop: () => void; changed: () => void } {
  let lastRun = 0
  let changeTimer: ReturnType<typeof setTimeout> | null = null

  const trigger = () => {
    lastRun = Date.now()
    void run()
  }
  const onVisibility = () => {
    if (document.visibilityState === 'visible') trigger()
  }
  const tick = () => {
    // Hidden tabs do not poll (battery, data volume); they catch up when they become visible.
    if (document.visibilityState !== 'visible') return
    if (connection.value !== 'online' || Date.now() - lastRun >= options.intervalMs) trigger()
  }

  trigger()
  window.addEventListener('online', trigger)
  window.addEventListener('focus', trigger)
  document.addEventListener('visibilitychange', onVisibility)
  const interval = setInterval(tick, options.checkMs)

  return {
    changed: () => {
      if (changeTimer) clearTimeout(changeTimer)
      changeTimer = setTimeout(() => void runAfterChange(), options.afterChangeMs)
    },
    stop: () => {
      window.removeEventListener('online', trigger)
      window.removeEventListener('focus', trigger)
      document.removeEventListener('visibilitychange', onVisibility)
      clearInterval(interval)
      if (changeTimer) clearTimeout(changeTimer)
    },
  }
}
