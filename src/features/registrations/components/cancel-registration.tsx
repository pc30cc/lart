"use client"

import { XCircleIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { useState, useTransition } from "react"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { formatLira } from "@/lib/money"
import { cancelRegistrationAction } from "../actions"
import { isolate, type CancelPreview } from "../schema"

/**
 * "Cancel my registration" with a clear "are you sure" first: not paid yet,
 * the place is simply freed; paid, the refund under the terms (all, half or
 * nothing, with the amount). `preview` is worked out on the server when the
 * page is shown; the action works it out again at the moment of cancelling.
 */
export function CancelRegistration({
  id,
  participantName,
  preview,
}: {
  id: string
  participantName: string
  preview: CancelPreview
}) {
  const t = useTranslations("registration.cancel")
  const tc = useTranslations("common")
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const lira = (kurus: number) => isolate(formatLira(kurus, locale))

  const description =
    preview.paid <= 0
      ? t("unpaid", { name: isolate(participantName) })
      : preview.percent === 100
        ? t("full", { paid: lira(preview.paid), refund: lira(preview.refund) })
        : preview.percent > 0
          ? t("partial", { percent: preview.percent, refund: lira(preview.refund) })
          : t("none")

  function confirm() {
    startTransition(async () => {
      try {
        const result = await cancelRegistrationAction({ id })
        if (!result) return // the session ended: the action went to the login
        if (!result.ok) {
          toast.error(result.error)
          return
        }
        setOpen(false)
        toast.success(result.data.refund > 0 ? t("doneRefund", { refund: lira(result.data.refund) }) : t("done"))
      } catch {
        toast.error(tc("errors.network"))
      }
    })
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" className="text-muted-foreground hover:text-destructive h-11 rounded-xl px-4 text-sm">
          <XCircleIcon className="size-4.5" aria-hidden />
          {t("button")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-md">
        <AlertDialogHeader className="sm:group-data-[size=default]/alert-dialog-content:text-start">
          <AlertDialogTitle className="text-lg">{t("title")}</AlertDialogTitle>
          <AlertDialogDescription className="text-base leading-relaxed text-pretty">{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-2">
          <AlertDialogCancel disabled={pending} className="h-11 rounded-xl px-4 text-base">
            {t("keep")}
          </AlertDialogCancel>
          <Button variant="destructive" onClick={confirm} disabled={pending} className="h-11 rounded-xl px-4 text-base">
            {pending && <Spinner aria-hidden />}
            {t("confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
