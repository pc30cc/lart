"use client"

import { ArmchairIcon, Trash2Icon, UserRoundPlusIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { useState } from "react"
import { useWatch } from "react-hook-form"

import { ConfirmAction } from "@/components/admin/confirm-action"
import { Form, FormField, SubmitButton, TextField } from "@/components/admin/form/form"
import { useActionForm } from "@/components/admin/form/use-action-form"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatDate, formatDateTime, formatNumber, formatTimeRange } from "@/lib/format"
import { cn } from "@/lib/utils"
import { holdSeatsAction, releaseHoldAction } from "../actions"
import type { RegistrableWorkshop } from "../register"
import { holdSeatsSchema, type HoldSeatsValues } from "../schema"

/**
 * "Hold places": places kept for guests in this workshop. They are taken on
 * the site like registrations (visitors see no difference), cost nothing and
 * stay out of the finances; deleting a hold frees them for registrations.
 */
export function HoldSeatsDialog({ workshops, courseId }: { workshops: RegistrableWorkshop[]; courseId?: string }) {
  const t = useTranslations("workshops.registrations.holds")
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="lg" className="px-4">
          <ArmchairIcon />
          {t("action")}
        </Button>
      </DialogTrigger>
      <DialogContent showCloseButton={false} className="gap-5 p-5 sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle className="text-lg">{t("title")}</DialogTitle>
          <DialogDescription className="text-pretty">{t("description")}</DialogDescription>
        </DialogHeader>
        {open && <HoldForm workshops={workshops} courseId={courseId} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  )
}

/** The first day still taking people, on a workshop of several days (else none). */
const firstOpenDay = (w: RegistrableWorkshop | undefined) =>
  w && w.days.length > 1 ? Math.max(0, w.days.findIndex((d) => !d.begun && d.left > 0)) : undefined

function HoldForm({ workshops, courseId, onDone }: { workshops: RegistrableWorkshop[]; courseId?: string; onDone: () => void }) {
  const t = useTranslations("workshops.registrations.holds")
  const tr = useTranslations("workshops.registrations.add")
  const tc = useTranslations("common")
  const locale = useLocale()
  const { form, submit, pending } = useActionForm({
    schema: holdSeatsSchema,
    action: holdSeatsAction,
    defaultValues: { courseId: courseId ?? "", day: firstOpenDay(workshops.find((w) => w.id === courseId)), count: 1, note: "" },
    successMessage: t("done"),
    onSuccess: onDone,
  })
  const chosen = useWatch({ control: form.control, name: "courseId" })
  const workshop = workshops.find((w) => w.id === chosen)
  const several = (workshop?.days.length ?? 0) > 1
  return (
    <Form form={form} onSubmit={submit} className="space-y-5">
      {!courseId && (
        <FormField<HoldSeatsValues> name="courseId" label={tr("workshop")} required>
          {(field) => (
            <Select
              value={(field.value as string) || undefined}
              onValueChange={(v) => {
                field.onChange(v)
                form.setValue("day", firstOpenDay(workshops.find((w) => w.id === v)))
              }}
            >
              <SelectTrigger id={field.id} className="w-full">
                <SelectValue placeholder={tr("chooseWorkshop")} />
              </SelectTrigger>
              <SelectContent>
                {workshops.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.title} · {formatDate(w.days[0].startsAt, locale, "medium")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
      )}
      {workshop && several && (
        <FormField<HoldSeatsValues> name="day" label={tr("day")}>
          {(field) => (
            <RadioGroup value={field.value === undefined ? "" : String(field.value)} onValueChange={(v) => field.onChange(Number(v))} className="gap-2">
              {workshop.days.map((d, i) => {
                const closed = d.begun || d.left <= 0
                return (
                  <label
                    key={i}
                    htmlFor={`hold-day-${i}`}
                    className={cn(
                      "has-data-[state=checked]:border-primary/60 has-data-[state=checked]:bg-primary/5 flex items-center gap-3 rounded-xl border p-3 transition-colors",
                      closed ? "opacity-55" : "cursor-pointer",
                    )}
                  >
                    <RadioGroupItem id={`hold-day-${i}`} value={String(i)} disabled={closed} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{formatDate(d.startsAt, locale, "full")}</span>
                      <bdi className="text-muted-foreground text-xs tabular-nums">{formatTimeRange(d.startsAt, d.endsAt, locale)}</bdi>
                    </span>
                    <span className={cn("shrink-0 text-xs", closed ? "text-destructive font-medium" : "text-muted-foreground")}>
                      {d.begun ? tr("begun") : d.left > 0 ? tr("left", { count: d.left }) : tr("full")}
                    </span>
                  </label>
                )
              })}
            </RadioGroup>
          )}
        </FormField>
      )}
      <FormField<HoldSeatsValues> name="count" label={t("count")} description={workshop && !several ? tr("left", { count: workshop.days[0]?.left ?? 0 }) : undefined}>
        {({ value, ...field }) => (
          <Input {...field} value={String(value ?? "")} type="number" inputMode="numeric" min={1} max={100} className="w-28 tabular-nums" />
        )}
      </FormField>
      <TextField<HoldSeatsValues> name="note" label={t("note")} description={t("noteHint")} maxLength={120} />
      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        <DialogClose asChild>
          <Button type="button" variant="ghost" size="lg" disabled={pending}>
            {tc("actions.cancel")}
          </Button>
        </DialogClose>
        <SubmitButton pending={pending}>{t("confirm")}</SubmitButton>
      </div>
    </Form>
  )
}

export type HoldRow = { id: string; day: number | null; count: number; note: string; createdAt: string; by: string | null; dayLabel: string | null }

/** The places held in this workshop, each with who for, by whom, and "Free these places". */
export function HoldsList({ holds, locked }: { holds: HoldRow[]; locked: boolean }) {
  const t = useTranslations("workshops.registrations.holds")
  const locale = useLocale()
  if (!holds.length) return null
  const total = holds.reduce((s, h) => s + h.count, 0)
  return (
    <section className="bg-card ring-foreground/8 rounded-xl shadow-xs ring-1">
      <header className="flex items-center gap-3 border-b px-4 py-3">
        <span className="bg-primary/10 text-primary flex size-8 items-center justify-center rounded-lg">
          <ArmchairIcon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{t("listTitle")}</h2>
          <p className="text-muted-foreground text-xs">{t("listHint", { count: total })}</p>
        </div>
      </header>
      <ul className="divide-y">
        {holds.map((h) => (
          <li key={h.id} className="flex items-center gap-3 px-4 py-3">
            <span className="bg-muted flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-sm font-semibold tabular-nums">
              {formatNumber(h.count, locale)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 truncate text-sm font-medium" dir="auto">
                <UserRoundPlusIcon className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
                {h.note || t("guests")}
              </p>
              <p className="text-muted-foreground truncate text-xs">
                {h.dayLabel && <span className="text-primary font-medium">{h.dayLabel} · </span>}
                {t("by", { name: h.by ?? "—", date: formatDateTime(h.createdAt, locale, "medium") })}
              </p>
            </div>
            {!locked && (
              <ConfirmAction
                action={releaseHoldAction}
                input={{ id: h.id }}
                title={t("release.title")}
                description={t("release.description", { count: h.count })}
                confirmLabel={t("release.confirm")}
                successMessage={t("release.done")}
                trigger={
                  <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">
                    <Trash2Icon />
                    <span className="hidden sm:inline">{t("release.action")}</span>
                  </Button>
                }
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
