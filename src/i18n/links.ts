import "server-only"
import { cache } from "react"

import { env } from "@/lib/env"
import { getMainLocale } from "./main-locale"
import { localePath } from "./paths"

/**
 * Server-side addresses in a language (docs/DEVELOPMENT.md, "URL rules"):
 * pages, actions, emails and the jobs script build every link with these,
 * never by hand. No `next/*` import, so scripts/jobs.ts can use them.
 */

/** The main language, read once per render (the same value for every link of a page). */
export const mainLocale = cache(getMainLocale)

/** `path` (without a language, may carry ?query) in `locale`: "/workshops" → "/workshops" or "/fa/workshops". */
export async function localeHref(locale: string, path: string): Promise<string> {
  return localePath(locale, path, await mainLocale())
}

/** The same as an absolute URL on APP_URL (emails, invitation links to copy). */
export async function absoluteLocaleUrl(locale: string, path: string): Promise<string> {
  return new URL(await localeHref(locale, path), env.APP_URL).href
}
