"use client"

import { BanIcon, CircleCheckBigIcon, MailIcon, PrinterIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useTransition } from "react"
import { toast } from "sonner"

import { ConfirmAction } from "@/components/admin/confirm-action"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { resendContract } from "@/features/contracts/actions"
import { cancelWorkshop, confirmWorkshop } from "@/features/workshops/actions"

/** Go decision: confirm the workshop (fixes the number of participants). */
export function ConfirmWorkshopButton({
  id,
  title,
  confirmed,
  minimum,
}: {
  id: string
  title: string
  confirmed: number
  minimum: number
}) {
  const t = useTranslations("workshops.lifecycle")
  return (
    <ConfirmAction
      action={confirmWorkshop}
      input={{ id }}
      destructive={false}
      title={t("confirm.title", { title })}
      description={
        <>
          {t("confirm.description", { count: confirmed })}
          {confirmed < minimum && <span className="text-warning mt-2 block font-medium">{t("confirm.belowMinimum", { minimum })}</span>}
        </>
      }
      confirmLabel={t("confirm.action")}
      successMessage={t("confirm.done")}
      trigger={
        <Button size="lg" className="px-4">
          <CircleCheckBigIcon />
          {t("confirm.trigger")}
        </Button>
      }
    />
  )
}

/** No-go / cancel: cancels every open registration and emails people who paid. */
export function CancelWorkshopButton({
  id,
  title,
  registrations,
  variant = "outline",
}: {
  id: string
  title: string
  registrations: number
  variant?: "outline" | "ghost"
}) {
  const t = useTranslations("workshops.lifecycle")
  return (
    <ConfirmAction
      action={cancelWorkshop}
      input={{ id }}
      title={t("cancel.title", { title })}
      description={t("cancel.description", { count: registrations })}
      confirmLabel={t("cancel.action")}
      successMessage={t("cancel.done")}
      trigger={
        <Button size="lg" variant={variant} className="text-destructive hover:text-destructive px-4">
          <BanIcon />
          {t("cancel.trigger")}
        </Button>
      }
    />
  )
}

/** Email the contract waiting for a signature to the instructor again. */
export function ResendContractButton({ courseId, variant = "outline" }: { courseId: string; variant?: "outline" | "ghost" }) {
  const t = useTranslations("workshops.lifecycle.resend")
  const tc = useTranslations("common")
  const [pending, startTransition] = useTransition()
  return (
    <Button
      size="lg"
      variant={variant}
      className="px-4"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          try {
            const result = await resendContract({ courseId })
            if (!result) return
            if (result.ok) toast.success(t("done"))
            else toast.error(result.error)
          } catch {
            toast.error(tc("errors.network"))
          }
        })
      }
    >
      {pending ? <Spinner aria-hidden /> : <MailIcon />}
      {t("trigger")}
    </Button>
  )
}

export function PrintButton() {
  const t = useTranslations("workshops.contractPage")
  return (
    <Button variant="outline" size="lg" className="px-4" onClick={() => window.print()}>
      <PrinterIcon />
      {t("print")}
    </Button>
  )
}
