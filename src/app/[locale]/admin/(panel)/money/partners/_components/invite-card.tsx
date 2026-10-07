"use client"

import { MailIcon, RefreshCwIcon, XIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { useState, useTransition } from "react"
import { toast } from "sonner"

import { ConfirmAction } from "@/components/admin/confirm-action"
import { StatusBadge } from "@/components/admin/status-badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { cancelPartnerInvite, resendPartnerInvite } from "@/features/partners/actions"
import type { PartnerInviteRow } from "@/features/partners/queries"
import { formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { InviteSent, type SentInvite } from "./invite-dialog"

/**
 * An invitation not accepted yet, next to the partners' cards (a dashed tile,
 * not an `<article>`: those are the partners). "Send again" makes a new link
 * (the old one stops working) and shows it once to copy; "Cancel" frees the place.
 */
export function InviteCard({ invite }: { invite: PartnerInviteRow }) {
  const t = useTranslations("partners.invites")
  const tc = useTranslations("common")
  const locale = useLocale()
  const [pending, startTransition] = useTransition()
  const [sent, setSent] = useState<SentInvite | null>(null)

  function resend() {
    startTransition(async () => {
      try {
        const result = await resendPartnerInvite({ id: invite.id })
        if (!result) return
        if (result.ok) setSent({ name: invite.name, inviteUrl: result.data.inviteUrl, emailed: result.data.emailed })
        else toast.error(result.error)
      } catch {
        toast.error(tc("errors.network"))
      }
    })
  }

  return (
    <section
      aria-label={t("label", { name: invite.name })}
      className="border-foreground/15 bg-muted/30 flex flex-col rounded-xl border border-dashed"
    >
      <header className="flex items-start gap-3 p-4 md:p-5">
        <span
          aria-hidden
          className="bg-background text-muted-foreground ring-foreground/10 flex size-11 shrink-0 items-center justify-center rounded-full ring-1"
        >
          <MailIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">{invite.name}</h2>
          <p className="text-muted-foreground truncate text-xs rtl:text-right" dir="ltr">
            {invite.email}
          </p>
        </div>
      </header>

      <div className="flex-1 space-y-3 px-4 md:px-5">
        <StatusBadge tone={invite.expired ? "danger" : "info"}>{invite.expired ? t("expired") : t("waiting")}</StatusBadge>
        <dl className="text-muted-foreground space-y-1 text-sm">
          <div className="flex flex-wrap gap-x-1.5">
            <dt>{t("invitedBy")}</dt>
            <dd className="text-foreground">{invite.invitedByName}</dd>
          </div>
          <div className="flex flex-wrap gap-x-1.5">
            <dt>{t("language")}</dt>
            <dd className="text-foreground">{tc(`locales.${invite.locale}`)}</dd>
          </div>
          <div className={cn("flex flex-wrap gap-x-1.5", invite.expired && "text-destructive")}>
            <dt>{invite.expired ? t("expiredOn") : t("worksUntil")}</dt>
            <dd className={cn(!invite.expired && "text-foreground")}>{formatDate(invite.expiresAt, locale)}</dd>
          </div>
        </dl>
      </div>

      <footer className="flex flex-wrap items-center justify-end gap-2 p-4 md:p-5">
        <ConfirmAction
          action={cancelPartnerInvite}
          input={{ id: invite.id }}
          title={t("cancel.title", { name: invite.name })}
          description={t("cancel.description")}
          confirmLabel={t("cancel.confirm")}
          successMessage={t("cancel.done")}
          trigger={
            <Button variant="ghost" disabled={pending}>
              <XIcon />
              {t("cancel.action")}
            </Button>
          }
        />
        <Button variant="outline" onClick={resend} disabled={pending}>
          {pending ? <Spinner aria-hidden /> : <RefreshCwIcon />}
          {t("resend")}
        </Button>
      </footer>

      <Dialog open={sent !== null} onOpenChange={(open) => !open && setSent(null)}>
        <DialogContent showCloseButton={false} className="gap-5 p-5 sm:max-w-md">
          {sent && <InviteSent invite={sent} />}
        </DialogContent>
      </Dialog>
    </section>
  )
}
