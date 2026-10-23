"use client"

import { BabyIcon, CalendarPlusIcon, FileSignatureIcon, Link2Icon, LockIcon, TriangleAlertIcon, UsersRoundIcon, XIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { useEffect, useState } from "react"
import { useFormContext, useWatch, type DefaultValues } from "react-hook-form"
import { toast } from "sonner"

import { DateButton, DateTimeFields } from "@/components/admin/form/date-time-fields"
import { Form, FormActions, FormField, FormSection, SubmitButton, TextField } from "@/components/admin/form/form"
import { LocalizedInput, LocalizedTextarea } from "@/components/admin/form/localized-input"
import { MoneyInput } from "@/components/admin/form/money-input"
import { useActionForm } from "@/components/admin/form/use-action-form"
import { TimeTextInput, WholeNumberInput } from "@/components/admin/form/digit-inputs"
import { ImageUpload, MediaGrid, type MediaItem } from "@/components/admin/upload"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from "@/components/ui/field"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { WorkshopStatus } from "@/features/workshops/schema"
import { createWorkshop, updateWorkshop } from "@/features/workshops/actions"
import type { ExtraDay } from "@/features/workshops/days"
import type { WorkshopFormOptions } from "@/features/workshops/queries"
import {
  ageGroups,
  contractCourseFields,
  feeTypes,
  maxAdvance,
  translationsChanged,
  workshopEditSchema,
  workshopSchema,
  type WorkshopFormValues,
} from "@/features/workshops/schema"
import { Link, useRouter } from "@/i18n/navigation"
import { formatDate, formatNumber, localized, slugify, zonedParts } from "@/lib/format"
import { formatLira } from "@/lib/money"
import { cn } from "@/lib/utils"

type Values = WorkshopFormValues

export type WorkshopEdit = {
  id: string
  status: WorkshopStatus
  /** The contract terms can't change any more (`contractLocked` in the workshops schema). */
  contractLocked: boolean
  values: Values
  coverUrl: string | null
  /** Pending + confirmed registrations: the price is locked when > 0. */
  registered: number
  contract: { version: number; status: "sent" | "signed" | "void" } | null
  instructorName: string
}

export function emptyWorkshopValues(): DefaultValues<Values> {
  const text = () => ({ fa: "", tr: "", en: "" })
  return {
    title: text(),
    slug: "",
    categoryId: "",
    instructorId: "",
    startsAt: "",
    endsAt: "",
    extraDays: [],
    registrationDeadline: "",
    decisionAt: "",
    venue: text(),
    ageGroup: "adults",
    ageMin: null,
    ageMax: null,
    minCapacity: undefined,
    maxCapacity: undefined,
    price: undefined,
    termsTemplateId: null,
    intro: text(),
    includes: text(),
    bringNothing: false,
    bring: text(),
    experienceRequired: false,
    experienceNote: text(),
    notes: text(),
    coverPath: null,
    samples: [],
    paymentUrl: "",
    feeType: "per_participant",
    feeAmount: undefined,
    hasAdvance: false,
    advanceAmount: null,
  }
}

/** Stable JSON for comparing form values (object keys sorted). */
const stable = (v: unknown) =>
  JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : x,
  )
const trimmed = (t: Record<string, string | undefined> | undefined) =>
  Object.fromEntries(Object.entries(t ?? {}).flatMap(([k, v]) => (v?.trim() ? [[k, v.trim()]] : [])))

/** The part of the form that appears in the contract, except the translated texts (see `reissues`). */
function contractPart(v: Partial<Values>) {
  const course: Record<string, unknown> = Object.fromEntries(contractCourseFields.flatMap((k) => (k === "title" || k === "venue" ? [] : [[k, v[k]]])))
  // The other days (dates, hours, participants) are in the contract too.
  course.extraDays = [...(v.extraDays ?? [])].sort((a, b) => (a?.date ?? "").localeCompare(b?.date ?? ""))
  return stable({ ...course, feeType: v.feeType, feeAmount: v.feeAmount, advance: v.hasAdvance ? v.advanceAmount : 0 })
}

