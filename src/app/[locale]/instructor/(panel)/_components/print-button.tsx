"use client"

import { PrinterIcon } from "lucide-react"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/** Print the page (the contract): the panel around it is not printed. */
export function PrintButton({ className }: { className?: string }) {
  const t = useTranslations("instructorPanel.contract")
  return (
    <Button variant="outline" className={cn("h-11 rounded-xl px-4 print:hidden", className)} onClick={() => window.print()}>
      <PrinterIcon />
      {t("print")}
    </Button>
  )
}
