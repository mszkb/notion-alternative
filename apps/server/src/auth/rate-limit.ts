/**
 * In-memory attempt counter with a fixed window per key.
 *
 * Sufficient for the single backend process (ADR 0006). Counters are lost on
 * restart, which is acceptable for brute-force throttling.
 */
/** Upper bound of tracked keys; protects memory when many addresses or emails are tried. */
const MAX_ENTRIES = 10_000

export class AttemptLimiter {
  private readonly entries = new Map<string, { count: number; resetAt: number }>()

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Seconds until the key may try again, or 0 if it is not blocked. */
  retryAfter(key: string): number {
    const entry = this.entries.get(key)
    if (!entry) return 0
    const remaining = entry.resetAt - this.now()
    if (remaining <= 0) {
      this.entries.delete(key)
      return 0
    }
    return entry.count >= this.max ? Math.ceil(remaining / 1000) : 0
  }

  record(key: string): void {
    const now = this.now()
    const entry = this.entries.get(key)
    if (entry && entry.resetAt > now) {
      entry.count++
      return
    }
    if (this.entries.size >= MAX_ENTRIES) this.prune(now)
    this.entries.set(key, { count: 1, resetAt: now + this.windowMs })
  }

  reset(key: string): void {
    this.entries.delete(key)
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) this.entries.delete(key)
    }
    // Still full (many live keys): drop the oldest so memory stays bounded.
    for (const key of this.entries.keys()) {
      if (this.entries.size < MAX_ENTRIES) break
      this.entries.delete(key)
    }
  }
}
