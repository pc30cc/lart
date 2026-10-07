import { useTranslations } from "next-intl"

import { StatusBadge } from "@/components/admin/status-badge"

/** Inactive, Waiting for approval (signed up on their own), Invited (no password yet) or Active. */
export function InstructorStatus({
  active,
  approved,
  hasPassword,
}: {
  active: boolean
  approved: boolean
  hasPassword: boolean
}) {
  const t = useTranslations("instructors.status")
  if (!active) return <StatusBadge>{t("inactive")}</StatusBadge>
  if (!approved) return <StatusBadge tone="warning">{t("pending")}</StatusBadge>
  if (!hasPassword) return <StatusBadge tone="info">{t("invited")}</StatusBadge>
  return <StatusBadge tone="success">{t("active")}</StatusBadge>
}
