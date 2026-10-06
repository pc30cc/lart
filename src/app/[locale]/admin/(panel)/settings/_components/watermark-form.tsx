"use client"

import { ImageOffIcon, TriangleAlertIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { useEffect, useId, useState } from "react"
import { useWatch } from "react-hook-form"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"

import { Form, FormActions, FormField, SubmitButton } from "@/components/admin/form/form"
import { useActionForm } from "@/components/admin/form/use-action-form"
import { ImageUpload } from "@/components/admin/upload"
import { Spinner } from "@/components/ui/spinner"
import { saveWatermarkSettings } from "@/features/settings/actions"
import {
  watermarkPositions,
  watermarkRange,
  watermarkSettingsSchema,
  type WatermarkPosition,
  type WatermarkSettingsValues,
} from "@/features/settings/schema"
import { formatPercent } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Panel } from "./fields"

type Saved = WatermarkSettingsValues & { logoUrl: string | null }
type Values = WatermarkSettingsValues

/** Watermark options with a live preview on a sample photo. */
export function WatermarkSettingsForm({ saved }: { saved: Saved }) {
  const t = useTranslations("settings.watermark")
  const ts = useTranslations("settings")
  const tc = useTranslations("common")
  const locale = useLocale()
  const { logoUrl, ...values } = saved

  const { form, submit, pending } = useActionForm({
    schema: watermarkSettingsSchema,
    action: saveWatermarkSettings,
    defaultValues: values,
    successMessage: ts("toast.saved"),
    onSuccess: () => form.reset(form.getValues()),
  })
  const logoPath = useWatch({ control: form.control, name: "logoPath" })
  const percent = (fraction: number) => formatPercent(fraction, locale, 1)

  return (
    <Form form={form} onSubmit={submit}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start">
        <div className="min-w-0 space-y-6">
          <Panel title={t("logoTitle")} description={t("logoDescription")}>
            <FormField<Values> name="logoPath" label={t("logo")}>
              {({ value, onChange, ...field }) => (
                <ImageUpload
                  {...field}
                  purpose="watermark_logo"
                  value={value as string | null}
                  onChange={(path) => onChange(path)}
                  previewUrl={value && value === saved.logoPath ? logoUrl : null}
                />
              )}
            </FormField>
            {/* Gallery photo uploads are refused (watermark_missing) until a logo is saved. */}
            {!logoPath && (
              <p className="text-warning flex items-start gap-2 text-sm">
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
                {t("noLogo")}
              </p>
            )}
          </Panel>

          <Panel title={t("placementTitle")} description={t("placementDescription")}>
            <FormField<Values> name="position" label={t("position")}>
              {(field) => (
                <PositionPicker
                  id={field.id}
                  value={field.value as WatermarkPosition}
                  onChange={(v) => {
                    field.onChange(v)
                    field.onBlur()
                  }}
                />
              )}
            </FormField>
            <RangeField name="sizePct" label={t("size")} hint={t("sizeHint")} format={(v) => percent(v / 100)} />
            <RangeField name="opacity" label={t("opacity")} hint={t("opacityHint")} format={percent} />
            <RangeField name="marginPct" label={t("margin")} hint={t("marginHint")} format={(v) => percent(v / 100)} />
          </Panel>
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

/** Nine positions on a little photo frame (laid out physically, also in RTL), or tiled. */
function PositionPicker({ id, value, onChange }: { id: string; value: WatermarkPosition; onChange: (v: WatermarkPosition) => void }) {
  const t = useTranslations("settings.watermark")
  const grid = watermarkPositions.filter((p) => p !== "tiled")
  const item =
    "focus-visible:ring-ring/50 outline-none transition-all focus-visible:ring-3 cursor-pointer disabled:cursor-not-allowed"

  return (
    <RadioGroupPrimitive.Root
      id={id}
      value={value}
      onValueChange={(v) => onChange(v as WatermarkPosition)}
      aria-label={t("position")}
      dir="ltr"
      // `dir="ltr"` keeps the grid physical; in RTL the row still sits at the start (right), under its label.
      className="flex flex-wrap items-stretch gap-3 rtl:justify-end"
    >
      <div className="bg-muted/60 grid aspect-[3/2] w-48 grid-cols-3 grid-rows-3 gap-1 rounded-xl border p-1.5">
        {grid.map((p) => (
          <RadioGroupPrimitive.Item
            key={p}
            value={p}
            aria-label={t(`positions.${p}`)}
            title={t(`positions.${p}`)}
            className={cn(item, "group/pos hover:bg-background/70 data-checked:bg-background flex items-center justify-center rounded-md data-checked:shadow-xs")}
          >
            <span className="bg-muted-foreground/30 group-hover/pos:bg-muted-foreground/50 group-data-[state=checked]/pos:bg-primary size-2 rounded-full transition-all group-data-[state=checked]/pos:size-3.5" />
          </RadioGroupPrimitive.Item>
        ))}
      </div>
      <RadioGroupPrimitive.Item
        value="tiled"
        className={cn(
          item,
          "group/pos hover:bg-muted/50 data-checked:border-primary data-checked:bg-primary/5 flex w-36 flex-col items-center justify-center gap-2.5 rounded-xl border p-3 text-sm font-medium",
        )}
      >
        <span aria-hidden className="grid grid-cols-3 gap-1.5">
          {Array.from({ length: 9 }, (_, i) => (
            <span key={i} className="bg-muted-foreground/40 group-data-[state=checked]/pos:bg-primary size-1.5 rounded-full" />
          ))}
        </span>
        <span dir="auto">{t("positions.tiled")}</span>
      </RadioGroupPrimitive.Item>
    </RadioGroupPrimitive.Root>
  )
}

function RangeField({
  name,
  label,
  hint,
  format,
}: {
  name: keyof typeof watermarkRange
  label: string
  hint: string
  format: (value: number) => string
}) {
  const { min, max, step } = watermarkRange[name]
  return (
    <FormField<Values> name={name} label={label} description={hint}>
      {({ value, onChange, ...field }) => (
        <div className="flex items-center gap-4">
          <input
            {...field}
            ref={field.ref}
            type="range"
            min={min}
            max={max}
            step={step}
            value={Number(value)}
            onChange={(e) => onChange(Number(e.target.value))}
            className="accent-primary h-2 w-full cursor-pointer"
          />
          <output htmlFor={field.id} className="w-14 shrink-0 text-end text-sm font-medium tabular-nums">
            {format(Number(value))}
          </output>
        </div>
      )}
    </FormField>
  )
}

/** The admin-only preview route renders the sample photo with the current (unsaved) values. */
function Preview() {
  const t = useTranslations("settings.watermark")
  const id = useId()
  const [position, sizePct, opacity, marginPct, logoPath] = useWatch<Values>({
    name: ["position", "sizePct", "opacity", "marginPct", "logoPath"],
  }) as [WatermarkPosition, number, number, number, string | null]

  const query = logoPath
    ? new URLSearchParams({
        position,
        sizePct: String(sizePct),
        opacity: String(opacity),
        marginPct: String(marginPct),
        logo: logoPath,
      }).toString()
    : null
  const src = useDebounced(query ? `/api/admin/media/watermark-preview?${query}` : null, 250)
  const [loaded, setLoaded] = useState<string | null>(null)
  const loading = Boolean(src) && src !== loaded

  return (
    <figure className="bg-card ring-foreground/8 space-y-3 rounded-xl p-3 shadow-xs ring-1">
      <div className="bg-muted relative aspect-[3/2] overflow-hidden rounded-lg">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- generated on the fly by an admin-only route
          <img
            src={src}
            alt={t("previewAlt")}
            aria-describedby={id}
            onLoad={() => setLoaded(src)}
            onError={() => setLoaded(src)}
            className={cn("size-full object-cover transition-opacity duration-300", loading && "opacity-60")}
          />
        ) : (
          <div className="text-muted-foreground flex size-full flex-col items-center justify-center gap-2 p-6 text-center text-sm">
            <ImageOffIcon className="size-6" />
            {t("previewNoLogo")}
          </div>
        )}
        {loading && (
          <span className="bg-background/80 absolute end-2 top-2 flex size-7 items-center justify-center rounded-full shadow-xs">
            <Spinner aria-hidden className="size-3.5" />
          </span>
        )}
      </div>
      <figcaption id={id} className="text-muted-foreground px-1 pb-1 text-xs text-pretty">
        {t("previewCaption")}
      </figcaption>
    </figure>
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
