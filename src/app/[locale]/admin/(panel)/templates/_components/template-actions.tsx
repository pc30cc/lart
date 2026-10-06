"use client"

import { CopyIcon, EllipsisIcon, PencilIcon, StarIcon, Trash2Icon } from "lucide-react"
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
import { deleteTemplate, setDefaultTemplate } from "@/features/templates/actions"
import type { TemplateKind } from "@/features/templates/placeholders"
import { Link, useRouter } from "@/i18n/navigation"

type Target = { id: string; name: string; kind: TemplateKind; isDefault: boolean; used: boolean }

/** The "…" menu of a template card: edit, copy, make default, delete. */
export function TemplateMenu({ template }: { template: Target }) {
  const t = useTranslations("templates")
  const tc = useTranslations("common")
  const [dialog, setDialog] = useState<"default" | "delete" | null>(null)
  const { id, name, kind, isDefault, used } = template

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={tc("actions.more")}>
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-48">
          <DropdownMenuItem asChild>
            <Link href={`/admin/templates/${id}`}>
              <PencilIcon />
              {tc("actions.edit")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/admin/templates/new?from=${id}`}>
              <CopyIcon />
              {t("actions.copy")}
            </Link>
          </DropdownMenuItem>
          {!isDefault && (
            <DropdownMenuItem onSelect={() => setDialog("default")}>
              <StarIcon />
              {t("actions.makeDefault")}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" disabled={isDefault || used} onSelect={() => setDialog("delete")}>
            <Trash2Icon />
            {tc("actions.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmAction
        open={dialog === "default"}
        onOpenChange={(open) => setDialog(open ? "default" : null)}
        action={setDefaultTemplate}
        input={{ id }}
        destructive={false}
        title={t("makeDefault.title", { name })}
        description={t(`makeDefault.description.${kind}`)}
        confirmLabel={t("makeDefault.confirm")}
        successMessage={t("toast.defaultChanged")}
      />
      <ConfirmAction
        open={dialog === "delete"}
        onOpenChange={(open) => setDialog(open ? "delete" : null)}
        action={deleteTemplate}
        input={{ id }}
        title={t("delete.title", { name })}
        description={t("delete.description")}
        confirmLabel={t("delete.confirm")}
        successMessage={t("toast.deleted")}
      />
    </>
  )
}

/** "Make default" button on the edit page of a template that is not the default. */
export function MakeDefaultButton({ id, name, kind }: { id: string; name: string; kind: TemplateKind }) {
  const t = useTranslations("templates")
  return (
    <ConfirmAction
      action={setDefaultTemplate}
      input={{ id }}
      destructive={false}
      title={t("makeDefault.title", { name })}
      description={t(`makeDefault.description.${kind}`)}
      confirmLabel={t("makeDefault.confirm")}
      successMessage={t("toast.defaultChanged")}
      trigger={
        <Button variant="outline" size="lg" className="px-3.5">
          <StarIcon />
          {t("actions.makeDefault")}
        </Button>
      }
    />
  )
}

/** Danger zone of the edit page. Deleting is blocked (and explained) for the default or a template in use. */
export function DeleteTemplate({ id, name, reason }: { id: string; name: string; reason: string | null }) {
  const t = useTranslations("templates")
  const router = useRouter()

  return (
    <section className="border-destructive/25 bg-destructive/[0.03] flex flex-col gap-4 rounded-xl border p-5 sm:flex-row sm:items-center sm:justify-between md:p-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{t("delete.dangerTitle")}</h2>
        <p className="text-muted-foreground text-sm text-pretty">{reason ?? t("delete.dangerDescription")}</p>
      </div>
      <ConfirmAction
        action={deleteTemplate}
        input={{ id }}
        title={t("delete.title", { name })}
        description={t("delete.description")}
        confirmLabel={t("delete.confirm")}
        successMessage={t("toast.deleted")}
        onSuccess={() => router.push("/admin/templates")}
        trigger={
          <Button variant="destructive" size="lg" className="shrink-0 px-4" disabled={reason !== null}>
            <Trash2Icon />
            {t("delete.action")}
          </Button>
        }
      />
    </section>
  )
}
