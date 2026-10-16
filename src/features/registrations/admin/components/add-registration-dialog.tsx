"use client"

import { CheckIcon, SearchIcon, TicketPlusIcon, XIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { useEffect, useState, useTransition } from "react"
import { useWatch } from "react-hook-form"

import { PersonPlaceholder } from "@/components/person-placeholder"
import { DateField, todayIso } from "@/app/[locale]/admin/(panel)/money/_components/fields"
import { Form, FormField, SubmitButton, TextField } from "@/components/admin/form/form"
import { useActionForm } from "@/components/admin/form/use-action-form"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { formatDate, formatTimeRange } from "@/lib/format"
import { formatLira } from "@/lib/money"
import { cn } from "@/lib/utils"
import { addRegistrationAction, searchMembersAction } from "../actions"
import type { RegistrableWorkshop } from "../register"
import { addRegistrationSchema, paymentMethods, type AddRegistrationValues } from "../schema"

type Member = { id: string; name: string; email: string; phone: string | null }

/**
 * "Add registration": a super admin registers a participant. Search the
 * member (name, email or phone), choose the workshop and, on several days,
 * the day (a full or begun day can't be chosen), the participant's name (the
 * member's to start with), and whether it is paid already (how, and when).
 * The member is emailed. `courseId` / `member` start it on one workshop or
 * one member (their pages).
 */
/** A place held for guests to register someone on: its workshop is `courseId`, its day is kept. */
export type HoldPlace = { id: string; note: string }

export function AddRegistrationDialog({
  workshops,
  courseId,
  member,
  trigger = "default",
  hold,
  button,
}: {
  workshops: RegistrableWorkshop[]
  courseId?: string
  member?: Member
  trigger?: "default" | "outline"
  /** Register on a place held for guests (the hold gives one place). */
  hold?: HoldPlace
  /** Another trigger button (e.g. a small one in a list). */
  button?: React.ReactNode
}) {
  const t = useTranslations("workshops.registrations.add")
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {button ?? (
          <Button variant={trigger} size="lg" className="px-4">
            <TicketPlusIcon />
            {t("trigger")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent showCloseButton={false} className="max-h-[92dvh] gap-5 overflow-y-auto p-5 sm:max-w-lg">
        <DialogHeader className="text-start">
          <DialogTitle className="text-lg">{t("title")}</DialogTitle>
          <DialogDescription className="text-pretty">{t("description")}</DialogDescription>
        </DialogHeader>
        {workshops.length === 0 ? (
          <p className="bg-muted rounded-lg p-3 text-sm">{t("noWorkshops")}</p>
        ) : (
          <AddForm workshops={workshops} courseId={courseId} member={member} hold={hold} onDone={() => setOpen(false)} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function AddForm({
  workshops,
  courseId,
  member: preset,
  hold,
  onDone,
}: {
  workshops: RegistrableWorkshop[]
  courseId?: string
  member?: Member
  hold?: HoldPlace
  onDone: () => void
}) {
  const t = useTranslations("workshops.registrations.add")
  const locale = useLocale()
  const [member, setMember] = useState<Member | null>(preset ?? null)
  const first = workshops.find((w) => w.id === courseId) ?? (workshops.length === 1 ? workshops[0] : undefined)
  const { form, submit, pending } = useActionForm({
    schema: addRegistrationSchema,
    action: addRegistrationAction,
    defaultValues: {
      memberId: preset?.id ?? "",
      courseId: first?.id ?? "",
      day: first ? firstOpenDay(first) : undefined,
      participantName: preset?.name ?? "",
      paid: false,
      paidOn: todayIso(),
      holdId: hold?.id,
    },
    successMessage: t("done"),
    onSuccess: onDone,
  })
  const chosenId = useWatch({ control: form.control, name: "courseId" })
  const paid = useWatch({ control: form.control, name: "paid" })
  const workshop = workshops.find((w) => w.id === chosenId)

  const pick = (m: Member | null) => {
    setMember(m)
    form.setValue("memberId", m?.id ?? "", { shouldValidate: Boolean(m) })
    if (m) form.setValue("participantName", m.name, { shouldValidate: true })
  }

  return (
    <Form form={form} onSubmit={submit} className="space-y-5">
      <FormField<AddRegistrationValues> name="memberId" label={t("member")} required>
        {() => (member ? <ChosenMember member={member} onChange={preset ? undefined : () => pick(null)} /> : <MemberSearch onPick={pick} />)}
      </FormField>

      {hold ? (
        <p className="bg-primary/5 ring-primary/15 rounded-lg px-3 py-2.5 text-sm ring-1">
          <span className="font-medium">{workshop?.title}</span>
          <span className="text-muted-foreground block text-xs">{t("onHold", { note: hold.note || "—" })}</span>
        </p>
      ) : (
      <FormField<AddRegistrationValues> name="courseId" label={t("workshop")} required>
        {(field) => (
          <Select
            value={(field.value as string) || undefined}
            onValueChange={(v) => {
              field.onChange(v)
              const w = workshops.find((x) => x.id === v)
              form.setValue("day", w ? firstOpenDay(w) : undefined)
            }}
          >
            <SelectTrigger id={field.id} className="w-full">
              <SelectValue placeholder={t("chooseWorkshop")} />
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

      {workshop && !hold && (
        <FormField<AddRegistrationValues> name="day" label={workshop.days.length > 1 ? t("day") : t("when")}>
          {(field) => (
            <RadioGroup
              value={field.value === undefined ? "" : String(field.value)}
              onValueChange={(v) => field.onChange(Number(v))}
              className="gap-2"
            >
              {workshop.days.map((d, i) => {
                const closed = d.begun || d.left <= 0
                return (
                  <label
                    key={i}
                    htmlFor={`day-${i}`}
                    className={cn(
                      "has-data-[state=checked]:border-primary/60 has-data-[state=checked]:bg-primary/5 flex items-center gap-3 rounded-xl border p-3 transition-colors",
                      closed ? "opacity-55" : "cursor-pointer",
                    )}
                  >
                    <RadioGroupItem id={`day-${i}`} value={String(i)} disabled={closed} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{formatDate(d.startsAt, locale, "full")}</span>
                      <bdi className="text-muted-foreground text-xs tabular-nums">{formatTimeRange(d.startsAt, d.endsAt, locale)}</bdi>
                    </span>
                    <span className={cn("shrink-0 text-xs", d.left > 0 && !d.begun ? "text-muted-foreground" : "text-destructive font-medium")}>
                      {d.begun ? t("begun") : d.left > 0 ? t("left", { count: d.left }) : t("full")}
                    </span>
                  </label>
                )
              })}
            </RadioGroup>
          )}
        </FormField>
      )}

      <TextField<AddRegistrationValues> name="participantName" label={t("participant")} description={t("participantHint")} required maxLength={80} />

      <FormField<AddRegistrationValues> name="paid" label={t("payment")}>
        {(field) => (
          <RadioGroup value={field.value ? "paid" : "unpaid"} onValueChange={(v) => field.onChange(v === "paid")} className="grid grid-cols-2 gap-2">
            {(["unpaid", "paid"] as const).map((v) => (
              <label
                key={v}
                htmlFor={`pay-${v}`}
                className="has-data-[state=checked]:border-primary/60 has-data-[state=checked]:bg-primary/5 flex cursor-pointer items-center gap-2.5 rounded-xl border p-3 text-sm transition-colors"
              >
                <RadioGroupItem id={`pay-${v}`} value={v} />
                {t(`paymentState.${v}`)}
              </label>
            ))}
          </RadioGroup>
        )}
      </FormField>
      {workshop && workshop.price > 0 && (
        <p className="text-muted-foreground -mt-3 text-xs">{t("price", { price: formatLira(workshop.price, locale) })}</p>
      )}

      {paid && (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField<AddRegistrationValues> name="method" label={t("method")} required>
            {(field) => (
              <Select value={(field.value as string) || undefined} onValueChange={field.onChange}>
                <SelectTrigger id={field.id} className="w-full">
                  <SelectValue placeholder={t("chooseMethod")} />
                </SelectTrigger>
                <SelectContent>
                  {paymentMethods.map((m) => (
                    <SelectItem key={m} value={m}>
                      {t(`methods.${m}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <DateField<AddRegistrationValues> name="paidOn" label={t("paidOn")} />
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        <DialogClose asChild>
          <Button type="button" variant="ghost" size="lg" disabled={pending}>
            {t("cancel")}
          </Button>
        </DialogClose>
        <SubmitButton pending={pending}>{t("submit")}</SubmitButton>
      </div>
    </Form>
  )
}

/** The first day that has not begun and has a place left (or undefined). */
function firstOpenDay(w: RegistrableWorkshop): number | undefined {
  const i = w.days.findIndex((d) => !d.begun && d.left > 0)
  return i >= 0 ? i : undefined
}

function ChosenMember({ member, onChange }: { member: Member; onChange?: () => void }) {
  const t = useTranslations("workshops.registrations.add")
  return (
    <div className="bg-primary/5 ring-primary/25 flex items-center gap-3 rounded-xl p-3 ring-1">
      <CheckIcon className="text-primary size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{member.name}</span>
        <bdi className="text-muted-foreground block truncate text-xs">{member.email}</bdi>
      </span>
      {onChange && (
        <Button type="button" variant="ghost" size="sm" onClick={onChange}>
          <XIcon />
          {t("change")}
        </Button>
      )}
    </div>
  )
}

/** Type a name, email or phone; the matching members show under it to choose from. */
function MemberSearch({ onPick }: { onPick: (m: Member) => void }) {
  const t = useTranslations("workshops.registrations.add")
  const [q, setQ] = useState("")
  const [results, setResults] = useState<Member[]>([])
  const [loading, start] = useTransition()

  useEffect(() => {
    const timer = setTimeout(() => {
      start(async () => {
        const found = await searchMembersAction({ q })
        setResults(found?.ok ? found.data : [])
      })
    }, 250)
    return () => clearTimeout(timer)
  }, [q])

  return (
    <div className="space-y-2">
      <div className="relative">
        <SearchIcon className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchPlaceholder")} className="ps-9" autoFocus />
        {loading && <Spinner className="absolute end-3 top-1/2 size-4 -translate-y-1/2" aria-hidden />}
      </div>
      <ul className="max-h-52 divide-y overflow-y-auto rounded-xl border">
        {results.length === 0 ? (
          <li className="text-muted-foreground p-3 text-sm">{loading ? t("searching") : t("noMembers")}</li>
        ) : (
          results.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onPick(m)}
                className="hover:bg-muted focus-visible:bg-muted flex w-full items-center gap-3 p-2.5 text-start transition-colors outline-none"
              >
                <PersonPlaceholder className="size-8" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{m.name}</span>
                  <bdi className="text-muted-foreground block truncate text-xs">
                    {m.email}
                    {m.phone ? ` · ${m.phone}` : ""}
                  </bdi>
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}
