import "server-only"
import { eq } from "drizzle-orm"
import { redirect } from "next/navigation"
import { hasLocale } from "next-intl"
import { getLocale } from "next-intl/server"
import { cache } from "react"

import { db } from "@/db"
import { instructors, type LocalizedText } from "@/db/schema"
import { locales, type AppLocale } from "@/i18n/routing"
import { currentPath, isSameOrigin } from "./request"
import { safeNext } from "./safe-next"
import { currentSession, deleteSession } from "./session"

/**
 * Instructor authentication. SIGNATURES ARE FIXED (other modules import them).
 * A deactivated instructor has no session: it is ended on the next request.
 */
export type InstructorSession = {
  sessionId: string
  instructor: {
    id: string
    email: string
    /** Public display name; show it with `profileText(displayName, locale)`. */
    displayName: LocalizedText
    /** Language of the instructor's emails and panel (instructors.locale). */
    locale: AppLocale
    emailVerified: boolean
  }
}

/** The signed-in, active instructor, or null. Never throws for a missing session. Cached per request. */
export async function getInstructor(): Promise<InstructorSession | null> {
  return loadInstructor()
}

const loadInstructor = cache(async (): Promise<InstructorSession | null> => {
  const session = await currentSession("instructor")
  if (!session) return null
  const [row] = await db
    .select({
      id: instructors.id,
      email: instructors.email,
      displayName: instructors.displayName,
      locale: instructors.locale,
      active: instructors.active,
      emailVerifiedAt: instructors.emailVerifiedAt,
    })
    .from(instructors)
    .where(eq(instructors.id, session.subjectId))
    .limit(1)
  if (!row?.active) {
    await deleteSession(session.id)
    return null
  }
  return {
    sessionId: session.id,
    instructor: {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      locale: hasLocale(locales, row.locale) ? row.locale : "tr",
      emailVerified: row.emailVerifiedAt !== null,
    },
  }
})

/**
 * For panel pages, queries and server actions: the signed-in instructor, or
 * redirect to the instructor login, which comes back to `next` (default: the
 * current page, when it is in the panel).
 */
export async function requireInstructor(next?: string): Promise<InstructorSession> {
  const session = await getInstructor()
  if (session) return session
  const back = safeNext(next ?? (await currentPath()), "instructor", "")
  redirect(`/${await getLocale()}/instructor/login${back ? `?next=${encodeURIComponent(back)}` : ""}`)
}

/** For route handlers: the signed-in instructor, or null (caller answers 401). Also checks same-origin for unsafe methods. */
export async function requireInstructorApi(request: Request): Promise<InstructorSession | null> {
  if (!isSameOrigin(request)) return null
  return getInstructor()
}
