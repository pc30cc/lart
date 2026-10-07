"use client"

import { useTranslations } from "next-intl"

import { PageError } from "@/components/site/page-error"

/**
 * The catch-all for a failure that the areas' own boundaries cannot show
 * because it happened in their layout: the site frame (`(site)/layout.tsx`:
 * brand, signed-in member) or the instructor's sign-in pages
 * (`instructor/(auth)/layout.tsx`). A full page with "Try again" and the way
 * to the home page; never the error's details.
 */
export default function LocaleError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useTranslations("common.notFound")
  return (
    <main className="flex min-h-svh flex-col">
      <PageError error={error} retry={retry} href="/" label={t("home")} />
    </main>
  )
}
