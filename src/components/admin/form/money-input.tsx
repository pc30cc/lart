"use client"

import { useLocale } from "next-intl"
import { useState } from "react"

import { Input } from "@/components/ui/input"
import { normalizeDigits } from "@/lib/format"
import { parseLira } from "@/lib/money"
import { cn } from "@/lib/utils"

/** Kuruş → editable text, e.g. 125050 → "1.250,50" (Turkish style) or "1,250.50" (English). */
function toText(kurus: number | null | undefined, locale: string): string {
  if (kurus == null || !Number.isFinite(kurus)) return ""
  return new Intl.NumberFormat(locale === "en" ? "en-US" : "tr-TR", {
    minimumFractionDigits: kurus % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(kurus / 100)
}

/**
 * Lira amount input. The form value is integer kuruş (or null when empty, NaN
 * when unreadable, so the schema can say what is wrong). Accepts "1250",
 * "1.250,50", "1,250.50" and Persian digits. Use inside <FormField>:
 *   <FormField name="price" label={t("price")}>{(field) => <MoneyInput {...field} />}</FormField>
 */
export function MoneyInput({
  value,
  onChange,
  onBlur,
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "value" | "onChange" | "type"> & {
  value: unknown
  onChange: (kurus: number | null) => void
}) {
  const locale = useLocale()
  const current = typeof value === "number" ? value : null
  const [text, setText] = useState(() => toText(current, locale))
  const [synced, setSynced] = useState(current)

  // Follow outside changes (form reset), but not our own edits.
  if (current !== synced && !(Number.isNaN(current) && Number.isNaN(synced))) {
    setSynced(current)
    const typed = parseLira(normalizeDigits(text))
    if (typed !== current) setText(toText(current, locale))
  }

  function parse(raw: string): number | null {
    const s = normalizeDigits(raw).trim()
    if (!s) return null
    return parseLira(s) ?? Number.NaN
  }

  return (
    <div className="relative" dir="ltr">
      <span className="text-muted-foreground pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-sm">
        ₺
      </span>
      <Input
        {...props}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        dir="ltr"
        value={text}
        className={cn("ps-7 tabular-nums", className)}
        onChange={(e) => {
          setText(e.target.value)
          const kurus = parse(e.target.value)
          setSynced(kurus)
          onChange(kurus)
        }}
        onBlur={(e) => {
          const kurus = parse(text)
          if (kurus !== null && !Number.isNaN(kurus)) setText(toText(kurus, locale))
          onBlur?.(e)
        }}
      />
    </div>
  )
}
