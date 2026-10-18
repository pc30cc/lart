"use client"

import { ArrowLeftRightIcon, BanknoteIcon, CreditCardIcon, LandmarkIcon, type LucideIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { unstable_rethrow } from "next/navigation"
import { useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { changePaymentChoiceAction } from "../actions"
import type { PaymentWayName } from "../schema"

const icons: Record<PaymentWayName, LucideIcon> = { cash: BanknoteIcon, transfer: LandmarkIcon, online: CreditCardIcon }

/**
 * "Prefer another way?" under how to pay: one quiet button per other way that
 * is on (e.g. "I'll pay in cash at the workshop instead"). The page then
 * shows that way.
 */
export function ChangePaymentWay({ registrationId, ways }: { registrationId: string; ways: PaymentWayName[] }) {
  const t = useTranslations("registration.changeWay")
  const tc = useTranslations("common")
  const [pending, start] = useTransition()
  if (ways.length === 0) return null

  function change(choice: PaymentWayName) {
    start(async () => {
      try {
        const result = await changePaymentChoiceAction({ id: registrationId, choice })
        if (result.ok) toast.success(t("done"))
        else toast.error(result.error)
      } catch (err) {
        unstable_rethrow(err)
        toast.error(tc("errors.network"))
      }
    })
  }

  return (
    <div className="space-y-2 rounded-2xl border border-dashed p-4">
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <ArrowLeftRightIcon className="size-4" aria-hidden />
        {t("question")}
      </p>
      {ways.map((way) => {
        const Icon = icons[way]
        return (
          <Button key={way} type="button" variant="outline" className="h-11 w-full justify-start rounded-xl text-[0.95rem]" disabled={pending} onClick={() => change(way)}>
            <Icon className="text-primary" aria-hidden />
            {t(way)}
          </Button>
        )
      })}
    </div>
  )
}
