"use client"

import { EyeIcon, EyeOffIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { revealIdNumber } from "@/features/instructors/actions"

/** Hidden again after a minute, so it doesn't stay on an unattended screen. */
const VISIBLE_MS = 60_000

/** The masked ID number with a "Show" button. Each reveal asks the server and is audited there. */
export function IdNumberReveal({ id, masked }: { id: string; masked: string | null }) {
  const t = useTranslations("instructors.reveal")
  const tc = useTranslations("common")
  const [plain, setPlain] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!plain) return
    const timer = setTimeout(() => setPlain(null), VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [plain])

  if (!masked) return <span className="text-muted-foreground text-sm">{t("unavailable")}</span>

  function reveal() {
    startTransition(async () => {
      try {
        const result = await revealIdNumber({ id })
        if (!result) return
        if (result.ok) setPlain(result.data.idNumber)
        else toast.error(result.error)
      } catch {
        toast.error(tc("errors.network"))
      }
    })
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span dir="ltr" className="font-mono text-sm tracking-wider tabular-nums" aria-live="polite">
          {plain ?? masked}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={plain ? () => setPlain(null) : reveal}
          disabled={pending}
          aria-label={plain ? t("hide") : t("showLabel")}
          className="text-muted-foreground hover:text-foreground"
        >
          {pending ? <Spinner aria-hidden /> : plain ? <EyeOffIcon /> : <EyeIcon />}
          {plain ? t("hide") : t("show")}
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">{t("note")}</p>
    </div>
  )
}
