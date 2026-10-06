"use client"

import { ChevronDownIcon, MailIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { resendInvite } from "@/features/instructors/actions"
import { inviteLocales, type InviteLocale } from "@/features/instructors/schema"

/** "Send invitation (again)": choose the email language, then send a fresh link. */
export function InviteButton({ id, again }: { id: string; again: boolean }) {
  const t = useTranslations("instructors.invite")
  const tc = useTranslations("common")
  const locale = useLocale()
  const [pending, startTransition] = useTransition()
  // The UI language first: it's the most likely choice.
  const order = [...inviteLocales].sort((a, b) => Number(b === locale) - Number(a === locale))

  function send(inviteLocale: InviteLocale) {
    startTransition(async () => {
      try {
        const result = await resendInvite({ id, locale: inviteLocale })
        if (!result) return
        if (result.ok) toast.success(t("sent"))
        else toast.error(result.error)
      } catch {
        toast.error(tc("errors.network"))
      }
    })
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="lg" className="px-3.5" disabled={pending}>
          {pending ? <Spinner aria-hidden /> : <MailIcon />}
          {again ? t("resend") : t("send")}
          <ChevronDownIcon className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-44">
        <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">{t("choose")}</DropdownMenuLabel>
        {order.map((l) => (
          <DropdownMenuItem key={l} lang={l} onSelect={() => send(l)}>
            {tc(`locales.${l}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