/** Will saving re-issue the contract? Like the server: filling in a missing translation of the title or venue does not. */
function reissues(before: Partial<Values>, after: Partial<Values>) {
  return (
    contractPart(after) !== contractPart(before) ||
    translationsChanged(trimmed(before.title), trimmed(after.title)) ||
    translationsChanged(trimmed(before.venue), trimmed(after.venue))
  )
}

/**
 * Create (no `workshop`) or edit a workshop and its contract terms, in one friendly form.
 * `onlinePayment`: whether online payment is switched on in Settings → Payments (the link field warns when it is off).
 */
export function WorkshopForm({
  workshop,
  options,
  onlinePayment,
}: {
  workshop?: WorkshopEdit
  options: WorkshopFormOptions
  onlinePayment?: boolean
}) {
  const t = useTranslations("workshops")
  const tc = useTranslations("common")
  const locale = useLocale()
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const editing = Boolean(workshop)

  const { form, submit, pending } = useActionForm({
    schema: editing ? workshopEditSchema : workshopSchema,
    action: (values: Values) => (workshop ? updateWorkshop({ ...values, id: workshop.id }) : createWorkshop(values)),
    defaultValues: workshop?.values ?? emptyWorkshopValues(),
    successMessage: false,
    onSuccess: (data) => {
      const name = instructorName(form.getValues("instructorId"))
      if (!workshop) {
        if (data.emailSent === "pending") toast.success(t("toast.createdSending", { name }))
        else if (data.emailSent) toast.success(t("toast.created", { name }))
        else toast.warning(t("toast.createdNoEmail"))
      } else if (data.contractVersion) {
        const version = formatNumber(data.contractVersion, locale)
        if (data.emailSent === "pending") toast.success(t("toast.reissuedSending", { name, version }))
        else if (data.emailSent) toast.success(t("toast.reissued", { name, version }))
        else toast.warning(t("toast.reissuedNoEmail", { version }))
      } else {
        toast.success(t("toast.updated"))
      }
      router.push(`/admin/workshops/${data.id}`)
    },
  })

  function instructorName(id: string) {
    const person = options.instructors.find((i) => i.id === id)
    return person ? localized(person.displayName, locale) || person.officialName : ""
  }

  // The page address follows the Turkish (or English) title until it is edited by hand.
  const [slugEdited, setSlugEdited] = useState(editing)
  const [tr, en] = useWatch({ control: form.control, name: ["title.tr", "title.en"] })
  useEffect(() => {
    if (slugEdited) return
    form.setValue("slug", slugify(String(tr || en || "")), { shouldValidate: form.formState.isSubmitted })
  }, [tr, en, slugEdited, form])

  // Editing a field that is in the contract re-issues it: warn before saving.
  const watched = useWatch({ control: form.control }) as Partial<Values>

  // The draft that this form kept in the browser for a while is no longer used: remove what is left of it.
  useEffect(() => {
    try {
      window.localStorage.removeItem("limer:new-workshop-draft:v1")
    } catch {
      // Storage blocked: nothing was kept there either.
    }
  }, [])
  const live = workshop?.contract && workshop.contract.status !== "void" ? workshop.contract : null
  const locked = Boolean(workshop?.contractLocked)
  const reissue = Boolean(workshop && !locked && reissues(workshop.values, watched))
  // Uploads go to the workshop's folder: the saved one's, or named after the slug typed so far.
  const uploadTarget = workshop ? { courseId: workshop.id } : { folder: watched.slug }

  // Photos still uploading are not in the form yet: saving now would leave them out.
  const [coverBusy, setCoverBusy] = useState(false)
  const [samplesBusy, setSamplesBusy] = useState(false)

  async function onSubmit(event?: React.BaseSyntheticEvent) {
    event?.preventDefault()
    if (coverBusy || samplesBusy) return void toast.warning(t("form.photosUploading"))
    if (reissue && (await form.trigger())) setConfirming(true)
    else await submit()
  }

  return (
    <Form form={form} onSubmit={onSubmit}>
      {locked && (
        <Notice icon={LockIcon} title={t("form.lockedTitle")}>
          {t("form.lockedDescription")}
        </Notice>
      )}

      <FormSection title={t("form.basics.title")} description={t("form.basics.description")}>
        <LocalizedInput
          name="title"
          label={<ContractLabel>{t("fields.title")}</ContractLabel>}
          required={["fa", "tr", "en"]}
          maxLength={120}
          placeholder={t("fields.titlePlaceholder")}
        />
        <div className="grid gap-6 sm:grid-cols-2">
          <SelectField
            name="categoryId"
            label={t("fields.category")}
            placeholder={t("fields.categoryPlaceholder")}
            options={options.categories.map((c) => ({ value: c.id, label: localized(c.name, locale) }))}
          />
          <SelectField
            name="instructorId"
            label={<ContractLabel>{t("fields.instructor")}</ContractLabel>}
            placeholder={t("fields.instructorPlaceholder")}
            description={t("fields.instructorHint")}
            options={options.instructors.map((i) => ({
              value: i.id,
              label: localized(i.displayName, locale) || i.officialName,
              hint: i.officialName,
            }))}
          />
        </div>
        <TextField<Values>
          name="slug"
          label={t("fields.slug")}
          description={t("fields.slugHint")}
          required
          dir="ltr"
          autoComplete="off"
          spellCheck={false}
          maxLength={80}
          className="[&_input]:font-mono [&_input]:text-sm"
          onInput={() => setSlugEdited(true)}
        />
      </FormSection>

      <FormSection title={t("form.when.title")} description={t("form.when.description")}>
        <DateTimeFields
          label={<ContractLabel>{t("fields.dateTime")}</ContractLabel>}
          startName="startsAt"
          endName="endsAt"
          required
        />
        <ExtraDaysField />
        <DateTimeFields
          label={t("fields.registrationDeadline")}
          description={t("fields.registrationDeadlineHint")}
          startName="registrationDeadline"
          required
        />
        <DateTimeFields
          label={<ContractLabel>{t("fields.decisionAt")}</ContractLabel>}
          description={t("fields.decisionAtHint")}
          startName="decisionAt"
          required
        />
      </FormSection>

      <FormSection title={t("form.where.title")} description={t("form.where.description")}>
        <LocalizedInput
          name="venue"
          label={<ContractLabel>{t("fields.venue")}</ContractLabel>}
          description={t("fields.venueHint")}
          placeholder={t("fields.venuePlaceholder")}
          required={["tr"]}
          maxLength={300}
        />
        <AgeGroupField />
        <div className="grid gap-6 sm:grid-cols-2">
          <NumberField name="minCapacity" label={<ContractLabel>{t("fields.minCapacity")}</ContractLabel>} max={500} />
          <NumberField name="maxCapacity" label={<ContractLabel>{t("fields.maxCapacity")}</ContractLabel>} max={500} />
        </div>
      </FormSection>

      <FormSection title={t("form.price.title")} description={t("form.price.description")}>
        <FormField<Values>
          name="price"
          label={t("fields.price")}
          required
          description={workshop && workshop.registered > 0 ? t("fields.priceLocked", { count: workshop.registered }) : t("fields.priceHint")}
        >
          {(field) => (
            <MoneyInput {...field} disabled={Boolean(workshop && workshop.registered > 0)} className="max-w-48" />
          )}
        </FormField>
        <FormField<Values> name="termsTemplateId" label={t("fields.terms")} description={t("fields.termsHint")}>
          {(field) => (
            <Select
              value={(field.value as string | null) ?? "default"}
              onValueChange={(v) => {
                if (!v) return // see SelectField
                field.onChange(v === "default" ? null : v)
                field.onBlur()
              }}
            >
              <SelectTrigger id={field.id} ref={field.ref} aria-invalid={field["aria-invalid"]} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">{t("fields.termsDefault")}</SelectItem>
                {options.termsTemplates
                  .filter((tpl) => !tpl.isDefault)
                  .map((tpl) => (
                    <SelectItem key={tpl.id} value={tpl.id}>
                      {tpl.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
        <PaymentLinkField onlinePayment={onlinePayment} />
      </FormSection>

      <FormSection title={t("form.about.title")} description={t("form.about.description")}>
        <LocalizedTextarea name="intro" label={t("fields.intro")} placeholder={t("fields.introPlaceholder")} maxLength={2000} />
        <LocalizedTextarea
          name="includes"
          label={t("fields.includes")}
          placeholder={t("fields.includesPlaceholder")}
          maxLength={1000}
          rows={3}
        />
        <BringField />
        <ExperienceField />
        <LocalizedTextarea
          name="notes"
          label={t("fields.notes")}
          description={t("fields.notesHint")}
          maxLength={2000}
          rows={3}
        />
      </FormSection>

      <FormSection title={t("form.photos.title")} description={t("form.photos.description")}>
        <FormField<Values> name="coverPath" label={t("fields.cover")} description={t("fields.coverHint")}>
          {(field) => (
            <ImageUpload
              purpose="course_cover"
              onBusyChange={setCoverBusy}
              {...field}
              value={field.value as string | null}
              onChange={(path) => field.onChange(path)}
              previewUrl={workshop?.coverUrl}
              target={uploadTarget}
            />
          )}
        </FormField>
        <FormField<Values> name="samples" label={t("fields.samples")} description={t("fields.samplesHint")}>
          {(field) => (
            <MediaGrid
              value={(field.value as MediaItem[]) ?? []}
              onChange={field.onChange}
              imagePurpose="course_sample"
              onBusyChange={setSamplesBusy}
              allowVideos={false}
              target={uploadTarget}
              max={12}
            />
          )}
        </FormField>
      </FormSection>

      <FormSection
        title={t("form.contract.title")}
        description={
          <>
            {t("form.contract.description")}{" "}
            <span className="text-foreground/80 inline-flex items-center gap-1">
              <Link2Icon className="text-primary size-3.5" aria-hidden /> {t("form.contract.markHint")}
            </span>
          </>
        }
      >
        <ContractFields />
      </FormSection>

      {reissue && live && (
        <Notice icon={TriangleAlertIcon} tone="warning" title={t("form.reissue.title")}>
          {t(`form.reissue.${live.status === "signed" ? "signed" : "sent"}`, { version: formatNumber(live.version, locale) })}
        </Notice>
      )}

      <FormActions className="bg-background/85 supports-backdrop-filter:backdrop-blur-md sticky bottom-0 z-10 -mx-4 px-4 pb-4 md:static md:mx-0 md:bg-transparent md:px-0 md:pb-0 md:backdrop-blur-none">
        <Button variant="ghost" size="lg" asChild>
          <Link href={workshop ? `/admin/workshops/${workshop.id}` : "/admin/workshops"}>{tc("actions.cancel")}</Link>
        </Button>
        <SubmitButton pending={pending}>
          {workshop ? tc("actions.saveChanges") : (
            <>
              <FileSignatureIcon />
              {t("form.createAndSend")}
            </>
          )}
        </SubmitButton>
      </FormActions>

      <AlertDialog open={confirming} onOpenChange={(open) => !pending && setConfirming(open)}>
        <AlertDialogContent>
          <AlertDialogHeader className="sm:group-data-[size=default]/alert-dialog-content:text-start">
            <AlertDialogTitle>{t("form.reissue.confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("form.reissue.confirmDescription", {
                version: formatNumber((workshop?.contract?.version ?? 0) + 1, locale),
                name: instructorName(watched.instructorId ?? "") || (workshop?.instructorName ?? ""),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
            <Button
              onClick={() => {
                setConfirming(false)
                void submit()
              }}
            >
              {t("form.reissue.confirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Form>
  )
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

/** A label with the "also in the contract" mark. */
function ContractLabel({ children }: { children: React.ReactNode }) {
  const t = useTranslations("workshops.form.contract")
  return (
    <span className="inline-flex items-center gap-1.5">
      {children}
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-primary inline-flex" tabIndex={0} aria-label={t("mark")}>
            <Link2Icon className="size-3.5" aria-hidden />
          </span>
        </TooltipTrigger>
        <TooltipContent>{t("mark")}</TooltipContent>
      </Tooltip>
    </span>
  )
}

function Notice({
  icon: Icon,
  title,
  tone = "neutral",
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  tone?: "neutral" | "warning"
  children: React.ReactNode
}) {
  return (
    <div
      role={tone === "warning" ? "alert" : undefined}
      className={cn(
        "flex gap-3 rounded-xl border p-4 text-sm",
        tone === "warning" ? "border-warning/30 bg-warning/8" : "bg-muted/50",
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", tone === "warning" ? "text-warning" : "text-muted-foreground")} />
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        <p className="text-muted-foreground text-pretty">{children}</p>
      </div>
    </div>
  )
}

function SelectField({
  name,
  label,
  placeholder,
  description,
  options,
}: {
  name: "categoryId" | "instructorId"
  label: React.ReactNode
  placeholder: string
  description?: string
  options: { value: string; label: string; hint?: string }[]
}) {
  return (
    <FormField<Values> name={name} label={label} description={description} required>
      {(field) => (
        <Select
          value={(field.value as string) || undefined}
          onValueChange={(v) => {
            // Radix can report "" when the value is set from code (a form reset) before its options are
            // rendered; taking it would clear the choice and the form would then refuse to save.
            if (!v) return
            field.onChange(v)
            field.onBlur()
          }}
        >
          <SelectTrigger
            id={field.id}
            ref={field.ref}
            aria-invalid={field["aria-invalid"]}
            aria-describedby={field["aria-describedby"]}
            className="w-full"
          >
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
                {o.hint && o.hint !== o.label && <span className="text-muted-foreground text-xs">{o.hint}</span>}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </FormField>
  )
}

/** A whole-number input whose form value is a number, or null when empty. */
function NumberField({
  name,
  label,
  min = 1,
  max,
  className,
}: {
  name: "minCapacity" | "maxCapacity" | "ageMin" | "ageMax"
  label: React.ReactNode
  min?: number
  max: number
  className?: string
}) {
  return (
    <FormField<Values> name={name} label={label} required className={className}>
      {({ value, onChange, ...field }) => (
        <WholeNumberInput {...field} ref={field.ref} aria-valuemin={min} aria-valuemax={max} className="max-w-32" value={value} onChange={onChange} />
      )}
    </FormField>
  )
}

function ChoiceCards<V extends string>({
  id,
  value,
  onChange,
  choices,
  describedBy,
}: {
  id: string
  value: V
  onChange: (value: V) => void
  choices: { value: V; title: string; description: string; icon?: React.ComponentType<{ className?: string }> }[]
  describedBy?: string
}) {
  return (
    <RadioGroup
      id={id}
      value={value}
      onValueChange={(v) => onChange(v as V)}
      aria-describedby={describedBy}
      className="grid gap-3 sm:grid-cols-2"
    >
      {choices.map((choice) => (
        <FieldLabel key={choice.value} htmlFor={`${id}-${choice.value}`} className="cursor-pointer">
          <Field orientation="horizontal">
            {choice.icon && <choice.icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />}
            <FieldContent>
              <FieldTitle>{choice.title}</FieldTitle>
              <FieldDescription className="text-start">{choice.description}</FieldDescription>
            </FieldContent>
            <RadioGroupItem value={choice.value} id={`${id}-${choice.value}`} />
          </Field>
        </FieldLabel>
      ))}
    </RadioGroup>
  )
}

function AgeGroupField() {
  const t = useTranslations("workshops.fields")
  const { control, setValue, clearErrors } = useFormContext<Values>()
  const group = useWatch({ control, name: "ageGroup" })
  return (
    <div className="space-y-4">
      <FormField<Values> name="ageGroup" label={t("ageGroup")} required>
        {(field) => (
          <ChoiceCards
            id={field.id}
            value={field.value as (typeof ageGroups)[number]}
            onChange={(value) => {
              field.onChange(value)
              // Hidden ages would still be checked, and block saving without a field to show it on.
              if (value !== "children") {
                setValue("ageMin", null)
                setValue("ageMax", null)
                clearErrors(["ageMin", "ageMax"])
              }
            }}
            describedBy={field["aria-describedby"]}
            choices={[
              { value: "adults", title: t("adults"), description: t("adultsHint"), icon: UsersRoundIcon },
              { value: "children", title: t("children"), description: t("childrenHint"), icon: BabyIcon },
            ]}
          />
        )}
      </FormField>
      {group === "children" && (
        <div className="animate-in fade-in-0 slide-in-from-top-1 grid grid-cols-2 gap-6 duration-200 sm:max-w-sm">
          <NumberField name="ageMin" label={t("ageMin")} max={18} />
          <NumberField name="ageMax" label={t("ageMax")} max={18} />
        </div>
      )}
    </div>
  )
}

/** The workshop's own online payment link (not in the contract), with a warning while online payment is off. */
function PaymentLinkField({ onlinePayment }: { onlinePayment?: boolean }) {
  const t = useTranslations("workshops.registrations.paymentLink")
  const { control } = useFormContext<Values>()
  const value = useWatch({ control, name: "paymentUrl" })
  return (
    <div className="space-y-3">
      <TextField<Values>
        name="paymentUrl"
        label={t("label")}
        description={t("hint")}
        type="url"
        inputMode="url"
        dir="ltr"
        autoComplete="off"
        spellCheck={false}
        maxLength={500}
        placeholder="https://iyzi.link/…"
        className="[&_input]:text-sm"
      />
      {onlinePayment === false && (
        <p className="text-warning flex items-start gap-2 text-sm text-pretty">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {value?.trim() ? t("offWarning") : t("offNote")}{" "}
            <Link href="/admin/settings/payments" className="text-foreground font-medium underline underline-offset-4">
              {t("openSettings")}
            </Link>
          </span>
        </p>
      )}
    </div>
  )
}

function SwitchRow({
  name,
  label,
  description,
  onHide,
}: {
  name: "bringNothing" | "experienceRequired" | "hasAdvance"
  label: string
  description?: string
  /** Called with the new state: clear what the switch hides (hidden values are still checked, with no field to show an error on). */
  onHide?: (checked: boolean) => void
}) {
  return (
    <FormField<Values> name={name}>
      {(field) => (
        <label
          htmlFor={field.id}
          className="hover:bg-muted/40 flex cursor-pointer items-center justify-between gap-4 rounded-lg border px-3.5 py-3 transition-colors"
        >
          <span className="space-y-0.5">
            <span className="block text-sm font-medium">{label}</span>
            {description && <span className="text-muted-foreground block text-sm">{description}</span>}
          </span>
          <Switch
            id={field.id}
            ref={field.ref}
            checked={Boolean(field.value)}
            onCheckedChange={(checked) => {
              field.onChange(checked)
              field.onBlur()
              onHide?.(checked)
            }}
          />
        </label>
      )}
    </FormField>
  )
}

function BringField() {
  const t = useTranslations("workshops.fields")
  const { control, setValue, clearErrors } = useFormContext<Values>()
  const nothing = useWatch({ control, name: "bringNothing" })
  return (
    <div className="space-y-3">
      <SwitchRow
        name="bringNothing"
        label={t("bringNothing")}
        description={t("bringNothingHint")}
        onHide={(checked) => {
          if (!checked) return
          setValue("bring", { fa: "", tr: "", en: "" })
          clearErrors("bring")
        }}
      />
      {!nothing && (
        <LocalizedTextarea
          name="bring"
          label={t("bring")}
          placeholder={t("bringPlaceholder")}
          description={t("bringHint")}
          maxLength={500}
          rows={3}
        />
      )}
    </div>
  )
}

function ExperienceField() {
  const t = useTranslations("workshops.fields")
  const { control, setValue, clearErrors } = useFormContext<Values>()
  const required = useWatch({ control, name: "experienceRequired" })
  return (
    <div className="space-y-3">
      <SwitchRow
        name="experienceRequired"
        label={t("experience")}
        description={t("experienceHint")}
        onHide={(checked) => {
          if (checked) return
          setValue("experienceNote", { fa: "", tr: "", en: "" })
          clearErrors("experienceNote")
        }}
      />
      {required && (
        <LocalizedInput
          name="experienceNote"
          label={t("experienceNote")}
          placeholder={t("experienceNotePlaceholder")}
          maxLength={300}
        />
      )}
    </div>
  )
}

function ContractFields() {
  const t = useTranslations("workshops.fields")
  const locale = useLocale()
  const { control, setValue, clearErrors } = useFormContext<Values>()
  const [feeType, feeAmount, maxCapacity, hasAdvance] = useWatch({
    control,
    name: ["feeType", "feeAmount", "maxCapacity", "hasAdvance"],
  })
  const perParticipant = feeType === "per_participant"
  const ready = typeof feeAmount === "number" && Number.isFinite(feeAmount) && (!perParticipant || (maxCapacity ?? 0) > 0)
  const ceiling = ready ? maxAdvance({ feeType, feeAmount, maxCapacity: maxCapacity ?? 0 }) : null

  return (
    <>
      <FormField<Values> name="feeType" label={<ContractLabel>{t("feeType")}</ContractLabel>} required>
        {(field) => (
          <ChoiceCards
            id={field.id}
            value={field.value as (typeof feeTypes)[number]}
            onChange={field.onChange}
            describedBy={field["aria-describedby"]}
            choices={feeTypes.map((type) => ({ value: type, title: t(`feeTypes.${type}`), description: t(`feeTypes.${type}Hint`) }))}
          />
        )}
      </FormField>
      <FormField<Values>
        name="feeAmount"
        label={<ContractLabel>{perParticipant ? t("feeAmountPerParticipant") : t("feeAmountFixed")}</ContractLabel>}
        description={perParticipant && ceiling !== null ? t("feeAtFullCapacity", { amount: formatLira(ceiling, locale) }) : undefined}
        required
      >
        {(field) => <MoneyInput {...field} className="max-w-48" />}
      </FormField>
      <SwitchRow
        name="hasAdvance"
        label={t("hasAdvance")}
        description={t("hasAdvanceHint")}
        onHide={(checked) => {
          if (checked) return
          setValue("advanceAmount", null)
          clearErrors("advanceAmount")
        }}
      />
      {hasAdvance && (
        <FormField<Values>
          name="advanceAmount"
          label={<ContractLabel>{t("advanceAmount")}</ContractLabel>}
          description={ceiling !== null ? t("advanceMax", { amount: formatLira(ceiling, locale) }) : undefined}
          required
          className="animate-in fade-in-0 slide-in-from-top-1 duration-200"
        >
          {(field) => <MoneyInput {...field} className="max-w-48" />}
        </FormField>
      )}
    </>
  )
}

/**
 * A workshop on several days: the other days' dates, each held at the first
 * day's hours ("Add a day" adds the day after the last one).
 */
function ExtraDaysField() {
  const t = useTranslations("workshops")
  const locale = useLocale()
  const { control, getValues, getFieldState, formState } = useFormContext<Values>()
  // A new day starts from the first day's date, hours and participants: filled in first, so no day is
  // added empty, before the first one, or for a single participant.
  const [startsAt, endsAt, minCapacity, maxCapacity] = useWatch({ control, name: ["startsAt", "endsAt", "minCapacity", "maxCapacity"] })
  const firstDayReady = Boolean(startsAt && endsAt) && Number(minCapacity) > 0 && Number(maxCapacity) > 0
  // A day's wrong input is outlined; the message is shown under the list (FormField).
  const wrong = (i: number, key: keyof ExtraDay) => getFieldState(`extraDays.${i}.${key}`, formState).invalid || undefined
  return (
    <FormField<Values> name="extraDays" label={<ContractLabel>{t("fields.extraDays")}</ContractLabel>} description={t("fields.extraDaysHint")}>
      {({ value, onChange, id }) => {
        const days = (value as ExtraDay[] | undefined) ?? []
        const set = (i: number, patch: Partial<ExtraDay>) => onChange(days.map((d, j) => (j === i ? { ...d, ...patch } : d)))
        // A new day: the day after the last one, at its hours and with its participants (the first day's to begin with).
        const next = (): ExtraDay => {
          const last = days[days.length - 1]
          const startsAt = getValues("startsAt") as string | undefined
          const endsAt = getValues("endsAt") as string | undefined
          const first = {
            date: startsAt ? zonedParts(startsAt).date : "",
            start: startsAt ? zonedParts(startsAt).time : "",
            end: endsAt ? zonedParts(endsAt).time : "",
            minCapacity: Number(getValues("minCapacity")) || 1,
            maxCapacity: Number(getValues("maxCapacity")) || 1,
          }
          const base = last ?? first
          const d = base.date ? new Date(`${base.date}T12:00:00Z`) : new Date()
          d.setUTCDate(d.getUTCDate() + 1)
          return { ...base, date: d.toISOString().slice(0, 10) }
        }
        return (
          <div id={id} className="space-y-3">
            {days.map((day, i) => {
              const label = t("fields.dayNumber", { n: i + 2 })
              return (
                <div key={i} className="ring-foreground/10 space-y-3 rounded-xl p-3 ring-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      {label}
                      {/^\d{4}-\d{2}-\d{2}$/.test(day.date) && (
                        <span className="text-muted-foreground font-normal"> · {formatDate(`${day.date}T12:00:00Z`, locale, "full")}</span>
                      )}
                    </span>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={t("fields.removeDay")} onClick={() => onChange(days.filter((_, j) => j !== i))}>
                      <XIcon />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
                    <label className="col-span-2 space-y-1">
                      <span className="text-muted-foreground text-xs">{t("fields.dayDate")}</span>
                      <DateButton value={day.date} invalid={wrong(i, "date")} onChange={(date) => set(i, { date })} className="w-full" />
                    </label>
                    <label className="space-y-1">
                      <span className="text-muted-foreground text-xs">{t("fields.dayStart")}</span>
                      <TimeTextInput value={day.start} aria-invalid={wrong(i, "start")} onChange={(start) => set(i, { start })} />
                    </label>
                    <label className="space-y-1">
                      <span className="text-muted-foreground text-xs">{t("fields.dayEnd")}</span>
                      <TimeTextInput value={day.end} aria-invalid={wrong(i, "end")} onChange={(end) => set(i, { end })} />
                    </label>
                    <label className="space-y-1">
                      <span className="text-muted-foreground text-xs">{t("fields.dayMin")}</span>
                      <WholeNumberInput
                        value={day.minCapacity}
                        aria-invalid={wrong(i, "minCapacity")}
                        onChange={(n) => set(i, { minCapacity: n ?? Number.NaN })}
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-muted-foreground text-xs">{t("fields.dayMax")}</span>
                      <WholeNumberInput
                        value={day.maxCapacity}
                        aria-invalid={wrong(i, "maxCapacity")}
                        onChange={(n) => set(i, { maxCapacity: n ?? Number.NaN })}
                      />
                    </label>
                  </div>
                </div>
              )
            })}
            {days.length < 13 && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Button type="button" variant="outline" size="sm" disabled={!firstDayReady} onClick={() => onChange([...days, next()])}>
                  <CalendarPlusIcon />
                  {t("fields.addDay")}
                </Button>
                {!firstDayReady && <span className="text-muted-foreground text-xs">{t("fields.addDayFirst")}</span>}
              </div>
            )}
          </div>
        )
      }}
    </FormField>
  )
}
