"use client"

import { CheckIcon, ExternalLinkIcon, RotateCcwIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { useId } from "react"
import { useFormContext, useFormState, useWatch } from "react-hook-form"

import { Form, FormActions, FormField, SubmitButton } from "@/components/admin/form/form"
import { useActionForm } from "@/components/admin/form/use-action-form"
import { StatusBadge } from "@/components/admin/status-badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { saveAppearanceSettings } from "@/features/settings/appearance-actions"
import { appearanceSettingsSchema, nearestWeight, type AppearanceSettingsValues } from "@/features/settings/appearance-schema"
import { Link } from "@/i18n/navigation"
import { cn } from "@/lib/utils"
import { fontStack, siteFontStyles } from "@/themes/font-css"
import { fontById, latinFontIds, persianFontIds, scriptOf, type FontScript, type SiteFonts } from "@/themes/fonts"
import { themeDefaultFonts, themeIds, type ThemeId } from "@/themes/ids"
import { ChoiceCards, Panel } from "../_components/fields"
import { previewLooks, ThemePicture } from "./theme-pictures"

type Values = AppearanceSettingsValues

/** The four font choices, in the order the page shows them. */
const rows = [
  { script: "latin", part: "heading", label: "latinHeading" },
  { script: "latin", part: "body", label: "latinBody" },
  { script: "persian", part: "heading", label: "persianHeading" },
  { script: "persian", part: "body", label: "persianBody" },
] as const

const sameFonts = (a: SiteFonts, b: SiteFonts) =>
  rows.every(({ script, part }) => a[script][part].id === b[script][part].id && a[script][part].weight === b[script][part].weight)

/**
 * The site's theme and the chosen theme's fonts, with a live preview. Choosing
 * another theme shows that theme's fonts (saved, or its own); each theme keeps
 * its fonts, and only the chosen theme's are saved.
 */
export function AppearanceSettingsForm({
  saved,
  brand,
}: {
  saved: { theme: ThemeId; fonts: Record<ThemeId, SiteFonts> }
  brand: string
}) {
  const t = useTranslations("appearance")
  const ts = useTranslations("settings")
  const tc = useTranslations("common")
  const persian = scriptOf(useLocale()) === "persian"

  const { form, submit, pending } = useActionForm({
    schema: appearanceSettingsSchema,
    action: saveAppearanceSettings,
    defaultValues: { theme: saved.theme, fonts: saved.fonts[saved.theme] },
    successMessage: ts("toast.saved"),
    onSuccess: () => form.reset(form.getValues()),
  })
  const [theme, fonts] = useWatch({ control: form.control, name: ["theme", "fonts"] }) as [ThemeId, SiteFonts]
  const ownFonts = sameFonts(fonts, themeDefaultFonts[theme])

  const setFonts = (value: SiteFonts) => {
    form.setValue("fonts", structuredClone(value), { shouldDirty: true })
    form.clearErrors("fonts")
  }

  return (
    <Form form={form} onSubmit={submit}>
      <Panel title={t("theme.title")} description={t("theme.description")}>
        <FormField<Values> name="theme" label={t("theme.label")}>
          {(field) => (
            <ChoiceCards
              id={field.id}
              value={field.value as ThemeId}
              onChange={(id) => {
                field.onChange(id)
                field.onBlur()
                setFonts(saved.fonts[id])
              }}
              describedBy={field["aria-describedby"]}
              className="sm:grid-cols-2 lg:grid-cols-3"
              choices={themeIds.map((id) => {
                const style = siteFontStyles(id === theme ? fonts : saved.fonts[id])[persian ? "persian" : "latin"]
                return {
                  value: id,
                  title: t(`theme.names.${id}`),
                  description: t(`theme.descriptions.${id}`),
                  preview: <ThemePicture themeId={id} brand={brand} heading={style.heading} persian={persian} />,
                  badge: id === saved.theme ? <StatusBadge tone="success">{t("theme.current")}</StatusBadge> : undefined,
                }
              })}
            />
          )}
        </FormField>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start">
        <Panel title={t("fonts.title")} description={t("fonts.description", { theme: t(`theme.names.${theme}`) })}>
          <div className="space-y-5">
            {rows.map((row) => (
              <FontRow key={row.label} {...row} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-5">
            <Button type="button" variant="outline" disabled={ownFonts} onClick={() => setFonts(themeDefaultFonts[theme])}>
              <RotateCcwIcon aria-hidden />
              {t("fonts.useThemeFonts")}
            </Button>
            {ownFonts && (
              <span className="text-muted-foreground flex items-center gap-1.5 text-sm">
                <CheckIcon aria-hidden className="text-success size-4 shrink-0" />
                {t("fonts.usingThemeFonts")}
              </span>
            )}
          </div>
        </Panel>

        <aside className="lg:sticky lg:top-20">
          <FontPreview theme={theme} fonts={fonts} />
        </aside>
      </div>

      <FormActions>
        <Button asChild variant="ghost" size="lg" className="me-auto">
          <Link href="/" target="_blank" rel="noopener">
            <ExternalLinkIcon aria-hidden className="rtl:-scale-x-100" />
            {t("seeSite")}
          </Link>
        </Button>
        <SubmitButton pending={pending} disabled={!form.formState.isDirty}>
          {tc("actions.saveChanges")}
        </SubmitButton>
      </FormActions>
    </Form>
  )
}

/** One font choice: the font (only the script's own fonts) and its weight (only that font's weights). */
function FontRow({ script, part, label }: (typeof rows)[number]) {
  const t = useTranslations("appearance.fonts")
  const labelId = useId()
  const { control, getValues, setValue } = useFormContext<Values>()
  const fontId = useWatch({ control, name: `fonts.${script}.${part}.id` }) as string
  const weights: readonly number[] = fontById(fontId)?.weights ?? []
  const weightName = (weight: number) => t("weightName", { name: t(`weights.${weight}`), n: weight })

  return (
    <div role="group" aria-labelledby={labelId} className="space-y-2">
      <div id={labelId} className="text-sm font-medium">
        {t(`rows.${label}`)}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,8rem)] items-start gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,9.5rem)]">
        <FormField<Values> name={`fonts.${script}.${part}.id`}>
          {(field) => (
            <Select
              value={field.value as string}
              onValueChange={(id) => {
                field.onChange(id)
                field.onBlur()
                // A new font keeps the weight when it has it, else takes its nearest one.
                const weight = getValues(`fonts.${script}.${part}.weight`) as number
                setValue(`fonts.${script}.${part}.weight`, nearestWeight(id, weight), { shouldDirty: true, shouldValidate: true })
              }}
            >
              <SelectTrigger
                id={field.id}
                ref={field.ref}
                aria-label={t("font")}
                aria-invalid={field["aria-invalid"]}
                aria-describedby={field["aria-describedby"]}
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(script === "latin" ? latinFontIds : persianFontIds).map((id) => (
                  <SelectItem key={id} value={id}>
                    <FontName id={id} script={script} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
        <FormField<Values> name={`fonts.${script}.${part}.weight`}>
          {(field) => (
            <Select
              value={String(field.value)}
              onValueChange={(value) => {
                field.onChange(Number(value))
                field.onBlur()
              }}
            >
              <SelectTrigger
                id={field.id}
                ref={field.ref}
                aria-label={t("weight")}
                aria-invalid={field["aria-invalid"]}
                aria-describedby={field["aria-describedby"]}
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {weights.map((weight) => (
                  <SelectItem key={weight} value={String(weight)}>
                    <span style={{ fontWeight: weight }}>{weightName(weight)}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
      </div>
    </div>
  )
}

/** A font's own name, written in that font (a Persian font also writes a Persian word, its Latin letters may be borrowed). */
function FontName({ id, script }: { id: string; script: FontScript }) {
  const font = fontById(id)
  if (!font) return null
  if (script === "latin") return <span style={{ fontFamily: fontStack(id) }}>{font.label}</span>
  return (
    <span className="flex items-baseline gap-2">
      {font.label}
      <span lang="fa" dir="rtl" style={{ fontFamily: fontStack(id) }} className="text-muted-foreground">
        سلام
      </span>
    </span>
  )
}

/**
 * Specimens of the site's text, shown with the fonts in the form (not saved
 * yet): they are not translated, each is in its own language.
 */
const SAMPLES = {
  latin: {
    lang: "tr",
    dir: "ltr",
    heading: "Seramik, mum ve makrome atölyeleri",
    text: "İstanbul’da küçük, sıcak gruplarda birlikte öğreniyor ve üretiyoruz. Daha önce hiç denemediniz mi? Hiç sorun değil; gelin, birlikte yapalım.",
  },
  persian: {
    lang: "fa",
    dir: "rtl",
    heading: "ورکشاپ‌های سفال، شمع و مکرومه",
    text: "در گروه‌های کوچک و صمیمی، کنار هم یاد می‌گیریم و می‌سازیم. تا حالا امتحان نکرده‌اید؟ اشکالی ندارد؛ بیایید، با هم می‌سازیم.",
  },
} as const

/** A Turkish and a Persian heading and paragraph in the theme's look, with the fonts in the form. */
function FontPreview({ theme, fonts }: { theme: ThemeId; fonts: SiteFonts }) {
  const t = useTranslations("appearance.preview")
  const { isDirty } = useFormState<Values>()
  const styles = siteFontStyles(fonts)
  const look = previewLooks[theme]

  return (
    <Panel title={t("title")} description={t("description")}>
      <div className={cn("space-y-6 rounded-lg p-5", look.surface)}>
        {(["latin", "persian"] as const).map((script, i) => {
          const sample = SAMPLES[script]
          const style = styles[script]
          return (
            <div key={script} className={cn("space-y-2", i > 0 && "border-t border-current/15 pt-6")}>
              <p className={cn("text-xs font-medium", look.label)}>{t(script)}</p>
              <div lang={sample.lang} dir={sample.dir} className="space-y-2" style={{ fontFeatureSettings: style.features }}>
                <p
                  style={{ fontFamily: style.heading.family, fontWeight: style.heading.weight }}
                  className={cn("text-[1.7rem] text-balance", script === "latin" ? cn("leading-tight", look.latinHeading) : "leading-snug")}
                >
                  {sample.heading}
                </p>
                <p
                  style={{ fontFamily: style.body.family, fontWeight: style.body.weight }}
                  className={cn("text-[0.95rem] text-pretty", script === "latin" ? "leading-relaxed" : "leading-[1.9]", look.text)}
                >
                  {sample.text}
                </p>
              </div>
            </div>
          )
        })}
      </div>
      {isDirty && <p className="text-warning text-xs font-medium">{t("unsaved")}</p>}
    </Panel>
  )
}
