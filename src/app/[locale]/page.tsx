import { notFound, redirect } from "next/navigation"
import { hasLocale } from "next-intl"

import { routing } from "@/i18n/routing"

// No public site in phase 1: a language root goes to the admin panel (the proxy
// sends visitors without a session on to the login). A temporary redirect, as
// the public home page will replace this file.
export default async function LocaleHome({ params }: PageProps<"/[locale]">) {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) notFound()
  redirect(`/${locale}/admin`)
}
