"use client"

import { BanknoteIcon, CircleCheckIcon, CreditCardIcon, EyeIcon, InfoIcon, LandmarkIcon, type LucideIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { useFormContext, useWatch } from "react-hook-form"

import { Form, FormActions, FormField, SubmitButton, TextField } from "@/components/admin/form/form"
import { LocalizedTextarea } from "@/components/admin/form/localized-input"
import { useActionForm } from "@/components/admin/form/use-action-form"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { savePaymentSettings } from "@/features/registrations/admin/actions"
import { PaymentInstructions, type PaymentWays } from "@/features/registrations/components/payment-instructions"
import { formatIban, isolate } from "@/features/registrations/schema"
import { cleanIban, ibanProblem, paymentSettingsSchema, type PaymentSettingsValues } from "@/features/settings/payments"
import { localized } from "@/lib/format"
import { formatLira } from "@/lib/money"
import { cn } from "@/lib/utils"

type Values = PaymentSettingsValues

/** A sample price for the preview: ₺1.500. */
const SAMPLE_AMOUNT = 150_000

/**
 * The three ways to pay as cards with a switch (at least one stays on), the
 * bank account and the notes, and a live preview of what a student sees
 * after registering.
 */
export function PaymentSettingsForm({ saved }: { saved: Values }) {
  const t = useTranslations("settings.payments")
  const ts = useTranslations("settings")
  const tc = useTranslations("common")

  const { form, submit, pending } = useActionForm({
    schema: paymentSettingsSchema,
    action: savePaymentSettings,
    defaultValues: saved,
    successMessage: ts("toast.saved"),
    onSuccess: () => form.reset(form.getValues()),
  })
  const [cash, transfer, online] = useWatch({ control: form.control, name: ["cash", "transfer.enabled", "online.enabled"] })
  const on = [cash, transfer, online].filter(Boolean).length
  const transferErrors = Boolean(form.formState.errors.transfer)

  return (
    <Form form={form} onSubmit={submit}>
      <p className="text-muted-foreground max-w-2xl text-sm text-pretty">{t("intro")}</p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-start">
        <div className="min-w-0 space-y-4">
          <WayCard name="cash" icon={BanknoteIcon} title={t("cash.title")} description={t("cash.description")} last={cash && on === 1} />

          <WayCard
            name="transfer.enabled"
            icon={LandmarkIcon}
            title={t("transfer.title")}
            description={t("transfer.description")}
            last={transfer && on === 1}
          >
            {(transfer || transferErrors) && (
              <div className="space-y-5">
                <div className="grid gap-5 sm:grid-cols-2">
                  <TextField<Values>
                    name="transfer.accountHolder"
                    label={t("transfer.holder")}
                    description={t("transfer.holderHint")}
                    required
                    maxLength={120}
                    autoComplete="off"
                  />
                  <TextField<Values>
                    name="transfer.bankName"
                    label={t("transfer.bank")}
                    placeholder={t("transfer.bankPlaceholder")}
                    maxLength={120}
                    autoComplete="off"
                  />
                </div>
                <IbanField />
                <LocalizedTextarea
                  name="transfer.note"
                  label={t("transfer.note")}
                  description={t("transfer.noteHint")}
                  placeholder={t("transfer.notePlaceholder")}
                  maxLength={500}
                  rows={2}
                />
              </div>
            )}
          </WayCard>

          <WayCard
            name="online.enabled"
            icon={CreditCardIcon}
            title={t("online.title")}
            description={t("online.description")}
            last={online && on === 1}
          >
            <div className="space-y-5">
              <p className="bg-info/8 text-foreground/85 flex items-start gap-2.5 rounded-lg px-3.5 py-3 text-sm text-pretty">
                <InfoIcon className="text-info mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  {t("online.howTo")} {t("online.later")}
                </span>
              </p>
              {online && (
                <LocalizedTextarea
                  name="online.note"
                  label={t("online.note")}
                  description={t("online.noteHint")}
                  placeholder={t("online.notePlaceholder")}
                  maxLength={500}
                  rows={2}
                />
              )}
            </div>
          </WayCard>
        </div>

        <aside className="lg:sticky lg:top-20">
          <Preview />
        </aside>
      </div>

      <FormActions>
        <SubmitButton pending={pending} disabled={!form.formState.isDirty}>
          {tc("actions.saveChanges")}
        </SubmitButton>
      </FormActions>
    </Form>
  )
}

/** One way to pay: icon, title, a line of help and its switch; its details below when it is on. */
function WayCard({
  name,
  icon: Icon,
  title,
  description,
  last,
  children,
}: {
  name: "cash" | "transfer.enabled" | "online.enabled"
  icon: LucideIcon
  title: string
  description: string
  /** The only way still on: it can't be switched off. */
  last: boolean
  children?: React.ReactNode
}) {
  const t = useTranslations("settings.payments")
  return (
    <section className="bg-card ring-foreground/8 space-y-5 rounded-xl p-5 shadow-xs ring-1 md:p-6">
      <FormField<Values> name={name}>
        {(field) => (
          <label htmlFor={field.id} className="flex cursor-pointer items-start gap-4">
            <span
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-xl transition-colors",
                field.value ? "bg-primary/12 text-primary" : "bg-muted text-muted-foreground",
              )}
            >
              <Icon className="size-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1 space-y-1">
              <span className="block text-base font-semibold">{title}</span>
              <span className="text-muted-foreground block text-sm text-pretty">{description}</span>
              {last && <span className="text-muted-foreground block text-xs">{t("lastOne")}</span>}
            </span>
            <span className="flex shrink-0 items-center gap-2 pt-1">
              <span className="text-muted-foreground text-xs" aria-hidden>
                {field.value ? t("on") : t("off")}
              </span>
              <Switch
                id={field.id}
                ref={field.ref}
                checked={Boolean(field.value)}
                disabled={last}
                aria-describedby={field["aria-describedby"]}
                onCheckedChange={(checked) => {
                  field.onChange(checked)
                  field.onBlur()
                }}
              />
            </span>
          </label>
        )}
      </FormField>
      {children}
    </section>
  )
}

