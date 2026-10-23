"use client"

import { ArmchairIcon, GiftIcon, MinusIcon, PlusIcon, TicketPlusIcon, Trash2Icon, UserRoundPlusIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { useWatch } from "react-hook-form"

import { ConfirmAction } from "@/components/admin/confirm-action"
import { WholeNumberInput } from "@/components/admin/form/digit-inputs"
import { Form, FormField, SubmitButton, TextField } from "@/components/admin/form/form"
import { useActionForm } from "@/components/admin/form/use-action-form"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatDate, formatDateTime, formatNumber, formatTimeRange } from "@/lib/format"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

import { changeHoldAction, holdSeatsAction, releaseHoldAction } from "../actions"
import { AddRegistrationDialog } from "./add-registration-dialog"
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
    defaultValues: { courseId: courseId ?? "", day: firstOpenDay(workshops.find((w) => w.id === courseId)), count: 1, note: "", invited: false },
    successMessage: t("done"),
    onSuccess: onDone,
  })
  const chosen = useWatch({ control: form.control, name: "courseId" })
  const invited = useWatch({ control: form.control, name: "invited" })
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
      <FormField<HoldSeatsValues> name="invited" label={t("kind.label")}>
        {(field) => (
          <RadioGroup value={field.value ? "invited" : "held"} onValueChange={(v) => field.onChange(v === "invited")} className="grid gap-2 sm:grid-cols-2">
            {(["held", "invited"] as const).map((kind) => (
              <label
                key={kind}
                htmlFor={`hold-kind-${kind}`}
                className="has-data-[state=checked]:border-primary/60 has-data-[state=checked]:bg-primary/5 flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors"
              >
                <RadioGroupItem id={`hold-kind-${kind}`} value={kind} className="mt-0.5" />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {kind === "invited" ? <GiftIcon className="text-primary size-4" aria-hidden /> : <ArmchairIcon className="text-primary size-4" aria-hidden />}
                    {t(`kind.${kind}`)}
                  </span>
                  <span className="text-muted-foreground block text-xs text-pretty">{t(`kind.${kind}Hint`)}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
        )}
      </FormField>
      <FormField<HoldSeatsValues> name="count" label={t("count")} description={workshop && !several ? tr("left", { count: workshop.days[0]?.left ?? 0 }) : undefined}>
        {({ value, onChange, ...field }) => <WholeNumberInput {...field} ref={field.ref} value={value} onChange={onChange} className="w-28" />}
      </FormField>
      <TextField<HoldSeatsValues>
        name="note"
        label={invited ? t("name") : t("note")}
        description={invited ? t("nameHint") : t("noteHint")}
        required={Boolean(invited)}
        maxLength={120}
      />
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

export type HoldRow = {
  id: string
  courseId: string
  day: number | null
  count: number
  note: string
  /** An invited guest (free), not just places kept aside. */
  invited: boolean
  createdAt: string
  by: string | null
  dayLabel: string | null
  /** The workshop's name, when the list shows several workshops' holds. */
  workshopTitle?: string
}

/** A hold's places with "−" / "+" one place (at 0 the hold is gone), or just the number when locked. */
export function HoldStepper({ hold, locked, registrable }: { hold: Pick<HoldRow, "id" | "count">; locked: boolean; registrable: boolean }) {
  const t = useTranslations("workshops.registrations.holds")
  const locale = useLocale()
  const [pending, start] = useTransition()
  const router = useRouter()
  if (locked) {
    return (
      <span className="bg-muted flex h-8 min-w-8 shrink-0 items-center justify-center rounded-full px-2 text-sm font-semibold tabular-nums">
        {formatNumber(hold.count, locale)}
      </span>
    )
  }
  const change = (delta: 1 | -1) =>
    start(async () => {
      const result = await changeHoldAction({ id: hold.id, delta })
      if (result && !result.ok) toast.error(result.error)
      else router.refresh()
    })
  return (
    <span className="bg-muted inline-flex shrink-0 items-center rounded-full p-0.5" aria-label={t("count")}>
      <Button type="button" variant="ghost" size="icon-xs" className="rounded-full" disabled={pending} onClick={() => change(-1)} aria-label={t("less")}>
        <MinusIcon />
      </Button>
      <span className="min-w-6 text-center text-sm font-semibold tabular-nums">{formatNumber(hold.count, locale)}</span>
      <Button type="button" variant="ghost" size="icon-xs" className="rounded-full" disabled={pending || !registrable} onClick={() => change(1)} aria-label={t("more")}>
        <PlusIcon />
      </Button>
    </span>
  )
}

/**
 * Who a hold is for, with its kind: "Ipek · Invited · free", or "Guests · Held".
 * `stacked`: the kind under the name (a narrow table cell keeps the whole name).
 */
export function HoldName({ hold, stacked = false, className }: { hold: Pick<HoldRow, "note" | "invited">; stacked?: boolean; className?: string }) {
  const t = useTranslations("workshops.registrations.holds")
  return (
    <span className={cn("flex min-w-0 gap-1.5 text-sm font-medium", stacked ? "flex-col items-start gap-1" : "items-center", className)}>
      <span className="flex max-w-full min-w-0 items-center gap-1.5">
        {hold.invited ? (
          <GiftIcon className="text-primary size-3.5 shrink-0" aria-hidden />
        ) : (
          <UserRoundPlusIcon className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
        )}
        <span className="truncate" dir="auto">
          {hold.note || t("guests")}
        </span>
      </span>
      <span
        className={cn(
          "shrink-0 rounded-full px-2 py-0.5 text-[0.7rem] font-medium",
          stacked && "self-start",
          hold.invited ? "bg-success/10 text-success" : "bg-muted text-muted-foreground",
        )}
      >
        {hold.invited ? t("kind.invitedBadge") : t("kind.heldBadge")}
      </span>
    </span>
  )
}

/** "Register on it" (someone takes one of the places: a registration on it) and "Delete hold" (all its places freed). */
export function HoldActions({
  hold,
  workshops,
  compact = false,
}: {
  hold: Pick<HoldRow, "id" | "courseId" | "count" | "note">
  workshops: RegistrableWorkshop[]
  /** Icons only on small screens (the registrations table). */
  compact?: boolean
}) {
  const t = useTranslations("workshops.registrations.holds")
  const registrable = workshops.some((w) => w.id === hold.courseId)
  return (
    <div className="flex items-center justify-end gap-1">
      {registrable && (
        <AddRegistrationDialog
          workshops={workshops}
          courseId={hold.courseId}
          hold={{ id: hold.id, note: hold.note }}
          button={
            <Button variant="outline" size="sm" title={t("register")}>
              <TicketPlusIcon />
              <span className={cn(compact && "hidden xl:inline")}>{t("register")}</span>
            </Button>
          }
        />
      )}
      <ConfirmAction
        action={releaseHoldAction}
        input={{ id: hold.id }}
        title={t("release.title")}
        description={t("release.description", { count: hold.count })}
        confirmLabel={t("release.confirm")}
        successMessage={t("release.done")}
        trigger={
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" title={t("release.action")}>
            <Trash2Icon />
            <span className={cn(compact ? "sr-only" : "hidden sm:inline")}>{t("release.action")}</span>
          </Button>
        }
      />
    </div>
  )
}

/**
 * The places held: each with who for and by whom, "−" / "+" one place,
 * "Register" (someone takes one of them: a registration on that place) and
 * "Delete hold" (all its places freed).
 */
export function HoldsList({ holds, locked, workshops }: { holds: HoldRow[]; locked: boolean; workshops: RegistrableWorkshop[] }) {
  const t = useTranslations("workshops.registrations.holds")
  const locale = useLocale()
  if (!holds.length) return null
  const total = holds.reduce((s, h) => s + h.count, 0)
  return (
    <section className="bg-card rounded-xl">
      <header className="flex items-center gap-3 border-b px-4 py-3 pe-12">
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
          <li key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <HoldStepper hold={h} locked={locked} registrable={workshops.some((w) => w.id === h.courseId)} />
              <div className="min-w-0">
                {h.workshopTitle && <p className="text-primary truncate text-xs font-medium">{h.workshopTitle}</p>}
                <HoldName hold={h} />
                <p className="text-muted-foreground truncate text-xs">
                  {h.dayLabel && <span className="text-primary font-medium">{h.dayLabel} · </span>}
                  {t("by", { name: h.by ?? "—", date: formatDateTime(h.createdAt, locale, "medium") })}
                </p>
              </div>
            </div>
            {!locked && <HoldActions hold={h} workshops={workshops} />}
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * "Places held · 3": the holds stay out of the page until asked for; the
 * button opens them (with − / +, "Register on it" and "Delete hold").
 */
export function HoldsButton({ holds, locked, workshops }: { holds: HoldRow[]; locked: boolean; workshops: RegistrableWorkshop[] }) {
  const t = useTranslations("workshops.registrations.holds")
  const locale = useLocale()
  if (!holds.length) return null
  const total = holds.reduce((s, h) => s + h.count, 0)
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="lg" className="px-4">
          <ArmchairIcon />
          {t("show")}
          <span className="bg-primary/10 text-primary rounded-full px-2 text-xs font-semibold tabular-nums">{formatNumber(total, locale)}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        <DialogTitle className="sr-only">{t("listTitle")}</DialogTitle>
        <DialogDescription className="sr-only">{t("listHint", { count: total })}</DialogDescription>
        <HoldsList holds={holds} locked={locked} workshops={workshops} />
      </DialogContent>
    </Dialog>
  )
}
