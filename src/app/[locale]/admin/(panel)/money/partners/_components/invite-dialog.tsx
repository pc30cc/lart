"use client"

import { CheckIcon, CopyIcon, MailCheckIcon, MailWarningIcon, UserPlusIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { useEffect, useId, useState } from "react"
import { toast } from "sonner"

import { Form, FormField, SubmitButton, TextField } from "@/components/admin/form/form"
import { useActionForm } from "@/components/admin/form/use-action-form"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { invitePartner } from "@/features/partners/actions"
import { PARTNER_INVITE_TTL_MS, partnerInviteSchema, type PartnerInviteValues } from "@/features/partners/schema"
import { locales, type AppLocale } from "@/i18n/routing"
import { cn } from "@/lib/utils"

const DAYS = PARTNER_INVITE_TTL_MS / 86_400_000

/** What an invitation (or "Send again") gave back: the link is shown this one time only. */
export type SentInvite = { name: string; inviteUrl: string; emailed: boolean }

/**
 * "Invite a partner": name, email and the language of the email and the
 * invitation page. Then the dialog shows the link once, to copy (for WhatsApp,
 * or when the email could not be sent). Disabled while every place is taken
 * (the page says why).
 */
export function InviteDialog({ disabled }: { disabled: boolean }) {
  const t = useTranslations("partners.invite")
  const [open, setOpen] = useState(false)
  const [sent, setSent] = useState<SentInvite | null>(null)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setSent(null)
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="lg" className="px-4" disabled={disabled}>
          <UserPlusIcon />
          {t("trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        // The link is shown only now: a stray tap beside the dialog must not lose it (Escape and Close still work).
        onInteractOutside={(event) => {
          if (sent) event.preventDefault()
        }}
        className="gap-5 p-5 sm:max-w-md"
      >
        {sent ? (
          <InviteSent invite={sent} />
        ) : (
          <>
            <DialogHeader className="text-start">
              <DialogTitle className="text-lg">{t("title")}</DialogTitle>
              <DialogDescription className="text-pretty">{t("description")}</DialogDescription>
            </DialogHeader>
            <InviteForm onSent={setSent} />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function InviteForm({ onSent }: { onSent: (invite: SentInvite) => void }) {
  const t = useTranslations("partners.invite")
  const tc = useTranslations("common")
  const locale = useLocale()
  const { form, submit, pending } = useActionForm({
    schema: partnerInviteSchema,
    action: invitePartner,
    // The UI language is the most likely choice.
    defaultValues: { name: "", email: "", locale: locale as AppLocale },
    successMessage: false,
    onSuccess: ({ inviteUrl, emailed }) => onSent({ name: form.getValues("name").trim(), inviteUrl, emailed }),
  })

  return (
    <Form form={form} onSubmit={submit} className="space-y-5">
      <TextField<PartnerInviteValues>
        name="name"
        label={t("name")}
        description={t("nameHint")}
        autoComplete="off"
        maxLength={80}
        className="[&_input]:h-10"
        autoFocus
      />
      <TextField<PartnerInviteValues>
        name="email"
        label={t("email")}
        type="email"
        inputMode="email"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        dir="ltr"
        maxLength={254}
        className="[&_input]:h-10"
      />
      <FormField<PartnerInviteValues> name="locale" label={t("locale")} description={t("localeHint")}>
        {({ value, onChange, onBlur, ref, id, ...aria }) => (
          <ToggleGroup
            ref={ref}
            id={id}
            type="single"
            variant="outline"
            value={(value as AppLocale | undefined) ?? ""}
            onValueChange={(next) => next && onChange(next)}
            onBlur={onBlur}
            className="flex-wrap"
            // A <label for> cannot name this group (a div), so it carries the label's text itself.
            aria-label={t("locale")}
            aria-describedby={aria["aria-describedby"]}
            aria-invalid={aria["aria-invalid"]}
          >
            {locales.map((l) => (
              <ToggleGroupItem key={l} value={l} lang={l} className="h-9 px-4">
                {tc(`locales.${l}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </FormField>
      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        <DialogClose asChild>
          <Button type="button" variant="ghost" size="lg" disabled={pending}>
            {tc("actions.cancel")}
          </Button>
        </DialogClose>
        <SubmitButton pending={pending}>{t("submit")}</SubmitButton>
      </div>
    </Form>
  )
}

/**
 * The result of inviting or "Send again": whether the email went out, the link
 * to copy (shown this once) and the reminder that a new partner starts at 0 %.
 * Rendered inside an open dialog.
 */
export function InviteSent({ invite }: { invite: SentInvite }) {
  const t = useTranslations("partners.invite.sent")
  const tc = useTranslations("common")
  const Icon = invite.emailed ? MailCheckIcon : MailWarningIcon

  return (
    <div className="space-y-5">
      <DialogHeader className="text-start">
        <span
          aria-hidden
          className={cn(
            "mb-1 flex size-11 items-center justify-center rounded-full [&_svg]:size-5",
            invite.emailed ? "bg-success/12 text-success" : "bg-warning/12 text-warning",
          )}
        >
          <Icon />
        </span>
        <DialogTitle className="text-lg">
          {invite.emailed ? t("title", { name: invite.name }) : t("titleNoEmail")}
        </DialogTitle>
        <DialogDescription className="text-pretty">
          {invite.emailed ? t("emailed", { name: invite.name }) : t("notEmailed", { name: invite.name })}
        </DialogDescription>
      </DialogHeader>

      <InviteLink url={invite.inviteUrl} />

      <ul className="text-muted-foreground list-disc space-y-1.5 ps-5 text-sm text-pretty">
        <li>{t("once", { days: DAYS })}</li>
        <li>{t("share", { name: invite.name })}</li>
      </ul>

      <div className="flex justify-end">
        <DialogClose asChild>
          <Button type="button" size="lg" className="w-full px-6 sm:w-auto">
            {tc("actions.close")}
          </Button>
        </DialogClose>
      </div>
    </div>
  )
}

/** The invitation link in a read-only box (left-to-right in every language) with a Copy button. */
function InviteLink({ url }: { url: string }) {
  const t = useTranslations("partners.invite.sent")
  const id = useId()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2500)
    return () => clearTimeout(timer)
  }, [copied])

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success(t("copied"))
    } catch {
      toast.error(t("copyFailed"))
    }
  }

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium">
        {t("link")}
      </label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={url}
          readOnly
          dir="ltr"
          spellCheck={false}
          onFocus={(event) => event.currentTarget.select()}
          className="bg-muted/50 h-10 min-w-0 flex-1 font-mono text-xs"
        />
        <Button type="button" onClick={copy} className="h-10 shrink-0 px-3.5">
          {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
          {copied ? t("copiedShort") : t("copy")}
        </Button>
      </div>
    </div>
  )
}
