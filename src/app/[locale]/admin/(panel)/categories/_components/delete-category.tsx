"use client"

import { Trash2Icon } from "lucide-react"
import { useTranslations } from "next-intl"

import { ConfirmAction } from "@/components/admin/confirm-action"
import { Button } from "@/components/ui/button"
import { deleteCategory } from "@/features/categories/actions"
import { useRouter } from "@/i18n/navigation"

/** Danger zone of the edit page. Deleting is blocked (and explained) while workshops use the category. */
export function DeleteCategory({ id, name, workshops }: { id: string; name: string; workshops: number }) {
  const t = useTranslations("categories.delete")
  const tt = useTranslations("categories.toast")
  const router = useRouter()

  return (
    <section className="border-destructive/25 bg-destructive/[0.03] flex flex-col gap-4 rounded-xl border p-5 sm:flex-row sm:items-center sm:justify-between md:p-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{t("dangerTitle")}</h2>
        <p className="text-muted-foreground text-sm text-pretty">
          {workshops > 0 ? t("inUse", { count: workshops }) : t("dangerDescription")}
        </p>
      </div>
      <ConfirmAction
        action={deleteCategory}
        input={{ id }}
        title={t("title", { name })}
        description={t("description")}
        confirmLabel={t("confirm")}
        successMessage={tt("deleted")}
        onSuccess={() => router.push("/admin/categories")}
        trigger={
          <Button variant="destructive" size="lg" className="shrink-0 px-4" disabled={workshops > 0}>
            <Trash2Icon />
            {t("action")}
          </Button>
        }
      />
    </section>
  )
}
