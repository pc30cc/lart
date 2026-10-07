"use client"

import { CircleAlertIcon, EyeIcon } from "lucide-react"
import { useTranslations } from "next-intl"

import { ConfirmAction } from "@/components/admin/confirm-action"
import { SetPasswordDialog } from "@/components/admin/set-password-dialog"
import { Button } from "@/components/ui/button"
import { impersonateInstructor } from "@/features/instructors/actions"
import { impersonateMember } from "@/features/students/actions"
import { isolate } from "@/lib/format"

/**
 * On an instructor's or student's admin page: "Change password" and "Enter
 * their panel" / "Enter their account" (a one-hour session as them in this
 * browser, with a bar to end it). Both are off for a deactivated instructor
 * (the server refuses too), with one line at the top that says why.
 */
export function AccountAccess({
  kind,
  id,
  name,
  inactive = false,
}: {
  kind: "instructor" | "member"
  id: string
  name: string
  inactive?: boolean
}) {
  const t = useTranslations("admin.access")
  const enter = kind === "instructor" ? impersonateInstructor : impersonateMember
  const who = isolate(name) // reads correctly inside Persian text

  return (
    <section
      aria-label={t("title")}
      className="divide-border/70 bg-card ring-foreground/8 divide-y rounded-xl shadow-xs ring-1"
    >
      {inactive && (
        <p role="note" className="bg-warning/10 text-warning flex items-start gap-3 rounded-t-xl px-5 py-3.5 text-sm md:px-6">
          <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span className="text-pretty">{t("inactive")}</span>
        </p>
      )}
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between md:p-6">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">{t("password.title")}</h2>
          <p className="text-muted-foreground text-sm text-pretty">{t("password.description")}</p>
        </div>
        <SetPasswordDialog kind={kind} id={id} name={name} disabled={inactive} />
      </div>

      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between md:p-6">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">{t(`enter.${kind}.title`)}</h2>
          <p className="text-muted-foreground text-sm text-pretty">{t(`enter.${kind}.description`, { name: who })}</p>
        </div>
        <ConfirmAction
          action={enter}
          input={{ id }}
          destructive={false}
          title={t(`enter.${kind}.confirmTitle`, { name: who })}
          description={t(`enter.${kind}.confirmDescription`)}
          confirmLabel={t(`enter.${kind}.confirm`)}
          trigger={
            <Button variant="outline" size="lg" className="shrink-0 px-4" disabled={inactive}>
              <EyeIcon />
              {t(`enter.${kind}.trigger`)}
            </Button>
          }
        />
      </div>
    </section>
  )
}
