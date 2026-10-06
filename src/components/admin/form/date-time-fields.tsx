"use client"

import { CalendarIcon, ClockIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { useId, useState } from "react"
import { enGB, faIR, tr } from "react-day-picker/locale"
import { useFormContext, useWatch } from "react-hook-form"

import { RequiredMark, useErrorText } from "@/components/admin/form/form"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { formatDate, zonedParts, zonedToIso } from "@/lib/format"
import { cn } from "@/lib/utils"

const dayPickerLocales = { fa: faIR, tr, en: enGB }

type Parts = { date: string; start: string; end: string }

function partsOf(startIso: unknown, endIso: unknown): Parts {
  const s = typeof startIso === "string" && startIso ? zonedParts(startIso) : null
  const e = typeof endIso === "string" && endIso ? zonedParts(endIso) : null
  return { date: s?.date ?? "", start: s?.time ?? "", end: e?.time ?? "" }
}

/**
 * Date + start time (+ end time) in Istanbul time. The date button shows the
 * weekday automatically. Writes ISO timestamps (UTC) into `startName` and
 * `endName`; pair with `isoDateTime()` in the schema. Omit `endName` for a
 * single date and time (e.g. a registration deadline).
 */
export function DateTimeFields({
  label,
  description,
  startName,
  endName,
  required,
  className,
}: {
  label: React.ReactNode
  description?: React.ReactNode
  startName: string
  endName?: string
  required?: boolean
  className?: string
}) {
  const t = useTranslations("common.date")
  const locale = useLocale()
  const id = useId()
  const { control, setValue, getFieldState, formState } = useFormContext()
  const startIso = useWatch({ control, name: startName })
  const endIso = useWatch({ control, name: endName ?? startName })
  const [parts, setParts] = useState<Parts>(() => partsOf(startIso, endName ? endIso : null))
  const [open, setOpen] = useState(false)

  // Follow outside changes (form reset) without fighting the user's edits.
  const external = `${startIso ?? ""}|${endName ? (endIso ?? "") : ""}`
  const [seen, setSeen] = useState(external)
  if (external !== seen) {
    setSeen(external)
    const mine = `${zonedToIso(parts.date, parts.start) ?? ""}|${endName ? (zonedToIso(parts.date, parts.end) ?? "") : ""}`
    if (mine !== external) setParts(partsOf(startIso, endName ? endIso : null))
  }

  function update(next: Partial<Parts>) {
    const p = { ...parts, ...next }
    setParts(p)
    const options = { shouldDirty: true, shouldTouch: true, shouldValidate: formState.isSubmitted }
    const start = zonedToIso(p.date, p.start) ?? ""
    setValue(startName, start, options)
    if (endName) setValue(endName, zonedToIso(p.date, p.end) ?? "", options)
    setSeen(`${start}|${endName ? (zonedToIso(p.date, p.end) ?? "") : ""}`)
  }

  const startError = useErrorText(getFieldState(startName, formState).error?.message)
  const endError = useErrorText(endName ? getFieldState(endName, formState).error?.message : undefined)
  const error = startError ?? endError
  const selected = parts.date ? new Date(`${parts.date}T12:00:00`) : undefined
  const describedBy = [description && `${id}-desc`, error && `${id}-err`].filter(Boolean).join(" ") || undefined

  return (
    <Field data-invalid={Boolean(error)} className={className}>
      <FieldLabel htmlFor={`${id}-date`} className="gap-1">
        {label}
        {required && <RequiredMark />}
      </FieldLabel>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              id={`${id}-date`}
              type="button"
              variant="outline"
              aria-invalid={Boolean(startError) || undefined}
              aria-describedby={describedBy}
              className={cn("h-9 justify-start gap-2 px-2.5 font-normal", !parts.date && "text-muted-foreground")}
            >
              <CalendarIcon className="text-muted-foreground" />
              {/* "full" style includes the weekday, e.g. "Tuesday, 14 October 2026". */}
              <span className="truncate">{parts.date ? formatDate(`${parts.date}T09:00:00Z`, locale, "full") : t("pickDate")}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-0">
            <Calendar
              mode="single"
              selected={selected}
              defaultMonth={selected}
              onSelect={(day) => {
                if (!day) return
                const y = day.getFullYear()
                const m = String(day.getMonth() + 1).padStart(2, "0")
                const d = String(day.getDate()).padStart(2, "0")
                update({ date: `${y}-${m}-${d}` })
                setOpen(false)
              }}
              locale={dayPickerLocales[locale as keyof typeof dayPickerLocales] ?? tr}
              numerals={locale === "fa" ? "arabext" : undefined}
              dir={locale === "fa" ? "rtl" : "ltr"}
              weekStartsOn={1}
            />
          </PopoverContent>
        </Popover>
        <div className="flex items-center gap-2" dir="ltr">
          <TimeInput
            label={t("start")}
            value={parts.start}
            onChange={(start) => update({ start })}
            invalid={Boolean(startError)}
          />
          {endName && (
            <>
              <span className="text-muted-foreground">–</span>
              <TimeInput label={t("end")} value={parts.end} onChange={(end) => update({ end })} invalid={Boolean(endError)} />
            </>
          )}
        </div>
      </div>
      <FieldDescription id={`${id}-desc`} className="text-start">
        {description ? <>{description} · </> : null}
        {t("timezone")}
      </FieldDescription>
      {error && <FieldError id={`${id}-err`}>{error}</FieldError>}
    </Field>
  )
}

function TimeInput({
  label,
  value,
  onChange,
  invalid,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  invalid: boolean
}) {
  return (
    <div className="relative">
      <ClockIcon className="text-muted-foreground pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2" />
      <Input
        type="time"
        step={300}
        aria-label={label}
        title={label}
        value={value}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-30 ps-8 tabular-nums [&::-webkit-calendar-picker-indicator]:hidden"
      />
    </div>
  )
}
