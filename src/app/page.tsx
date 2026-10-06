import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { hasLocale } from "next-intl"

import { routing } from "@/i18n/routing"
import { getSetting } from "@/lib/settings"

/** "/" → "/<language>": the visitor's saved choice (NEXT_LOCALE cookie) or the site's default language setting. */
export default async function RootPage() {
  const saved = (await cookies()).get("NEXT_LOCALE")?.value
  const locale = hasLocale(routing.locales, saved) ? saved : await getSetting("defaultLocale")
  redirect(`/${locale}`)
}
