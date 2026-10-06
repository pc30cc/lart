"use client"

import { TriangleAlertIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useEffect } from "react"

import { Button } from "@/components/ui/button"

export default function PanelError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("common.panelError")
  useEffect(() => console.error(error), [error])

  return (
    <div className="flex min-h-[60svh] items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <div className="bg-destructive/10 text-destructive flex size-14 items-center justify-center rounded-2xl">
          <TriangleAlertIcon className="size-7" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-balance">{t("title")}</h1>
        <p className="text-muted-foreground text-pretty">{t("description")}</p>
        {error.digest && <p className="text-muted-foreground font-mono text-xs">{error.digest}</p>}
        <Button size="lg" className="mt-2 px-4" onClick={reset}>
          {t("retry")}
        </Button>
      </div>
    </div>
  )
}
