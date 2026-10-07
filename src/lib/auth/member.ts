import "server-only"
import { eq } from "drizzle-orm"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { hasLocale } from "next-intl"
import { getLocale } from "next-intl/server"
import { cache } from "react"

import { db } from "@/db"
import { members } from "@/db/schema"
import { locales, type AppLocale } from "@/i18n/routing"
import { isSameOrigin } from "./request"
import { safeNext } from "./safe-next"
import { currentSession, deleteSession } from "./session"

/**
 * Member (student) authentication. SIGNATURES ARE FIXED (other modules import
 * them). Members have no panel: they use the public site.
 */
export type MemberSession = {
  sessionId: string
  member: {
    id: string
    email: string
    name: string
    phone: string | null
    /** Language of the member's emails (members.locale). */
    locale: AppLocale
    /** Registering and paying needs a verified email (README §4). */
    emailVerified: boolean
  }
}

/** The signed-in member, or null. Never throws for a missing session. Cached per request. */
export async function getMember(): Promise<MemberSession | null> {
  return loadMember()
}

const loadMember = cache(async (): Promise<MemberSession | null> => {
  const session = await currentSession("member")
  if (!session) return null
  const [row] = await db
    .select({
      id: members.id,
      email: members.email,
      name: members.name,
      phone: members.phone,
      locale: members.locale,
      emailVerifiedAt: members.emailVerifiedAt,
    })
    .from(members)
    .where(eq(members.id, session.subjectId))
    .limit(1)
  if (!row) {
    await deleteSession(session.id)
    return null
  }
  return {
    sessionId: session.id,
    member: {
      id: row.id,
      email: row.email,
      name: row.name,
      phone: row.phone,
      locale: hasLocale(locales, row.locale) ? row.locale : "tr",
      emailVerified: row.emailVerifiedAt !== null,
    },
  }
})

/**
 * The page a sign-in should come back to: the current page (the proxy passes
 * its path as `x-pathname`, also for server actions posted from it).
 */
export async function currentPath(): Promise<string | undefined> {
  try {
    return (await headers()).get("x-pathname") ?? undefined
  } catch {
    return undefined // outside a request
  }
}

/**
 * For pages, queries and server actions: the signed-in member, or redirect to
 * the member login, which comes back to `next` (default: the current page).
 */
export async function requireMember(next?: string): Promise<MemberSession> {
  const session = await getMember()
  if (session) return session
  const back = safeNext(next ?? (await currentPath()), "member", "")
  redirect(`/${await getLocale()}/account/login${back ? `?next=${encodeURIComponent(back)}` : ""}`)
}

/** For route handlers: the signed-in member, or null (caller answers 401). Also checks same-origin for unsafe methods. */
export async function requireMemberApi(request: Request): Promise<MemberSession | null> {
  if (!isSameOrigin(request)) return null
  return getMember()
}
