"use client"

import { BanknoteIcon, CreditCardIcon, InfoIcon, LandmarkIcon, type LucideIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { useFormContext } from "react-hook-form"

import { Form, FormField } from "@/components/admin/form/form"
import { BigSubmit, BigTextField, FormAlert } from "@/components/site/auth/fields"
import { useSiteForm } from "@/components/site/auth/use-site-form"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Link } from "@/i18n/navigation"
import type { AppLocale } from "@/i18n/routing"
import { formatLira } from "@/lib/money"
import { SeatsMeter } from "@/components/site/workshop-labels"
import { cn } from "@/lib/utils"
import { registerAction } from "../actions"
import { registerSchema, type PaymentWayName, type RegisterValues } from "../schema"
import { TermsText } from "./terms-text"

const wayIcons: Record<PaymentWayName, LucideIcon> = { cash: BanknoteIcon, transfer: LandmarkIcon, online: CreditCardIcon }

/**
 * The registration form: who attends (the member's name to start with; a
 * parent writes their child's name), the terms box (its link opens the terms
 * and what the photo / video box means in a dialog; a second one, the distance
 * sales agreement, in a new tab) and one box for photos and
 * videos, both unticked to start with, the price and how they will pay
 * (cash or bank transfer, …: one of the ways on), and one big "Register" button. The server checks it all
 * again (seats, deadline, the terms text) and opens the "you're registered" page.
 */
export function RegisterForm({
  courseId,
  defaultName,
  terms,
  brand,
  ageRange,
  price,
  ways,
  days,
}: {
  courseId: string
  defaultName: string
  terms: { text: string; sha256: string }
  brand: string
  /** The age range of a children's workshop (a parent registers the child). */
  ageRange: { min: number; max: number } | null
  /** In kuruş; 0 for a free workshop. */
  price: number
  ways: PaymentWayName[]
  /**
   * A workshop on several days: each day (written out) and its places left, to
   * choose one; `taken` (registered) only when visitors may see the numbers.
   */
  days?: Day[]
}) {
  const t = useTranslations("registration.register")
  const tp = useTranslations("registration.price")
  const locale = useLocale() as AppLocale
  const { form, submit, pending, error } = useSiteForm({
    schema: registerSchema,
    action: registerAction,
    // Both boxes start unticked (the terms box left out): ticking them is the person's own act.
    // The first way to pay is chosen to start with: one tap fewer for most people.
    defaultValues: {
      courseId,
      locale,
      participantName: defaultName,
      termsSha256: terms.sha256,
      photoConsent: false,
      videoConsent: false,
      paymentChoice: price > 0 ? ways[0] : undefined,
      // The first day with a place left, to start with.
      day: days ? Math.max(0, days.findIndex((d) => d.left > 0)) : undefined,
    },
  })
  const dialog = (chunks: React.ReactNode) => (
    <TermsDialog
      text={terms.text}
      title={t("terms")}
      trigger={chunks}
      consent={{ title: t("consent.title"), optional: t("consent.optional"), text: t("consent.text", { brand }), guardian: t("consent.guardian") }}
    />
  )

  // The agreement on its own page, in a new tab (the form keeps what was typed).
  const salesLink = (chunks: React.ReactNode) => (
    <Link
      href="/distance-sales"
      target="_blank"
      onClick={(e) => e.stopPropagation()}
      className="text-primary decoration-primary/40 hover:decoration-primary underline underline-offset-4 transition-colors"
    >
      {chunks}
    </Link>
  )

  return (
    <Form form={form} onSubmit={submit} className="space-y-8">
      <section className="space-y-3">
        <BigTextField
          name="participantName"
          label={t("participant")}
          description={ageRange ? undefined : t("participantHint")}
          autoComplete="name"
          maxLength={80}
        />
        {ageRange && (
          <p className="bg-info/8 text-foreground flex gap-2.5 rounded-xl p-3.5 text-sm leading-relaxed">
            <InfoIcon className="text-info mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="text-pretty">{t("childNote", ageRange)}</span>
          </p>
        )}
      </section>

      {days && <DayChoiceField days={days} />}

      <section className="space-y-2.5">
        <CheckField name="acceptTerms" ariaLabel={t("acceptTerms")} label={t.rich("acceptTermsRich", { terms: dialog, sales: salesLink })} strong />
        <MediaConsentField label={t("consent.both")} />
      </section>

      <section className="bg-card ring-foreground/8 space-y-3 rounded-2xl p-4 shadow-xs ring-1 sm:p-5" aria-labelledby="register-pay">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="register-pay" className="text-base font-semibold">
            {t("pay.title")}
          </h2>
          <span className="text-xl font-semibold tabular-nums">
            {price > 0 ? <bdi>{formatLira(price, locale)}</bdi> : tp("free")}
          </span>
        </div>
        {price === 0 ? (
          <p className="text-muted-foreground text-sm">{t("pay.free")}</p>
        ) : ways.length === 0 ? (
          <p className="text-muted-foreground text-sm text-pretty">{t("pay.none")}</p>
        ) : (
          <PaymentChoiceField ways={ways} />
        )}
      </section>

      <div className="space-y-4">
        {error && <FormAlert>{error}</FormAlert>}
        <BigSubmit pending={pending}>{t("submit")}</BigSubmit>
      </div>
    </Form>
  )
}

