"use client"

import { CheckCircle2Icon, CircleAlertIcon, EqualIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { useState, useTransition } from "react"
import { toast } from "sonner"

import { SubmitButton } from "@/components/admin/form/form"
import { PersonAvatar } from "@/components/admin/person-avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { updateShares } from "@/features/money/actions"
import { formatPercent, normalizeDigits } from "@/lib/format"
import { cn } from "@/lib/utils"

type Partner = { adminId: string; name: string; shareBp: number; photoUrl?: string | null }

/** "33,34" / "33.34" / "۳۳٫۳۴" → basis points (3334), or null when unreadable. */
function toBp(text: string): number | null {
  const s = normalizeDigits(text).trim().replace(",", ".").replace("%", "")
  if (!/^\d{1,3}(\.\d{0,2})?$/.test(s)) return null
  const bp = Math.round(Number(s) * 100)
  return bp >= 0 && bp <= 10000 ? bp : null
}
const toText = (bp: number) => String(bp / 100)

/** Edit the partners' profit shares; they must add up to exactly 100 %. */
export function SharesForm({ partners }: { partners: Partner[] }) {
  const t = useTranslations("money.partners.shares")
  const tc = useTranslations("common")
  const locale = useLocale()
  const [values, setValues] = useState(() => partners.map((p) => toText(p.shareBp)))
  const [pending, startTransition] = useTransition()

  const bps = values.map(toBp)
  const unreadable = bps.some((b) => b === null)
  const total = bps.reduce<number>((s, b) => s + (b ?? 0), 0)
  const valid = !unreadable && total === 10000
  const pct = (bp: number) => formatPercent(bp / 10000, locale, 2)

  function splitEqually() {
    const base = Math.floor(10000 / partners.length)
    setValues(partners.map((_, i) => toText(base + (i < 10000 - base * partners.length ? 1 : 0))))
  }

  function save(event: React.FormEvent) {
    event.preventDefault()
    if (!valid) return
    startTransition(async () => {
      try {
        const result = await updateShares({ shares: partners.map((p, i) => ({ adminId: p.adminId, shareBp: bps[i]! })) })
        if (!result) return
        if (result.ok) toast.success(t("done"))
        else toast.error(result.error)
      } catch {
        toast.error(tc("errors.network"))
      }
    })
  }

  return (
    <form onSubmit={save} noValidate className="space-y-5">
      <ul className="space-y-4">
        {partners.map((p, i) => {
          const bp = bps[i]
          const id = `share-${p.adminId}`
          return (
            <li key={p.adminId} className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor={id} className="flex min-w-0 items-center gap-3">
                  <PersonAvatar name={p.name} url={p.photoUrl} className="size-9 text-sm font-semibold" />
                  <span className="truncate font-medium">{p.name}</span>
                </label>
                <div className="relative w-28 shrink-0" dir="ltr">
                  <Input
                    id={id}
                    inputMode="decimal"
                    autoComplete="off"
                    value={values[i]}
                    aria-invalid={bp === null || undefined}
                    onChange={(e) => setValues((v) => v.map((x, j) => (j === i ? e.target.value : x)))}
                    className="h-10 pe-8 text-end text-base tabular-nums"
                  />
                  <span className="text-muted-foreground pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-sm">%</span>
                </div>
              </div>
              <div className="bg-muted h-1.5 overflow-hidden rounded-full" aria-hidden>
                <div className="bg-primary h-full rounded-full transition-all duration-300" style={{ width: `${Math.min(100, (bp ?? 0) / 100)}%` }} />
              </div>
            </li>
          )
        })}
      </ul>

      <div
        role="status"
        className={cn(
          "flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm",
          valid ? "bg-success/10 text-success" : "bg-warning/10 text-warning",
        )}
      >
        {valid ? <CheckCircle2Icon className="size-4 shrink-0" /> : <CircleAlertIcon className="size-4 shrink-0" />}
        <span className="font-medium">
          {unreadable
            ? t("unreadable")
            : valid
              ? t("total", { total: pct(total) })
              : total < 10000
                ? t("missing", { rest: pct(10000 - total) })
                : t("tooMuch", { rest: pct(total - 10000) })}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {partners.length > 1 ? (
          <Button type="button" variant="ghost" onClick={splitEqually}>
            <EqualIcon />
            {t("splitEqually")}
          </Button>
        ) : (
          <span />
        )}
        <SubmitButton pending={pending} disabled={!valid}>
          {t("save")}
        </SubmitButton>
      </div>
    </form>
  )
}
