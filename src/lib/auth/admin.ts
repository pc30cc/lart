import "server-only"

/**
 * Super-admin authentication. SIGNATURES ARE FIXED (other modules import them);
 * the core-shell work replaces the bodies.
 */
export type AdminSession = {
  sessionId: string
  admin: { id: string; email: string; name: string; shareBp: number }
}

/** The signed-in super admin, or null. Never throws for a missing session. */
export async function getAdmin(): Promise<AdminSession | null> {
  throw new Error("not implemented")
}

/** For pages and server actions: the signed-in admin, or redirect to the admin login. */
export async function requireAdmin(): Promise<AdminSession> {
  throw new Error("not implemented")
}

/** For route handlers: the signed-in admin, or null (caller answers 401). Also checks same-origin for unsafe methods. */
export async function requireAdminApi(request: Request): Promise<AdminSession | null> {
  void request
  throw new Error("not implemented")
}
