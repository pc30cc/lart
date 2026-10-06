/**
 * Small in-memory fixed-window rate limiter. Per process: fine for the single
 * container this app runs in. Use it for login and other abuse-prone actions.
 */
export type RateLimitResult = { ok: boolean; remaining: number; retryAfterMs: number }

export function createRateLimiter({ limit, windowMs }: { limit: number; windowMs: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>()

  function prune(now: number) {
    if (hits.size < 10_000) return
    for (const [key, hit] of hits) if (hit.resetAt <= now) hits.delete(key)
  }

  return {
    /** Count one attempt for `key`. `ok: false` means the caller must refuse it. */
    consume(key: string, now = Date.now()): RateLimitResult {
      prune(now)
      let hit = hits.get(key)
      if (!hit || hit.resetAt <= now) {
        hit = { count: 0, resetAt: now + windowMs }
        hits.set(key, hit)
      }
      hit.count += 1
      const ok = hit.count <= limit
      return { ok, remaining: Math.max(0, limit - hit.count), retryAfterMs: ok ? 0 : hit.resetAt - now }
    },
    reset(key: string) {
      hits.delete(key)
    },
  }
}

/** Login attempts per client IP and principal kind: 10 per 15 minutes. */
export const loginRateLimiter = createRateLimiter({ limit: 10, windowMs: 15 * 60_000 })
