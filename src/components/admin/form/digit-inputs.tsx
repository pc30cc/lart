"use client"

import { useState } from "react"

import { Input } from "@/components/ui/input"
import { normalizeDigits } from "@/lib/format"
import { cn } from "@/lib/utils"

type TextInputProps = Omit<React.ComponentProps<"input">, "value" | "onChange" | "type" | "min" | "max" | "step">

/**
 * Plain text inputs for numbers and times instead of type="number" and
 * type="time": Safari shows those in the page's digits (Persian on /fa) and
 * then drops what is typed with the other digits, or Persian digits from the
 * keyboard altogether, so a box that shows a number can hold nothing. These
 * take Persian, Arabic and Latin digits alike.
 */

/** "12" or "۱۲" → 12; "" → null; anything else → NaN (the schema then says what is wrong). */
export function parseWholeNumber(raw: string): number | null {
  const s = normalizeDigits(raw).trim()
  if (!s) return null
  return /^\d{1,9}$/.test(s) ? Number(s) : Number.NaN
}

/**
 * A whole number. The value is a number, null when empty, NaN when unreadable.
 * Drop-in for <Input type="number"> inside a <FormField>.
 */
export function WholeNumberInput({
  value,
  onChange,
  onBlur,
  className,
  ...props
}: TextInputProps & { value: unknown; onChange: (value: number | null) => void }) {
  const current = typeof value === "number" ? value : null
  const [text, setText] = useState(() => (current !== null && Number.isFinite(current) ? String(current) : ""))
  const [synced, setSynced] = useState(current)

  // Follow outside changes (form reset, "add a day"), but not our own edits.
  if (current !== synced && !(Number.isNaN(current) && Number.isNaN(synced))) {
    setSynced(current)
    if (parseWholeNumber(text) !== current) setText(current !== null && Number.isFinite(current) ? String(current) : "")
  }

  return (
    <Input
      {...props}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      dir="ltr"
      value={text}
      className={cn("tabular-nums", className)}
      onChange={(e) => {
        setText(e.target.value)
        const next = parseWholeNumber(e.target.value)
        setSynced(next)
        onChange(next)
      }}
      onBlur={(e) => {
        const n = parseWholeNumber(text)
        if (n !== null && Number.isFinite(n)) setText(String(n))
        onBlur?.(e)
      }}
    />
  )
}

/**
 * "10:30", "۱۰:۳۰", "10.30", "1030", "10" (→ 10:00), "9:05" → "HH:mm"; null
 * when it is not a time of day.
 */
export function parseTime(raw: string): string | null {
  const s = normalizeDigits(raw).trim().replace(/\s+/g, "")
  const m = /^(\d{1,2})(?:[:.,]?(\d{2}))?$/.exec(s)
  if (!m) return null
  const h = Number(m[1])
  const min = m[2] === undefined ? 0 : Number(m[2])
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`
}

/**
 * A time of day, 24-hour "HH:mm" (Latin digits). The value is "" while it is
 * empty or not a time yet; on leaving the box the text is written out in full.
 */
export function TimeTextInput({
  value,
  onChange,
  onBlur,
  className,
  ...props
}: TextInputProps & { value: string; onChange: (value: string) => void }) {
  const [text, setText] = useState(value)
  const [synced, setSynced] = useState(value)

  if (value !== synced) {
    setSynced(value)
    if ((parseTime(text) ?? "") !== value) setText(value)
  }

  return (
    <Input
      placeholder="--:--"
      {...props}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      dir="ltr"
      maxLength={8}
      value={text}
      className={cn("tabular-nums", className)}
      onChange={(e) => {
        setText(e.target.value)
        const next = parseTime(e.target.value) ?? ""
        setSynced(next)
        onChange(next)
      }}
      onBlur={(e) => {
        const time = parseTime(text)
        if (time) setText(time)
        onBlur?.(e)
      }}
    />
  )
}