/**
 * The terms as a link inside the box's label: it opens them in a dialog (and
 * does not tick the box), with what the photo and video box means under them.
 * The terms text is the exact one the person accepts.
 */
function TermsDialog({
  text,
  title,
  trigger,
  consent,
}: {
  text: string
  title: string
  trigger: React.ReactNode
  consent: { title: string; optional: string; text: string; guardian: string }
}) {
  const tc = useTranslations("common")
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="text-primary decoration-primary/40 hover:decoration-primary underline underline-offset-4 transition-colors"
        >
          {trigger}
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85svh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-6 overflow-y-auto px-5 py-4">
          <TermsText text={text} />
          <section className="space-y-2 border-t pt-5">
            <h3 className="font-semibold">
              {consent.title} <span className="text-muted-foreground text-sm font-normal">({consent.optional})</span>
            </h3>
            <div className="text-muted-foreground space-y-2 text-sm leading-relaxed text-pretty">
              <p>{consent.text}</p>
              <p>{consent.guardian}</p>
            </div>
          </section>
        </div>
        <div className="flex justify-end border-t px-5 py-3">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {tc("actions.close")}
            </Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** A workshop on several days: which day, as big cards to tap (a full day says so and can't be chosen). */
type Day = { date: string; hours: string; left: number; taken?: number; closed?: boolean }

function DayChoiceField({ days }: { days: Day[] }) {
  const t = useTranslations("registration.register.day")
  return (
    <FormField<RegisterValues> name="day">
      {({ id, value, onChange, ...aria }) => (
        <fieldset className="space-y-2.5">
          <legend id={`${id}-legend`} className="mb-2.5 text-base font-semibold">
            {t("choose")}
          </legend>
          <RadioGroup
            value={value === undefined ? "" : String(value)}
            onValueChange={(v) => onChange(Number(v))}
            aria-labelledby={`${id}-legend`}
            className="gap-2.5"
            {...aria}
          >
            {days.map((d, i) => (
              <label
                key={i}
                htmlFor={`${id}-${i}`}
                className={cn(
                  "has-data-[state=checked]:border-primary/60 has-data-[state=checked]:bg-primary/5 flex items-start gap-3 rounded-xl border p-3.5 transition-colors",
                  d.left > 0 ? "cursor-pointer" : "opacity-55",
                )}
              >
                <RadioGroupItem id={`${id}-${i}`} value={String(i)} disabled={d.left <= 0} className="mt-0.5 size-5" />
                <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span>
                    <span className="block font-medium">{d.date}</span>
                    <span className="text-muted-foreground block text-sm">
                      <bdi className="tabular-nums">{d.hours}</bdi>
                    </span>
                  </span>
                  {/* Registered and left when Settings → General shows them, else only "Full". */}
                  {d.closed ? (
                    <span className="text-muted-foreground text-sm font-medium">{t("closed")}</span>
                  ) : d.taken !== undefined ? (
                    <SeatsMeter taken={d.taken} left={d.left} label={d.date} className="mt-1.5 basis-full" />
                  ) : (
                    d.left <= 0 && <span className="text-destructive text-sm font-medium">{t("full")}</span>
                  )}
                </span>
              </label>
            ))}
          </RadioGroup>
        </fieldset>
      )}
    </FormField>
  )
}

/**
 * How they will pay, as big cards to tap (the first chosen to start with):
 * cash on the day, or a bank transfer (the account and the receipt upload
 * come on the next page), or online. Just one way: said, nothing to choose.
 */
function PaymentChoiceField({ ways }: { ways: PaymentWayName[] }) {
  const t = useTranslations("registration.register.pay")
  if (ways.length === 1) {
    const Icon = wayIcons[ways[0]]
    return (
      <p className="flex items-start gap-3 text-sm text-pretty">
        <Icon className="text-primary mt-0.5 size-5 shrink-0" aria-hidden />
        <span>
          <span className="font-medium">{t(ways[0])}</span> · {t(`hint.${ways[0]}`)}
        </span>
      </p>
    )
  }
  return (
    <FormField<RegisterValues> name="paymentChoice">
      {({ id, value, onChange, ...aria }) => (
        <fieldset className="space-y-2.5">
          <legend id={`${id}-legend`} className="mb-2.5 text-sm font-medium">
            {t("choose")}
          </legend>
          <RadioGroup value={value as string} onValueChange={onChange} aria-labelledby={`${id}-legend`} className="gap-2.5" {...aria}>
            {ways.map((way) => {
              const Icon = wayIcons[way]
              return (
                <label
                  key={way}
                  htmlFor={`${id}-${way}`}
                  className="has-data-[state=checked]:border-primary/60 has-data-[state=checked]:bg-primary/5 flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors"
                >
                  <RadioGroupItem id={`${id}-${way}`} value={way} className="mt-0.5 size-5" />
                  <Icon className="text-primary mt-0.5 size-5 shrink-0" aria-hidden />
                  <span className="space-y-0.5">
                    <span className="block font-medium">{t(way)}</span>
                    <span className="text-muted-foreground block text-sm text-pretty">{t(`hint.${way}`)}</span>
                  </span>
                </label>
              )
            })}
          </RadioGroup>
        </fieldset>
      )}
    </FormField>
  )
}

/** One box for photos and videos together: it sets both consents (still kept apart on the registration). */
function MediaConsentField({ label }: { label: string }) {
  const { setValue } = useFormContext<RegisterValues>()
  return <CheckField name="photoConsent" label={label} onChange={(checked) => setValue("videoConsent", checked)} />
}

/** A whole-row checkbox: easy to tap, the label is part of it. */
function CheckField({
  name,
  label,
  ariaLabel,
  strong,
  onChange: also,
}: {
  name: "acceptTerms" | "photoConsent" | "videoConsent"
  label: React.ReactNode
  /** The box's name when the label holds a link. */
  ariaLabel?: string
  strong?: boolean
  /** Called with the new state after the field changes. */
  onChange?: (checked: boolean) => void
}) {
  return (
    <FormField<RegisterValues> name={name}>
      {({ id, value, onChange, onBlur, ref, ...aria }) => (
        <label
          htmlFor={id}
          className={cn(
            "bg-card/85 has-data-[state=checked]:border-primary/60 has-data-[state=checked]:bg-primary/5 flex cursor-pointer items-start gap-3 rounded-xl border p-4 backdrop-blur-sm transition-colors",
            aria["aria-invalid"] && "border-destructive/60",
          )}
        >
          <Checkbox
            id={id}
            ref={ref}
            checked={value === true}
            onCheckedChange={(checked) => {
              onChange(checked === true)
              also?.(checked === true)
            }}
            onBlur={onBlur}
            // A square with a clear border (rounded-md would make a 20px box a circle, like a radio button).
            className="border-foreground/50 mt-0.5 size-5 rounded-[5px] border-2 [&_svg]:size-4!"
            aria-label={ariaLabel}
            {...aria}
          />
          <span className={cn("text-base leading-snug text-pretty", strong && "font-medium")}>{label}</span>
        </label>
      )}
    </FormField>
  )
}
