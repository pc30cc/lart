"use client"

import { UserRoundCheckIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import { ConfirmAction } from "@/components/admin/confirm-action"
import { Button } from "@/components/ui/button"
import { approveInstructor } from "@/features/instructors/actions"
import { useRouter } from "@/i18n/navigation"

/**
 * Top of the profile of someone who signed up on their own: check the
 * details, then approve them, so they can be chosen for workshops.
 */
export function ApproveInstructor({ id, name }: { id: string; name: string }) {
  const t = useTranslations("instructors.approval")
  const router = useRouter()

  return (
    <section className="border-warning/30 bg-warning/8 flex flex-col gap-4 rounded-xl border p-5 sm:flex-row sm:items-center sm:justify-between md:p-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{t("title")}</h2>
        <p className="text-muted-foreground text-sm text-pretty">{t("description")}</p>
      </div>
      <ConfirmAction
        action={approveInstructor}
        input={{ id }}
        destructive={false}
        title={t("confirmTitle", { name })}
        description={t("confirmDescription")}
        confirmLabel={t("confirm")}
        onSuccess={(data) => {
          if (data.emailed) toast.success(t("approved"))
          else toast.warning(t("approvedNoEmail"))
          router.refresh()
        }}
        trigger={
          <Button size="lg" className="shrink-0 px-4">
            <UserRoundCheckIcon />
            {t("approve")}
          </Button>
        }
      />
    </section>
  )
}
