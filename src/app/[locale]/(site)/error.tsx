"use client"

import { useTranslations } from "next-intl"

import { PageError } from "@/components/site/page-error"

/**
 * An unexpected failure on a page of the public site (workshops, register,
 * My workshops, the account pages): a friendly message inside the site's
 * frame, "Try again" and a way back to the workshops.
 */
export default function SiteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useTranslations("site.error")
  return <PageError error={error} retry={retry} href="/workshops" label={t("workshops")} />
}
