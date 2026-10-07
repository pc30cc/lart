"use client"

import { EyeIcon, LogOutIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { endImpersonationAction } from "@/features/accounts/actions"
import { isolate } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * "You are viewing as {name} — signed in as {admin}  [End]": on every page of
 * the instructor panel or the site while a super admin views as that person.
 * End closes the viewing session (it needs no admin cookie) and goes back to
 * the person's admin page. Not printed.
 */
export function ImpersonationBar({
  kind,
  personId,
  personName,
  adminName,
  width,
}: {
  kind: "instructor" | "member"
  personId: string
  personName: string
  adminName: string
  /** The width of the area's content, so the bar lines up with it. */
  width: "max-w-4xl" | "max-w-6xl"
}) {
  const t = useTranslations("common.impersonation")
  const tc = useTranslations("common")
  const [pending, startTransition] = useTransition()

  function end() {
    startTransition(async () => {
      try {
        const result = await endImpersonationAction({ kind, id: personId })
        if (!result) return // redirected to the admin page
        if (!result.ok) toast.error(result.error)
      } catch {
        toast.error(tc("errors.network"))
      }
    })
  }

  return (
    <div role="region" aria-label={t("label")} className="bg-foreground text-background print:hidden">
      <div className={cn("mx-auto flex items-center gap-3 px-4 py-2 text-sm", width)}>
        <EyeIcon aria-hidden className="size-4.5 shrink-0 opacity-80" />
        <p className="min-w-0 flex-1 leading-snug text-pretty">
          {/* The names isolated, so they read correctly inside Persian text. */}
          {t("text", { name: isolate(personName), admin: isolate(adminName) })}
        </p>
        <Button size="sm" variant="secondary" className="h-8 shrink-0 rounded-full px-3.5" onClick={end} disabled={pending}>
          {pending ? <Spinner aria-hidden /> : <LogOutIcon aria-hidden className="rtl:-scale-x-100" />}
          {t("end")}
        </Button>
      </div>
    </div>
  )
}
