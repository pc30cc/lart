"use client"

import { CalendarIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { useState } from "react"
import type { FieldValues, Path } from "react-hook-form"

import { FormField } from "@/components/admin/form/form"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatDate, zonedParts } from "@/lib/format"
import { formatLira } from "@/lib/money"
import { cn } from "@/lib/utils"


/** Today in Istanbul, "YYYY-MM-DD": the default date of a new entry. */
export const todayIso = () => zonedParts(new Date()).date

/** A calendar date ("YYYY-MM-DD") with a date picker that shows the weekday. No future dates. */
export function DateField<T extends FieldValues>({ name, label }: { name: Path<T>; label: string }) {
  const t = useTranslations("money.forms")
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  return (
    <FormField<T> name={name} label={label} required>
      {({ value, onChange, onBlur, ref, id, ...aria }) => {
        const iso = typeof value === "string" ? value : ""
        const selected = iso ? new Date(`${iso}T12:00:00`) : undefined
        return (
          <Popover
            open={open}
            onOpenChange={(next) => {
              setOpen(next)
              if (!next) onBlur()
            }}
          >
            <PopoverTrigger asChild>
              <Button
                id={id}
                ref={ref}
                type="button"
                variant="outline"
                {...aria}
                className={cn("h-9 w-full justify-start gap-2 px-2.5 font-normal", !iso && "text-muted-foreground")}
              >
                <CalendarIcon className="text-muted-foreground" />
                <span className="truncate" suppressHydrationWarning>{iso ? formatDate(`${iso}T09:00:00Z`, locale, "full") : t("pickDate")}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-0">
              <Calendar
                mode="single"
                selected={selected}
                defaultMonth={selected}
                disabled={{ after: new Date() }}
                onSelect={(day) => {
                  if (!day) return
                  const pad = (n: number) => String(n).padStart(2, "0")
                  onChange(`${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`)
                  setOpen(false)
                }}
              />
            </PopoverContent>
          </Popover>
        )
      }}
    </FormField>
  )
}

export type PartnerOption = { adminId: string; name: string }

/**
 * Where the money came from or went: the shared wallet, a partner personally
 * or (expenses only) the instructor's advance. Values: "wallet", a partner id, "advance".
 */
export function SourceField<T extends FieldValues>({
  name,
  label,
  partners,
  advance,
  description,
}: {
  name: Path<T>
  label: string
  partners: PartnerOption[]
  /** Advance the instructor still holds; offers "from the advance" when above zero. */
  advance?: number
  description?: string
}) {
  const t = useTranslations("money.forms")
  const locale = useLocale()
  return (
    <FormField<T> name={name} label={label} description={description} required>
      {(field) => (
        <Select
          value={(field.value as string) || undefined}
          onValueChange={(v) => {
            field.onChange(v)
            field.onBlur()
          }}
        >
          <SelectTrigger
            id={field.id}
            ref={field.ref}
            aria-invalid={field["aria-invalid"]}
            aria-describedby={field["aria-describedby"]}
            className="w-full"
          >
            <SelectValue placeholder={t("chooseSource")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="wallet">{t("sourceWallet")}</SelectItem>
            {partners.map((p) => (
              <SelectItem key={p.adminId} value={p.adminId}>
                {t("sourcePartner", { name: p.name })}
              </SelectItem>
            ))}
            {advance !== undefined && advance > 0 && (
              <SelectItem value="advance">{t("sourceAdvance", { amount: formatLira(advance, locale) })}</SelectItem>
            )}
          </SelectContent>
        </Select>
      )}
    </FormField>
  )
}

/** Choose one partner: large, tappable choices (there are at most three). */
export function PartnerField<T extends FieldValues>({
  name,
  label,
  partners,
}: {
  name: Path<T>
  label: string
  partners: PartnerOption[]
}) {
  return (
    <FormField<T> name={name} label={label} required>
      {(field) => (
        <div role="radiogroup" id={field.id} aria-describedby={field["aria-describedby"]} className="flex flex-wrap gap-2">
          {partners.map((p, i) => {
            const checked = field.value === p.adminId
            return (
              <button
                key={p.adminId}
                ref={i === 0 ? field.ref : undefined}
                type="button"
                role="radio"
                aria-checked={checked}
                onClick={() => {
                  field.onChange(p.adminId)
                  field.onBlur()
                }}
                className={cn(
                  "focus-visible:ring-ring/50 h-9 rounded-lg border px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-3",
                  checked
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background hover:bg-muted text-foreground",
                )}
              >
                {p.name}
              </button>
            )
          })}
        </div>
      )}
    </FormField>
  )
}
