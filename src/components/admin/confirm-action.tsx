"use client"

import { useTranslations } from "next-intl"
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
import type { ActionResult } from "@/lib/errors"

/**
 * "Are you sure?" dialog that runs a server action (an `adminAction`).
 * Shows a spinner while it runs, a toast when done, and the friendly error
 * from the action when it fails.
 *
 *   <ConfirmAction
 *     action={deleteCategory} input={{ id }}
 *     title={t("delete.title", { name })} description={t("delete.description")}
 *     confirmLabel={t("delete.confirm")} successMessage={t("toast.deleted")}
 *     trigger={<Button variant="destructive">{t("delete.action")}</Button>}
 *   />
 *
 * For menus, leave out `trigger` and control it with `open` / `onOpenChange`.
 */
export function ConfirmAction<I, T>({
  action,
  input,
  title,
  description,
  confirmLabel,
  successMessage,
  destructive = true,
  trigger,
  open: openProp,
  onOpenChange,
  onSuccess,
}: {
  action: (input: I) => Promise<ActionResult<T>>
  input: I
  title: string
  description?: React.ReactNode
  confirmLabel: string
  successMessage?: string
  destructive?: boolean
  trigger?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onSuccess?: (data: T) => void
}) {
  const t = useTranslations("common")
  const [ownOpen, setOwnOpen] = useState(false)
  const open = openProp ?? ownOpen
  const setOpen = onOpenChange ?? setOwnOpen
  const [pending, startTransition] = useTransition()

  function confirm() {
    startTransition(async () => {
      try {
        const result = await action(input)
        if (!result) return // the action redirected (e.g. the session ended)
        if (result.ok) {
          setOpen(false)
          if (successMessage) toast.success(successMessage)
          onSuccess?.(result.data)
        } else {
          toast.error(result.error)
        }
      } catch {
        toast.error(t("errors.network"))
      }
    })
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      {trigger && <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>}
      <AlertDialogContent>
        <AlertDialogHeader className="sm:group-data-[size=default]/alert-dialog-content:text-start">
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t("actions.cancel")}</AlertDialogCancel>
          <Button variant={destructive ? "destructive" : "default"} onClick={confirm} disabled={pending}>
            {pending && <Spinner aria-hidden />}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