/** The IBAN, shown in groups of four (also while typing Persian digits or lower case), with a check mark once it is valid. */
function IbanField() {
  const t = useTranslations("settings.payments.transfer")
  return (
    <FormField<Values> name="transfer.iban" label={t("iban")} description={t("ibanHint")} required>
      {({ value, onChange, onBlur, ...field }) => {
        const clean = cleanIban(String(value ?? ""))
        const valid = clean.length > 0 && ibanProblem(clean) === null
        return (
          <div className="relative">
            <Input
              {...field}
              ref={field.ref}
              value={String(value ?? "")}
              onChange={(e) => onChange(e.target.value)}
              onBlur={() => {
                if (clean) onChange(formatIban(clean))
                onBlur()
              }}
              dir="ltr"
              inputMode="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={60}
              placeholder="TR00 0000 0000 0000 0000 0000 00"
              className="pe-9 font-mono tracking-wide"
            />
            {valid && (
              <CircleCheckIcon
                className="text-success pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2"
                aria-label={t("ibanValid")}
              />
            )}
          </div>
        )
      }}
    </FormField>
  )
}

/** What a student sees after registering, with the values in the form (not saved yet), in the panel's language. */
function Preview() {
  const t = useTranslations("settings.payments.preview")
  const locale = useLocale()
  const { control } = useFormContext<Values>()
  const values = useWatch({ control }) as Values
  const iban = cleanIban(values.transfer?.iban ?? "")
  const note = (text: Values["online"]["note"] | undefined) => localized(text, locale) || undefined

  const ways: PaymentWays = {
    ...(values.cash ? { cash: true as const } : {}),
    ...(values.transfer?.enabled && iban && !ibanProblem(iban)
      ? {
          transfer: {
            accountHolder: values.transfer.accountHolder ?? "",
            bankName: values.transfer.bankName ?? "",
            iban,
            note: note(values.transfer.note),
          },
        }
      : {}),
    ...(values.online?.enabled ? { paymentUrl: "https://iyzi.link/", onlineNote: note(values.online.note) } : {}),
  }

  return (
    <section className="bg-muted/40 ring-foreground/8 space-y-4 rounded-xl p-4 ring-1 md:p-5" aria-label={t("title")}>
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <EyeIcon className="text-muted-foreground size-4" aria-hidden />
          {t("title")}
        </h2>
        <p className="text-muted-foreground text-sm text-pretty">
          {t("description", { amount: isolate(formatLira(SAMPLE_AMOUNT, locale)) })}
        </p>
      </div>
      {/* A picture of the student's page: nothing in it can be clicked or copied. */}
      <div inert className="bg-background rounded-2xl p-3 shadow-xs select-none sm:p-4">
        <PaymentInstructions ways={ways} amount={SAMPLE_AMOUNT} participantName={t("participant")} />
      </div>
      {values.online?.enabled && <p className="text-muted-foreground text-xs text-pretty">{t("onlineHint")}</p>}
    </section>
  )
}
