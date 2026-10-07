"use client"

import { useTranslations } from "next-intl"

import { PageError } from "@/components/site/page-error"

/**
 * An unexpected failure on an instructor's sign-in page (log in, invitation,
 * passwords, confirm email): a friendly message, "Try again" and the way back
 * to the log-in page.
 */
export default function InstructorAuthError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useTranslations("auth.instructor.error")
  return <PageError error={error} retry={retry} href="/instructor/login" label={t("logIn")} />
}
