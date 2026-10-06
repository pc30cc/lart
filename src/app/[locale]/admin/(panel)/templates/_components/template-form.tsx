"use client"

import { FileSignatureIcon, PlusIcon, ScrollTextIcon, TriangleAlertIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useEffect, useRef } from "react"
import { useWatch } from "react-hook-form"

import { Form, FormActions, FormField, FormSection, SubmitButton, TextField } from "@/components/admin/form/form"
import { LocalizedTextarea } from "@/components/admin/form/localized-input"
import { useActionForm } from "@/components/admin/form/use-action-form"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from "@/components/ui/field"
import { Kbd } from "@/components/ui/kbd"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import type { Locale, LocalizedText } from "@/db/schema"
import { createTemplate, updateTemplate } from "@/features/templates/actions"
import {
  templateKinds,
  templatePlaceholders,
  unknownPlaceholders,
  type TemplateKind,
} from "@/features/templates/placeholders"
import type { TemplatePreview } from "@/features/templates/preview"
import { TEMPLATE_BODY_MAX, TEMPLATE_NAME_MAX, templateSchema, type TemplateFormValues } from "@/features/templates/schema"
import { Link, useRouter } from "@/i18n/navigation"
import { TemplatePreviewDialog } from "./template-preview"

const LOCALES: Locale[] = ["fa", "tr", "en"]
const kindIcons = { terms: ScrollTextIcon, contract: FileSignatureIcon } satisfies Record<TemplateKind, unknown>

type Start = { kind: TemplateKind; name: string; body: LocalizedText }

