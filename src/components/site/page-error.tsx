"use client"

import { TriangleAlertIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useEffect } from "react"

import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/navigation"

/**
 * What a student or an instructor sees when a page of the site or of the
 * instructor's sign-in pages fails unexpectedly (e.g. the database is briefly
 * away): a friendly message in their language, a big "Try again" (fetches the
 * page again) and one calm way on. Never the error's details or digest.
 */
export function PageError({
  error,
  retry,
  href,
  label,
}: {
  error: Error & { digest?: string }
  retry: () => void
  href: string
  label: string
}) {
  const t = useTranslations("common.panelError")
  useEffect(() => console.error(error), [error])

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <div className="bg-destructive/10 text-destructive flex size-14 items-center justify-center rounded-2xl">
          <TriangleAlertIcon className="size-7" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-balance">{t("title")}</h1>
        <p className="text-muted-foreground text-pretty">{t("description")}</p>
        <Button size="lg" className="mt-2 h-12 w-full rounded-xl text-base" onClick={() => retry()}>
          {t("retry")}
        </Button>
        <Button asChild variant="ghost" className="text-muted-foreground h-11 w-full text-base">
          <Link href={href}>{label}</Link>
        </Button>
      </div>
    </div>
  )
}
