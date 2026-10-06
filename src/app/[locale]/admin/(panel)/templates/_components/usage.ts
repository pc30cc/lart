import type { TemplateKind } from "@/features/templates/placeholders"
import type { TemplateUsage } from "@/features/templates/queries"

type Translate = (key: string, values?: Record<string, string | number>) => string

/** "Chosen by 2 workshops · 14 registrations", or what the default means when nothing points at it. */
export function usageText(t: Translate, kind: TemplateKind, isDefault: boolean, usage: TemplateUsage): string {
  const parts = [
    usage.workshops > 0 && t("usage.workshops", { count: usage.workshops }),
    usage.contracts > 0 && t("usage.contracts", { count: usage.contracts, signed: usage.signedContracts }),
    usage.registrations > 0 && t("usage.registrations", { count: usage.registrations }),
  ].filter((p): p is string => Boolean(p))
  if (parts.length) return parts.join(" · ")
  return isDefault ? t(`usage.default.${kind}`) : t("usage.none")
}

/** Why a template can't be deleted, or null when it can. */
export function deleteBlocker(t: Translate, isDefault: boolean, usage: TemplateUsage): string | null {
  if (isDefault) return t("delete.isDefault")
  if (usage.workshops + usage.contracts + usage.registrations > 0) return t("delete.inUse")
  return null
}
