import { useTranslations } from "next-intl"

import { StatusBadge } from "@/components/admin/status-badge"

/** Active (has signed up), Invited (no password yet) or Inactive. */
export function InstructorStatus({ active, hasPassword }: { active: boolean; hasPassword: boolean }) {
  const t = useTranslations("instructors.status")
  if (!active) return <StatusBadge>{t("inactive")}</StatusBadge>
  if (!hasPassword) return <StatusBadge tone="info">{t("invited")}</StatusBadge>
  return <StatusBadge tone="success">{t("active")}</StatusBadge>
}
