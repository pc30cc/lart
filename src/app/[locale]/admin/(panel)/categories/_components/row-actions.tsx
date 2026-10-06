"use client"

import { EllipsisIcon, PencilIcon, Trash2Icon } from "lucide-react"
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
import { deleteCategory } from "@/features/categories/actions"
import { Link } from "@/i18n/navigation"

/** The "…" menu of a table row: edit, delete (with confirmation). */
export function CategoryRowActions({ id, name, workshops }: { id: string; name: string; workshops: number }) {
  const t = useTranslations("categories")
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
        <DropdownMenuContent align="end" className="w-auto min-w-44">
          <DropdownMenuItem asChild>
            <Link href={`/admin/categories/${id}`}>
              <PencilIcon />
              {tc("actions.edit")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" disabled={workshops > 0} onSelect={() => setConfirming(true)}>
            <Trash2Icon />
            {tc("actions.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmAction
        open={confirming}
        onOpenChange={setConfirming}
        action={deleteCategory}
        input={{ id }}
        title={t("delete.title", { name })}
        description={t("delete.description")}
        confirmLabel={t("delete.confirm")}
        successMessage={t("toast.deleted")}
      />
    </>
  )
}
