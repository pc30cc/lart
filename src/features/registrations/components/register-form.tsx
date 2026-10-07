"use client"

import { BanknoteIcon, CreditCardIcon, InfoIcon, LandmarkIcon, type LucideIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"

import { Form, FormField } from "@/components/admin/form/form"
import { BigSubmit, BigTextField, FormAlert } from "@/components/site/auth/fields"
import { useSiteForm } from "@/components/site/auth/use-site-form"
import { Checkbox } from "@/components/ui/checkbox"
import type { AppLocale } from "@/i18n/routing"
import { formatLira } from "@/lib/money"
import { cn } from "@/lib/utils"
import { registerAction } from "../actions"
import { registerSchema, type PaymentWayName, type RegisterValues } from "../schema"
import { TermsText } from "./terms-text"

const wayIcons: Record<PaymentWayName, LucideIcon> = { cash: BanknoteIcon, transfer: LandmarkIcon, online: CreditCardIcon }

/**
 * The registration form: who attends (the member's name to start with; a
 * parent writes their child's name), the terms in full with the one required
 * box, the two optional photo / video choices, the price with the ways to pay
 * (in plain words), and one big "Register" button. The server checks it all
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
    // The terms box starts unticked (left out): ticking it is the person's own act.
    defaultValues: { courseId, locale, participantName: defaultName, termsSha256: terms.sha256, photoConsent: false, videoConsent: false },
  })

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

      <section className="space-y-3" aria-labelledby="register-terms">
        <h2 id="register-terms" className="text-lg font-semibold">
          {t("terms")}
        </h2>
        <p className="text-muted-foreground text-sm">{t("termsIntro")}</p>
        <div className="bg-muted/40 ring-foreground/6 rounded-2xl p-4 ring-1 sm:p-5">
          <TermsText text={terms.text} />
        </div>
        <CheckField name="acceptTerms" label={t("acceptTerms")} strong />
      </section>

      <section className="space-y-3" aria-labelledby="register-consent">
        <h2 id="register-consent" className="text-lg font-semibold">
          {t("consent.title")}{" "}
          <span className="text-muted-foreground text-sm font-normal">({t("consent.optional")})</span>
        </h2>
        <div className="text-muted-foreground space-y-2 text-sm leading-relaxed text-pretty">
          <p>{t("consent.text", { brand })}</p>
          <p>{t("consent.guardian")}</p>
        </div>
        <div className="space-y-2.5">
          <CheckField name="photoConsent" label={t("consent.photo")} />
          <CheckField name="videoConsent" label={t("consent.video")} />
        </div>
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

/** A whole-row checkbox: easy to tap, the label is part of it. */
function CheckField({ name, label, strong }: { name: "acceptTerms" | "photoConsent" | "videoConsent"; label: string; strong?: boolean }) {
  return (
    <FormField<RegisterValues> name={name}>
      {({ id, value, onChange, onBlur, ref, ...aria }) => (
        <label
          htmlFor={id}
          className={cn(
            "has-data-[state=checked]:border-primary/60 has-data-[state=checked]:bg-primary/5 flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors",
            aria["aria-invalid"] && "border-destructive/60",
          )}
        >
          <Checkbox
            id={id}
            ref={ref}
            checked={value === true}
            onCheckedChange={(checked) => onChange(checked === true)}
            onBlur={onBlur}
            className="mt-0.5 size-5 rounded-md"
            {...aria}
          />
          <span className={cn("text-base leading-snug text-pretty", strong && "font-medium")}>{label}</span>
        </label>
      )}
    </FormField>
  )
}
