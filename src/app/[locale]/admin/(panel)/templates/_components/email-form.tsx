"use client"

import { useLocale, useTranslations } from "next-intl"
import { useEffect, useState } from "react"
import { useWatch } from "react-hook-form"

import { Form, FormActions, SubmitButton } from "@/components/admin/form/form"
import { LocalizedInput, LocalizedTextarea } from "@/components/admin/form/localized-input"
import { useActionForm } from "@/components/admin/form/use-action-form"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { Locale } from "@/db/schema"
import { EMAIL_TEXT_MAX, type EmailTextField } from "@/emails/names"
import { previewEmailTexts, saveEmailTexts } from "@/features/templates/actions"
import type { EmailEditor } from "@/features/templates/emails"
import { emailTextsSchema, type EmailTextsValues } from "@/features/templates/schema"
import { cn } from "@/lib/utils"

const LOCALES: Locale[] = ["fa", "tr", "en"]

/** Field → input kind; texts people read as paragraphs get a textarea. */
const FIELDS: { name: EmailTextField; multiline?: number; hint?: "previewHint" | "optional" }[] = [
  { name: "subject" },
  { name: "preview", hint: "previewHint" },
  { name: "heading" },
  { name: "intro", multiline: 5 },
  { name: "intro2", multiline: 3, hint: "optional" },
  { name: "cta" },
  { name: "note", multiline: 2, hint: "optional" },
]

/** The texts of one email in three languages, with a live preview (example details, nothing sent). */
export function EmailTextsForm({ editor }: { editor: EmailEditor }) {
  const t = useTranslations("templates.emails")
  const tc = useTranslations("common")
  const { form, submit, pending } = useActionForm({
    schema: emailTextsSchema,
    action: saveEmailTexts,
    defaultValues: { template: editor.template, texts: editor.saved } satisfies EmailTextsValues,
    successMessage: t("toast.saved"),
    onSuccess: () => form.reset(form.getValues()),
  })

  return (
    <Form form={form} onSubmit={submit}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:items-start">
        <div className="min-w-0 space-y-6">
          <section className="bg-card ring-foreground/8 space-y-3 rounded-xl p-5 shadow-xs ring-1">
            <div className="space-y-1">
              <h2 className="text-base font-semibold">{t("form.placeholdersTitle")}</h2>
              <p className="text-muted-foreground text-sm text-pretty">{t("form.placeholdersHint")}</p>
            </div>
            <ul className="flex flex-wrap gap-1.5">
              {editor.placeholders.map((name) => (
                <li key={name}>
                  <code dir="ltr" className="bg-muted rounded-md px-1.5 py-0.5 font-mono text-xs">{`{${name}}`}</code>
                </li>
              ))}
            </ul>
          </section>

          <section className="bg-card ring-foreground/8 space-y-6 rounded-xl p-5 shadow-xs ring-1 md:p-6">
            <div className="space-y-1">
              <h2 className="text-base font-semibold">{t("form.textsTitle")}</h2>
              <p className="text-muted-foreground text-sm text-pretty">{t("form.textsDescription")}</p>
            </div>
            {FIELDS.map(({ name, multiline, hint }) => {
              const props = {
                name: `texts.${name}`,
                label: t(`fields.${name}`),
                description: hint ? t(`fields.${hint}`) : undefined,
                placeholder: editor.defaults[name],
                maxLength: EMAIL_TEXT_MAX,
              }
              return multiline ? <LocalizedTextarea key={name} {...props} rows={multiline} /> : <LocalizedInput key={name} {...props} />
            })}
          </section>
        </div>

        <aside className="lg:sticky lg:top-20">
          <Preview template={editor.template} />
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

type Shown = { request: string; subject?: string; html?: string; error?: string }

/** Renders the email on the server with the texts as they are in the form (debounced). */
function Preview({ template }: { template: EmailEditor["template"] }) {
  const t = useTranslations("templates.emails")
  const tc = useTranslations("common")
  const uiLocale = useLocale() as Locale
  const [locale, setLocale] = useState<Locale>(LOCALES.includes(uiLocale) ? uiLocale : "tr")
  const texts = useWatch<EmailTextsValues, "texts">({ name: "texts" })
  const request = useDebounced(JSON.stringify({ locale, texts }), 400)
  const [shown, setShown] = useState<Shown | null>(null)

  useEffect(() => {
    let stale = false
    const input = JSON.parse(request) as { locale: Locale; texts: EmailTextsValues["texts"] }
    previewEmailTexts({ template, ...input })
      .then((result) => {
        if (stale) return
        setShown(result.ok ? { request, ...result.data } : { request, error: Object.values(result.fieldErrors ?? {})[0] ?? result.error })
      })
      .catch(() => !stale && setShown({ request, error: tc("errors.generic") }))
    return () => {
      stale = true
    }
  }, [request, template, tc])

  const loading = !shown || shown.request !== request

  return (
    <section className="bg-card ring-foreground/8 space-y-3 rounded-xl p-3 shadow-xs ring-1" aria-busy={loading}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-1">
        <div className="space-y-0.5">
          <h2 className="text-base font-semibold">{t("form.previewTitle")}</h2>
          <p className="text-muted-foreground text-xs">{t("form.previewDescription")}</p>
        </div>
        <Tabs value={locale} onValueChange={(v) => setLocale(v as Locale)}>
          <TabsList className="h-8">
            {LOCALES.map((l) => (
              <TabsTrigger key={l} value={l} className="px-2.5" lang={l}>
                {tc(`locales.${l}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      {shown?.error ? (
        <div role="alert" className="border-destructive/30 bg-destructive/5 space-y-1 rounded-lg border p-3 text-sm">
          <p className="font-medium">{t("form.previewFailed")}</p>
          <p className="text-muted-foreground text-pretty">{shown.error}</p>
        </div>
      ) : (
        <>
          <p className="bg-muted/50 min-h-9 truncate rounded-lg px-3 py-2 text-sm" lang={locale} dir={locale === "fa" ? "rtl" : "ltr"}>
            <span className="text-muted-foreground">{t("form.previewSubject")}: </span>
            <span className="font-medium">{shown?.subject}</span>
          </p>
          <div className="relative overflow-hidden rounded-lg border bg-white">
            {shown?.html && (
              <iframe
                title={t("form.previewFrame")}
                srcDoc={shown.html}
                sandbox=""
                className={cn("block h-[36rem] w-full transition-opacity", loading && "opacity-60")}
              />
            )}
            {loading && (
              <span className="bg-background/80 absolute end-2 top-2 flex items-center gap-2 rounded-full px-2.5 py-1 text-xs shadow-xs">
                <Spinner aria-hidden className="size-3.5" />
                {t("form.previewLoading")}
              </span>
            )}
            {!shown?.html && <div className="h-[36rem]" />}
          </div>
        </>
      )}
    </section>
  )
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}
