"use client"

import { ChevronDownIcon, WalletIcon } from "lucide-react"
import { useTranslations } from "next-intl"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { PaymentInstructions, type PaymentWays } from "./payment-instructions"

/** "How to pay", folded away in a list (My workshops); opens the payment instructions. */
export function HowToPay({
  ways,
  amount,
  participantName,
  defaultOpen = false,
}: {
  ways: PaymentWays
  amount: number
  participantName: string
  defaultOpen?: boolean
}) {
  const t = useTranslations("registration.item")
  return (
    <Collapsible defaultOpen={defaultOpen} className="group/how">
      <CollapsibleTrigger className="bg-warning/10 hover:bg-warning/15 focus-visible:ring-ring/50 flex h-12 w-full items-center gap-2.5 rounded-xl px-4 text-start text-base font-medium outline-none focus-visible:ring-3">
        <WalletIcon className="text-warning size-5 shrink-0" aria-hidden />
        <span className="flex-1">{t("howToPay")}</span>
        <ChevronDownIcon
          className="text-muted-foreground size-5 shrink-0 transition-transform duration-200 group-data-[state=open]/how:rotate-180"
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="data-[state=open]:animate-in data-[state=open]:fade-in-0 pt-4">
        <PaymentInstructions ways={ways} amount={amount} participantName={participantName} />
      </CollapsibleContent>
    </Collapsible>
  )
}
