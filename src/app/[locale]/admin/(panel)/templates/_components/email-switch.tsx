"use client"

import { LockIcon } from "lucide-react"
import { unstable_rethrow, useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { useOptimistic, useTransition } from "react"
import { toast } from "sonner"

import { Switch } from "@/components/ui/switch"
import type { EmailTemplate } from "@/emails/names"
import { setEmailEnabled } from "@/features/templates/actions"
import { cn } from "@/lib/utils"

/**
 * Send this email or not (Templates → Emails). A required one (an account's
 * way in, a contract to sign) shows a lock instead: it is always sent.
 */
export function EmailSwitch({
  template,
  title,
  enabled,
  required,
  className,
}: {
  template: EmailTemplate
  title: string
  enabled: boolean
  required: boolean
  className?: string
}) {
  const t = useTranslations("templates.emails.switch")
  const tc = useTranslations("common")
  const router = useRouter()
  const [pending, start] = useTransition()
  const [on, setOn] = useOptimistic(enabled)

  if (required) {
    return (
      <span title={t("requiredHint")} className={cn("text-muted-foreground relative z-10 inline-flex items-center gap-1 text-xs", className)}>
        <LockIcon className="size-3.5" aria-hidden />
        {t("required")}
      </span>
    )
  }
  return (
    <label className={cn("relative z-10 inline-flex cursor-pointer items-center gap-2 text-xs font-medium", className)}>
      <span className={on ? "text-success" : "text-muted-foreground"}>{on ? t("on") : t("off")}</span>
      <Switch
        checked={on}
        disabled={pending}
        aria-label={t("label", { email: title })}
        onCheckedChange={(next) =>
          start(async () => {
            setOn(next)
            try {
              const result = await setEmailEnabled({ template, enabled: next })
              if (!result) return
              if (result.ok) {
                toast.success(next ? t("turnedOn", { email: title }) : t("turnedOff", { email: title }))
                router.refresh()
              } else toast.error(result.error)
            } catch (err) {
              unstable_rethrow(err)
              toast.error(tc("errors.network"))
            }
          })
        }
      />
    </label>
  )
}
