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

/**
 * The client part of a rate-limit key: the IPv4 address as it is, or the /64
 * network of an IPv6 address (one subscriber usually gets a whole /64, so
 * per-address limits are trivial to dodge by rotating addresses).
 */
export function rateLimitClient(ip: string): string {
  const addr = ip.trim().toLowerCase().split("%")[0]
  if (!addr.includes(":")) return addr
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(addr)
  if (mapped) return mapped[1]
  const groups = (part: string) => (part ? part.split(":").flatMap((g) => (g.includes(".") ? ["0", "0"] : [g])) : [])
  const [head, tail] = addr.split("::", 2)
  const left = groups(head)
  const right = tail === undefined ? [] : groups(tail)
  const full = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right]
  if (full.length !== 8 || full.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return addr
  return `${full
    .slice(0, 4)
    .map((g) => parseInt(g, 16).toString(16))
    .join(":")}::/64`
}