/** Create (`initial`) or edit (`template`, with its id) a terms or contract template. */
export function TemplateForm({
  template,
  initial,
  preview,
}: {
  template?: Start & { id: string }
  initial?: Start
  preview: TemplatePreview
}) {
  const t = useTranslations("templates")
  const tc = useTranslations("common")
  const router = useRouter()
  const start = template ?? initial ?? { kind: "terms", name: "", body: {} }

  const { form, submit, pending } = useActionForm({
    schema: templateSchema,
    action: (values: TemplateFormValues) =>
      template ? updateTemplate({ ...values, kind: template.kind, id: template.id }) : createTemplate(values),
    defaultValues: {
      kind: start.kind,
      name: start.name,
      body: { fa: start.body.fa ?? "", tr: start.body.tr ?? "", en: start.body.en ?? "" },
    },
    successMessage: template ? t("toast.updated") : t("toast.created"),
    // Editing stays on the page (long texts are often saved more than once).
    onSuccess: () => (template ? form.reset(form.getValues()) : router.push("/admin/templates")),
  })
  const kind = (useWatch({ control: form.control, name: "kind" }) ?? start.kind) as TemplateKind
  const { isDirty } = form.formState

  // A long text should not be lost by closing the tab by mistake.
  useEffect(() => {
    if (!isDirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [isDirty])

  return (
    <Form form={form} onSubmit={submit}>
      <FormSection title={t("form.aboutTitle")} description={t("form.aboutDescription")}>
        {!template && (
          <FormField<TemplateFormValues> name="kind" label={t("fields.kind")} required>
            {(field) => (
              <RadioGroup
                id={field.id}
                value={field.value as TemplateKind}
                onValueChange={(v) => field.onChange(v)}
                aria-describedby={field["aria-describedby"]}
                className="grid gap-3 sm:grid-cols-2"
              >
                {templateKinds.map((k) => {
                  const Icon = kindIcons[k]
                  return (
                    <FieldLabel key={k} htmlFor={`${field.id}-${k}`} className="cursor-pointer">
                      <Field orientation="horizontal">
                        <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                        <FieldContent>
                          <FieldTitle>{t(`kinds.${k}.title`)}</FieldTitle>
                          <FieldDescription className="text-start">{t(`kinds.${k}.hint`)}</FieldDescription>
                        </FieldContent>
                        <RadioGroupItem value={k} id={`${field.id}-${k}`} />
                      </Field>
                    </FieldLabel>
                  )
                })}
              </RadioGroup>
            )}
          </FormField>
        )}
        <TextField<TemplateFormValues>
          name="name"
          label={t("fields.name")}
          description={t("fields.nameHint")}
          required
          maxLength={TEMPLATE_NAME_MAX}
          autoComplete="off"
        />
      </FormSection>

      <TextSection kind={kind} preview={preview} setBody={(lang, value) =>
        form.setValue(`body.${lang}`, value, { shouldDirty: true, shouldValidate: form.formState.isSubmitted })
      } getBody={(lang) => form.getValues(`body.${lang}`) ?? ""} />

      <FormActions>
        <Button variant="ghost" size="lg" asChild>
          <Link href="/admin/templates">{template ? t("backToList") : tc("actions.cancel")}</Link>
        </Button>
        <SubmitButton pending={pending} disabled={Boolean(template) && !isDirty}>
          {template ? tc("actions.saveChanges") : t("create")}
        </SubmitButton>
      </FormActions>
    </Form>
  )
}

/** The text in three languages, with the placeholder list, formatting help and the preview. */
function TextSection({
  kind,
  preview,
  getBody,
  setBody,
}: {
  kind: TemplateKind
  preview: TemplatePreview
  getBody: (lang: Locale) => string
  setBody: (lang: Locale, value: string) => void
}) {
  const t = useTranslations("templates")
  const tc = useTranslations("common")
  const editor = useRef<HTMLDivElement>(null)
  const lastFocused = useRef<HTMLTextAreaElement | null>(null)
  const body = (useWatch({ name: "body" }) ?? {}) as LocalizedText
  const unknown = LOCALES.flatMap((l) => unknownPlaceholders(body[l] ?? "", kind).map((name) => ({ l, name })))

  /** Put `{name}` at the cursor of the visible language (or at the end of it). */
  function insert(name: string) {
    const visible = Array.from(editor.current?.querySelectorAll("textarea") ?? []).find((el) => el.offsetParent !== null)
    if (!visible) return
    const lang = visible.lang as Locale
    const token = `{${name}}`
    const value = getBody(lang)
    const atCursor = visible === lastFocused.current
    const from = atCursor ? visible.selectionStart : value.length
    const to = atCursor ? visible.selectionEnd : value.length
    setBody(lang, value.slice(0, from) + token + value.slice(to))
    requestAnimationFrame(() => {
      visible.focus()
      visible.setSelectionRange(from + token.length, from + token.length)
    })
  }

  return (
    // Phones: heading, editor, then the help. Desktop: heading and help (sticky) beside the editor.
    <section className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:grid-rows-[auto_1fr] md:gap-x-8 md:gap-y-5">
      <div className="space-y-1 md:col-start-1 md:row-start-1">
        <h2 className="text-base font-semibold">{t("form.textTitle")}</h2>
        <p className="text-muted-foreground text-sm text-pretty">{t(`form.textDescription.${kind}`)}</p>
      </div>

      <div className="space-y-5 md:sticky md:top-20 md:col-start-1 md:row-start-2 md:max-h-[calc(100dvh-6rem)] md:self-start md:overflow-y-auto md:pb-2">
        <div className="space-y-2">
          <h3 className="text-muted-foreground text-xs font-medium">{t("form.placeholdersTitle")}</h3>
          <ul className="-mx-2 space-y-0.5">
            {templatePlaceholders[kind].map((name) => (
              <li key={name}>
                <button
                  type="button"
                  onClick={() => insert(name)}
                  aria-label={t("form.insert", { token: `{${name}}` })}
                  className="group/ph hover:bg-muted focus-visible:ring-ring/50 flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-start transition-colors outline-none focus-visible:ring-3"
                >
                  <code dir="ltr" className="bg-primary/10 text-primary shrink-0 rounded-md px-1.5 py-0.5 font-mono text-xs">
                    {`{${name}}`}
                  </code>
                  <span className="text-muted-foreground min-w-0 flex-1 text-xs leading-5">{t(`placeholders.${name}`)}</span>
                  <PlusIcon className="text-muted-foreground mt-0.5 size-3.5 shrink-0 opacity-0 transition-opacity group-hover/ph:opacity-100 group-focus-visible/ph:opacity-100" />
                </button>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground text-xs text-pretty">{t("form.placeholdersHint")}</p>
        </div>

        <div className="space-y-2">
          <h3 className="text-muted-foreground text-xs font-medium">{t("form.formatTitle")}</h3>
          <dl className="text-muted-foreground grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-xs">
            <dt dir="ltr"><Kbd>##</Kbd></dt>
            <dd>{t("form.formatHeading")}</dd>
            <dt dir="ltr"><Kbd>-</Kbd></dt>
            <dd>{t("form.formatItem")}</dd>
            <dt><Kbd>↵ ↵</Kbd></dt>
            <dd>{t("form.formatParagraph")}</dd>
          </dl>
        </div>
      </div>

      <div className="bg-card ring-foreground/8 row-start-2 min-w-0 space-y-4 rounded-xl p-5 shadow-xs ring-1 md:col-start-2 md:row-span-2 md:row-start-1 md:p-6">
        <div
          ref={editor}
          onFocusCapture={(event) => {
            if (event.target instanceof HTMLTextAreaElement) lastFocused.current = event.target
          }}
        >
          <LocalizedTextarea
            name="body"
            label={t("fields.body")}
            required={LOCALES}
            rows={18}
            maxLength={TEMPLATE_BODY_MAX}
            className="[&_textarea]:max-h-[70dvh] [&_textarea]:min-h-72 [&_textarea]:resize-y [&_textarea]:text-[0.95rem] [&_textarea]:leading-relaxed"
          />
        </div>

        {unknown.length > 0 && (
          <div role="status" className="border-warning/30 bg-warning/5 flex gap-2.5 rounded-lg border p-3 text-sm">
            <TriangleAlertIcon className="text-warning mt-0.5 size-4 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium">{t("form.unknownTitle")}</p>
              <ul className="text-muted-foreground space-y-0.5">
                {unknown.map(({ l, name }) => (
                  <li key={`${l}-${name}`}>
                    {t("form.unknownItem", { token: `{${name}}`, language: tc(`locales.${l}`) })}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-muted-foreground text-xs text-pretty">{t("preview.hint")}</p>
          <TemplatePreviewDialog kind={kind} preview={preview} />
        </div>
      </div>
    </section>
  )
}
