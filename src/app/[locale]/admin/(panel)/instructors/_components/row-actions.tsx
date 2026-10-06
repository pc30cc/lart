"use client"

import { EllipsisIcon, EyeIcon, PencilIcon, PowerIcon, PowerOffIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useState } from "react"

import { ConfirmAction } from "@/components/admin/confirm-action"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { setInstructorActive } from "@/features/instructors/actions"
import { Link } from "@/i18n/navigation"

/** The "…" menu of a table row: view, edit, deactivate / activate (with confirmation). */
export function InstructorRowActions({ id, name, active }: { id: string; name: string; active: boolean }) {
  const t = useTranslations("instructors")
  const tc = useTranslations("common")
  const [confirming, setConfirming] = useState(false)

  return (
    <>
      {/* Non-modal, so the confirmation dialog can take focus cleanly. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={tc("actions.more")}>
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-48">
          <DropdownMenuItem asChild>
            <Link href={`/admin/instructors/${id}`}>
              <EyeIcon />
              {t("table.view")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/admin/instructors/${id}/edit`}>
              <PencilIcon />
              {tc("actions.edit")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant={active ? "destructive" : "default"} onSelect={() => setConfirming(true)}>
            {active ? <PowerOffIcon /> : <PowerIcon />}
            {active ? t("activation.deactivate") : t("activation.activate")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmAction
        open={confirming}
        onOpenChange={setConfirming}
        action={setInstructorActive}
        input={{ id, active: !active }}
        destructive={active}
        title={active ? t("activation.deactivateTitle", { name }) : t("activation.activateTitle", { name })}
        description={active ? t("activation.deactivateDescription") : t("activation.activateDescription")}
        confirmLabel={active ? t("activation.deactivateConfirm") : t("activation.activateConfirm")}
        successMessage={active ? t("activation.deactivated") : t("activation.activated")}
      />
    </>
  )
}
