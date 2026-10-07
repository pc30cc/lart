import "server-only"
import { eq } from "drizzle-orm"
import { redirect } from "next/navigation"
import { getLocale } from "next-intl/server"
import { cache } from "react"

import { db } from "@/db"
import { admins } from "@/db/schema"
import { isSameOrigin } from "./request"
import { currentSession, deleteSession } from "./session"

/**
 * Super-admin authentication. SIGNATURES ARE FIXED (other modules import them).
 * `photoPath` was added later and is optional (tests mock sessions without it):
 * read it as `admin.photoPath ?? null`.
 */
export type AdminSession = {
  sessionId: string
  admin: { id: string; email: string; name: string; shareBp: number; photoPath?: string | null }
}

/** The signed-in super admin, or null. Never throws for a missing session. Cached per request. */
export async function getAdmin(): Promise<AdminSession | null> {
  return loadAdmin()
}

const loadAdmin = cache(async (): Promise<AdminSession | null> => {
  const session = await currentSession("admin")
  if (!session) return null
  const [admin] = await db
    .select({
      id: admins.id,
      email: admins.email,
      name: admins.name,
      shareBp: admins.shareBp,
      photoPath: admins.photoPath,
      active: admins.active,
    })
    .from(admins)
    .where(eq(admins.id, session.subjectId))
    .limit(1)
  if (!admin?.active) {
    await deleteSession(session.id)
    return null
  }
  return {
    sessionId: session.id,
    admin: { id: admin.id, email: admin.email, name: admin.name, shareBp: admin.shareBp, photoPath: admin.photoPath },
  }
})

/** For pages and server actions: the signed-in admin, or redirect to the admin login. */
export async function requireAdmin(): Promise<AdminSession> {
  const session = await getAdmin()
  if (session) return session
  redirect(`/${await getLocale()}/admin/login`)
}

/** For route handlers: the signed-in admin, or null (caller answers 401). Also checks same-origin for unsafe methods. */
export async function requireAdminApi(request: Request): Promise<AdminSession | null> {
  if (!isSameOrigin(request)) return null
  return getAdmin()
}
