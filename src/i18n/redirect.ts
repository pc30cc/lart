import "server-only"
import { redirect } from "next/navigation"
import { getLocale } from "next-intl/server"

import { localeHref } from "./links"

/** Redirect to `path` (without a language) in `locale`, by default the current page's language. */
export async function localeRedirect(path: string, locale?: string): Promise<never> {
  redirect(await localeHref(locale ?? (await getLocale()), path))
}
