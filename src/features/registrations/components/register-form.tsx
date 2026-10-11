"use client"

import { BanknoteIcon, CreditCardIcon, InfoIcon, LandmarkIcon, type LucideIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { useFormContext } from "react-hook-form"

import { Form, FormField } from "@/components/admin/form/form"
import { BigSubmit, BigTextField, FormAlert } from "@/components/site/auth/fields"
import { useSiteForm } from "@/components/site/auth/use-site-form"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Link } from "@/i18n/navigation"
import type { AppLocale } from "@/i18n/routing"
import { formatLira } from "@/lib/money"
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
 * videos, both unticked to start with, the price with the ways to pay (in plain
 * words), and one big "Register" button. The server checks it all
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
}) {
  const t = useTranslations("registration.register")
  const tp = useTranslations("registration.price")
  const locale = useLocale() as AppLocale
  const { form, submit, pending, error } = useSiteForm({
    schema: registerSchema,
    action: registerAction,
    // Both boxes start unticked (the terms box left out): ticking them is the person's own act.
    defaultValues: { courseId, locale, participantName: defaultName, termsSha256: terms.sha256, photoConsent: false, videoConsent: false },
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
          <>
            <p className="text-muted-foreground text-sm text-pretty">{t("pay.later")}</p>
            <ul className="flex flex-wrap gap-2">
              {ways.map((way) => {
                const Icon = wayIcons[way]
                return (
                  <li key={way} className="bg-muted inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-sm">
                    <Icon className="text-primary size-4" aria-hidden />
                    {t(`pay.${way}`)}
                  </li>
                )
              })}
            </ul>
          </>
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
