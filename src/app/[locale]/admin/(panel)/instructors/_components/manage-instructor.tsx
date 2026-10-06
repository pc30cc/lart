"use client"

import { PowerIcon, PowerOffIcon, Trash2Icon } from "lucide-react"
import { useTranslations } from "next-intl"

import { ConfirmAction } from "@/components/admin/confirm-action"
import { Button } from "@/components/ui/button"
import { deleteInstructor, setInstructorActive } from "@/features/instructors/actions"
import { useRouter } from "@/i18n/navigation"

/**
 * Bottom of the profile page: deactivate / activate, and delete (only for
 * instructors without workshops or contracts, otherwise explained and disabled).
 */
export function ManageInstructor({
  id,
  name,
  active,
  deletable,
}: {
  id: string
  name: string
  active: boolean
  deletable: boolean
}) {
  const t = useTranslations("instructors")
  const router = useRouter()

  return (
    <section className="divide-border/70 bg-card ring-foreground/8 divide-y rounded-xl shadow-xs ring-1">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between md:p-6">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">{t("activation.title")}</h2>
          <p className="text-muted-foreground text-sm text-pretty">
            {active ? t("activation.activeDescription") : t("activation.inactiveDescription")}
          </p>
        </div>
        <ConfirmAction
          action={setInstructorActive}
          input={{ id, active: !active }}
          destructive={active}
          title={active ? t("activation.deactivateTitle", { name }) : t("activation.activateTitle", { name })}
          description={active ? t("activation.deactivateDescription") : t("activation.activateDescription")}
          confirmLabel={active ? t("activation.deactivateConfirm") : t("activation.activateConfirm")}
          successMessage={active ? t("activation.deactivated") : t("activation.activated")}
          trigger={
            <Button variant={active ? "outline" : "default"} size="lg" className="shrink-0 px-4">
              {active ? <PowerOffIcon /> : <PowerIcon />}
              {active ? t("activation.deactivate") : t("activation.activate")}
            </Button>
          }
        />
      </div>

      <div className="bg-destructive/[0.03] flex flex-col gap-4 rounded-b-xl p-5 sm:flex-row sm:items-center sm:justify-between md:p-6">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">{t("delete.dangerTitle")}</h2>
          <p className="text-muted-foreground text-sm text-pretty">
            {deletable ? t("delete.dangerDescription") : t("delete.inUse")}
          </p>
        </div>
        <ConfirmAction
          action={deleteInstructor}
          input={{ id }}
          title={t("delete.title", { name })}
          description={t("delete.description")}
          confirmLabel={t("delete.confirm")}
          successMessage={t("toast.deleted")}
          onSuccess={() => router.push("/admin/instructors")}
          trigger={
            <Button variant="destructive" size="lg" className="shrink-0 px-4" disabled={!deletable}>
              <Trash2Icon />
              {t("delete.action")}
            </Button>
          }
        />
      </div>
    </section>
  )
}
