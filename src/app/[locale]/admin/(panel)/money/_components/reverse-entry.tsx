"use client"

import { Undo2Icon } from "lucide-react"
import { useTranslations } from "next-intl"

import { ConfirmAction } from "@/components/admin/confirm-action"
import { Button } from "@/components/ui/button"
import { reverseEntry } from "@/features/money/actions"

/**
 * Correct a mistake: entries are never edited or deleted, a reversal posts
 * their mirror image (with an "are you sure" first).
 */
export function ReverseEntry({ id, what, size = "sm" }: { id: string; what: string; size?: "sm" | "xs" }) {
  const t = useTranslations("money.reverse")
  return (
    <ConfirmAction
      action={reverseEntry}
      input={{ id }}
      title={t("title")}
      description={t("description", { what })}
      confirmLabel={t("confirm")}
      successMessage={t("done")}
      trigger={
        <Button variant="ghost" size={size} className="text-muted-foreground hover:text-destructive print:hidden">
          <Undo2Icon />
          {t("action")}
        </Button>
      }
    />
  )
}
