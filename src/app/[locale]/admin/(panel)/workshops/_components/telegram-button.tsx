"use client"

import { SendIcon } from "lucide-react"
import { useTranslations } from "next-intl"

import { ConfirmAction } from "@/components/admin/confirm-action"
import { Button } from "@/components/ui/button"
import { postWorkshopToTelegramAction } from "@/features/telegram/actions"

/** The super admin's go for the Telegram post: a confirmation, then it goes to the channel. */
export function PostToTelegramButton({ id, chat, again }: { id: string; chat: string; again: boolean }) {
  const t = useTranslations("workshops.telegram")
  return (
    <ConfirmAction
      action={postWorkshopToTelegramAction}
      input={{ id }}
      destructive={false}
      title={t("confirmTitle")}
      description={t("confirmText", { chat })}
      confirmLabel={t("send")}
      successMessage={t("sent")}
      trigger={
        <Button className="w-full" variant={again ? "outline" : "default"}>
          <SendIcon className="rtl:-scale-x-100" />
          {again ? t("sendAgain") : t("send")}
        </Button>
      }
    />
  )
}
