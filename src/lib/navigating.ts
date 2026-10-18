import { unstable_rethrow } from "next/navigation"

/**
 * Whether `err` is Next.js navigating (a server action's `redirect()`, e.g. to
 * the login when the session ended), not a failure. For handlers outside a
 * transition, where rethrowing would only navigate a second time.
 */
export function isNavigating(err: unknown): boolean {
  try {
    unstable_rethrow(err)
    return false
  } catch {
    return true
  }
}
