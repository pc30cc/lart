import { notFound, redirect } from "next/navigation"
import { hasLocale } from "next-intl"

import { routing } from "@/i18n/routing"

// Until the public home page exists (phase 3, theme system), a language root
// opens the workshops list. A temporary redirect, as the home page will
// replace this file.
export default async function LocaleHome({ params }: PageProps<"/[locale]">) {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) notFound()
  redirect(`/${locale}/workshops`)
}
