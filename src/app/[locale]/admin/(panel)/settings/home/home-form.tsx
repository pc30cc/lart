"use client"

import { ClapperboardIcon, EyeOffIcon, ImagesIcon, InfoIcon, LayoutTemplateIcon, PaletteIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useCallback, useState } from "react"
import { useFieldArray, useFormState, useWatch } from "react-hook-form"

import { Form, FormActions, FormField, FormSection, SubmitButton, TextField } from "@/components/admin/form/form"
import { LocalizedInput, LocalizedTextarea } from "@/components/admin/form/localized-input"
import { useActionForm } from "@/components/admin/form/use-action-form"
import { ImageUpload, MediaGrid, VideoUpload, type MediaItem } from "@/components/admin/upload"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import type { LocalizedText } from "@/db/schema"
import { saveHomeSettings } from "@/features/site/home-actions"
import {
  HERO_IMAGES_MAX,
  ABOUT_PAGE_TEXT_MAX,
  HOME_LONG_TEXT_MAX,
  HOME_STEPS_MAX,
  HOME_TEXT_MAX,
  heroMediaChoices,
  homeFormSchema,
  homeSettingsSchema,
  type HeroMediaChoice,
  type HomeDefaults,
  type HomeFormInput,
  type HomeSettingsValues,
} from "@/features/site/home-schema"
import { Link } from "@/i18n/navigation"
import { ChoiceCards } from "../_components/fields"

type Values = HomeFormInput
type Section = "story" | "crafts" | "past" | "steps"
/** A file's URL, also for files uploaded since the page was loaded. */
type Urls = { urlOf: (path: string | null | undefined) => string | null; remember: (path: string, url: string) => void }

const mediaIcons = { theme: LayoutTemplateIcon, images: ImagesIcon, video: ClapperboardIcon } satisfies Record<HeroMediaChoice, unknown>
/** A short clip loads fast: what the video's hint suggests, in seconds. */
const CLIP_SECONDS = { min: 10, max: 30 }

const all = (text: LocalizedText | undefined) => ({ fa: text?.fa ?? "", tr: text?.tr ?? "", en: text?.en ?? "" })
const emptyStep = () => ({ title: all({}), text: all({}) })

/**
 * The form's values from the saved setting and its version: every language
 * present, and four steps when none are saved.
 */
function initialValues(home: HomeSettingsValues, version: string): Values {
  return {
    version,
    hero: { ...home.hero, title: all(home.hero.title), subtitle: all(home.hero.subtitle), button: all(home.hero.button) },
    story: { ...home.story, title: all(home.story.title), text: all(home.story.text), button: all(home.story.button) },
    crafts: { ...home.crafts, title: all(home.crafts.title) },
    past: { ...home.past, title: all(home.past.title) },
    steps: {
      ...home.steps,
      title: all(home.steps.title),
      items: home.steps.items.length
        ? home.steps.items.map((item) => ({ title: all(item.title), text: all(item.text) }))
        : Array.from({ length: HOME_STEPS_MAX }, emptyStep),
    },
    footer: { ...home.footer, about: all(home.footer.about) },
    aboutPage: { text: all(home.aboutPage.text) },
  }
}

/**
 * Settings → Home page: the hero's background (the theme's photos, the
 * admin's photos or a video) and texts, the sections that can be hidden with
 * their texts and photos, and the footer. Empty fields show the theme's own
 * text as their placeholder, in each language.
 */
export function HomeSettingsForm({
  saved,
  version,
  urls,
  defaults,
  classic,
}: {
  saved: HomeSettingsValues
  /** The saved setting's version, sent back with the form (a save made since then refuses this one). */
  version: string
  /** URLs of the saved files. */
  urls: Record<string, string | null>
  defaults: HomeDefaults
  /** The active theme is the classic one, which shows only the tagline and the workshops. */
  classic: boolean
}) {
  const t = useTranslations("homeEditor")
  const ts = useTranslations("settings")
  const tc = useTranslations("common")
  const [uploaded, setUploaded] = useState<Record<string, string>>({})
  const media: Urls = {
    urlOf: (path) => (path ? (uploaded[path] ?? urls[path] ?? null) : null),
    remember: useCallback((path: string, url: string) => setUploaded((known) => ({ ...known, [path]: url })), []),
  }

  const { form, submit, pending } = useActionForm({
    schema: homeFormSchema,
    action: saveHomeSettings,
    defaultValues: initialValues(saved, version),
    successMessage: ts("toast.saved"),
    // What was saved, as the server stores it (e.g. an Instagram link without "?igsh=…"), and its new version.
    onSuccess: (data) => form.reset(initialValues(homeSettingsSchema.parse(form.getValues()), data.version)),
  })
  const background = useWatch({ control: form.control, name: "hero.media" }) as HeroMediaChoice
  const dirty = form.formState.isDirty

  return (
    <Form form={form} onSubmit={submit}>
      <div className="max-w-3xl space-y-3">
        <p className="text-muted-foreground text-sm text-pretty">{t("intro")}</p>
        {classic && (
          <div className="border-info/25 bg-info/5 flex flex-col gap-3 rounded-lg border p-3 text-sm sm:flex-row sm:items-center">
            <p className="flex flex-1 gap-2.5 text-pretty">
              <InfoIcon className="text-info mt-0.5 size-4 shrink-0" aria-hidden />
              {t("classicNote")}
            </p>
            <Button asChild variant="outline" size="sm" className="self-start sm:self-auto">
              <Link href="/admin/settings/appearance">
                <PaletteIcon />
                {t("chooseTheme")}
              </Link>
            </Button>
          </div>
        )}
      </div>

      <FormSection title={t("hero.title")} description={t("hero.description")}>
        <FormField<Values> name="hero.media" label={t("hero.background")}>
          {(field) => (
            <ChoiceCards
              id={field.id}
              value={field.value as HeroMediaChoice}
              onChange={(value) => {
                field.onChange(value)
                field.onBlur()
                form.clearErrors(["hero.images", "hero.video"])
              }}
              describedBy={field["aria-describedby"]}
              className="md:grid-cols-1 xl:grid-cols-3"
              choices={heroMediaChoices.map((choice) => ({
                value: choice,
                title: t(`hero.media.${choice}.title`),
                description: t(`hero.media.${choice}.hint`, { max: HERO_IMAGES_MAX }),
                icon: mediaIcons[choice],
              }))}
            />
          )}
        </FormField>

        {background === "images" && <HeroPhotos media={media} />}

        {background === "video" && (
          <div className="animate-in fade-in-0 space-y-6 duration-200">
            <FormField<Values> name="hero.video" label={t("hero.video")} description={t("hero.videoHint", CLIP_SECONDS)}>
              {({ value, onChange, ...field }) => (
                <VideoUpload
                  {...field}
                  purpose="site_video"
                  value={(value as string) || null}
                  onChange={(path, result) => {
                    if (path && result) media.remember(path, result.url)
                    onChange(path ?? "")
                  }}
                  previewUrl={media.urlOf(value as string)}
                />
              )}
            </FormField>
            <PhotoField name="hero.poster" label={t("hero.poster")} description={t("hero.posterHint")} media={media} />
          </div>
        )}

        <LocalizedInput name="hero.title" label={t("hero.heading")} placeholder={defaults.hero.title} maxLength={HOME_TEXT_MAX} />
        <LocalizedTextarea
          name="hero.subtitle"
          label={t("hero.subtitle")}
          placeholder={defaults.hero.subtitle}
          maxLength={HOME_TEXT_MAX}
          rows={2}
        />
        <LocalizedInput
          name="hero.button"
          label={t("hero.button")}
          description={t("hero.buttonHint")}
          placeholder={defaults.hero.button}
          maxLength={HOME_TEXT_MAX}
        />
      </FormSection>

      <FormSection title={t("story.title")} description={t("story.description")}>
        <ShowSwitch section="story" title={t("story.title")} />
        <Hideable section="story">
          <LocalizedInput name="story.title" label={t("story.heading")} placeholder={defaults.story.title} maxLength={HOME_TEXT_MAX} />
          <LocalizedTextarea
            name="story.text"
            label={t("story.text")}
            description={t("story.textHint", { max: HOME_LONG_TEXT_MAX })}
            placeholder={defaults.story.text}
            maxLength={HOME_LONG_TEXT_MAX}
            rows={5}
          />
          <LocalizedInput name="story.button" label={t("story.button")} placeholder={defaults.story.button} maxLength={HOME_TEXT_MAX} />
          <PhotoField name="story.image" label={t("story.photo")} media={media} />
        </Hideable>
      </FormSection>

      <FormSection title={t("crafts.title")} description={t("crafts.description")}>
        <ShowSwitch section="crafts" title={t("crafts.title")} />
        <Hideable section="crafts">
          <LocalizedInput name="crafts.title" label={t("crafts.heading")} placeholder={defaults.crafts.title} maxLength={HOME_TEXT_MAX} />
          <PhotoField name="crafts.image" label={t("crafts.photo")} media={media} />
        </Hideable>
      </FormSection>

      <FormSection title={t("past.title")} description={t("past.description")}>
        <ShowSwitch section="past" title={t("past.title")} />
        <Hideable section="past">
          <LocalizedInput name="past.title" label={t("past.heading")} placeholder={defaults.past.title} maxLength={HOME_TEXT_MAX} />
        </Hideable>
      </FormSection>

      <FormSection title={t("steps.title")} description={t("steps.description", { max: HOME_STEPS_MAX })}>
        <ShowSwitch section="steps" title={t("steps.title")} />
        <Hideable section="steps">
          <LocalizedInput name="steps.title" label={t("steps.heading")} placeholder={defaults.steps.title} maxLength={HOME_TEXT_MAX} />
          <Steps defaults={defaults.steps.items} />
          <PhotoField name="steps.image" label={t("steps.photo")} media={media} />
        </Hideable>
      </FormSection>

      <FormSection title={t("footer.title")} description={t("footer.description")}>
        <LocalizedTextarea
          name="footer.about"
          label={t("footer.about")}
          placeholder={defaults.footer.about}
          maxLength={HOME_LONG_TEXT_MAX}
          rows={3}
        />
        <TextField<Values>
          name="footer.instagram"
          label={t("footer.instagram")}
          description={t("footer.instagramHint")}
          type="url"
          inputMode="url"
          dir="ltr"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={200}
          placeholder="https://instagram.com/…"
        />
        <div className="grid gap-6 sm:grid-cols-2">
          <TextField<Values>
            name="footer.email"
            label={t("footer.email")}
            type="email"
            dir="ltr"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={254}
            placeholder="hello@example.com"
          />
          <TextField<Values>
            name="footer.phone"
            label={t("footer.phone")}
            description={t("footer.phoneHint")}
            type="tel"
            inputMode="tel"
            dir="ltr"
            autoComplete="off"
            maxLength={40}
            placeholder="+90 555 123 45 67"
          />
        </div>
      </FormSection>

      <FormSection title={t("aboutPage.title")} description={t("aboutPage.description")}>
        <LocalizedTextarea
          name="aboutPage.text"
          label={t("aboutPage.text")}
          description={t("aboutPage.textHint", { max: ABOUT_PAGE_TEXT_MAX })}
          placeholder={defaults.footer.about}
          maxLength={ABOUT_PAGE_TEXT_MAX}
          rows={12}
        />
      </FormSection>

      <FormActions className="bg-background/85 supports-backdrop-filter:backdrop-blur-md sticky bottom-0 z-10 -mx-4 px-4 pb-4 md:-mx-8 md:px-8">
        {dirty && <p className="text-muted-foreground me-auto text-sm">{t("unsaved")}</p>}
        <SubmitButton pending={pending} disabled={!dirty}>
          {tc("actions.saveChanges")}
        </SubmitButton>
      </FormActions>
    </Form>
  )
}

/** "Show on the home page", at the top of a section that can be hidden (`title` names the section for screen readers). */
function ShowSwitch({ section, title }: { section: Section; title: string }) {
  const t = useTranslations("homeEditor")
  return (
    <FormField<Values> name={`${section}.show`}>
      {(field) => (
        <div className="flex items-center justify-between gap-4">
          <label htmlFor={field.id} className="cursor-pointer text-sm font-medium">
            {t("show")}
            <span className="sr-only">: {title}</span>
          </label>
          <Switch
            id={field.id}
            ref={field.ref}
            checked={Boolean(field.value)}
            aria-describedby={field["aria-describedby"]}
            onCheckedChange={(checked) => {
              field.onChange(checked)
              field.onBlur()
            }}
          />
        </div>
      )}
    </FormField>
  )
}

/** A section's fields while it is shown (or while one of them has an error); a short note while it is hidden. */
function Hideable({ section, children }: { section: Section; children: React.ReactNode }) {
  const t = useTranslations("homeEditor")
  const shown = useWatch<Values>({ name: `${section}.show` })
  const { errors } = useFormState<Values>({ name: section })
  if (!shown && !errors[section]) {
    return (
      <p className="text-muted-foreground animate-in fade-in-0 flex items-center gap-2 text-sm duration-200">
        <EyeOffIcon className="size-4 shrink-0" aria-hidden />
        {t("hidden")}
      </p>
    )
  }
  return <div className="animate-in fade-in-0 space-y-6 duration-200">{children}</div>
}

/** One photo of the home page (purpose site_image); empty uses the theme's own. */
function PhotoField({
  name,
  label,
  description,
  media,
}: {
  name: "hero.poster" | "story.image" | "crafts.image" | "steps.image"
  label: string
  description?: string
  media: Urls
}) {
  const t = useTranslations("homeEditor")
  return (
    <FormField<Values> name={name} label={label} description={description ?? t("photoHint")}>
      {({ value, onChange, ...field }) => (
        <ImageUpload
          {...field}
          purpose="site_image"
          value={(value as string) || null}
          onChange={(path, result) => {
            if (path && result) media.remember(path, result.url)
            onChange(path ?? "")
          }}
          previewUrl={media.urlOf(value as string)}
          className="max-w-md"
        />
      )}
    </FormField>
  )
}

/** The hero's photos, in order (up to six). The field holds their paths. */
function HeroPhotos({ media }: { media: Urls }) {
  const t = useTranslations("homeEditor")
  return (
    <FormField<Values> name="hero.images" label={t("hero.photos")} description={t("hero.photosHint")} className="animate-in fade-in-0 duration-200">
      {(field) => {
        const items: MediaItem[] = ((field.value as string[]) ?? []).map((path) => ({ path, url: media.urlOf(path) ?? "", kind: "image" }))
        return (
          <MediaGrid
            value={items}
            onChange={(next) => {
              for (const item of next) media.remember(item.path, item.url)
              field.onChange(next.map((item) => item.path))
              field.onBlur()
            }}
            imagePurpose="site_image"
            allowVideos={false}
            max={HERO_IMAGES_MAX}
          />
        )
      }}
    </FormField>
  )
}

/** Up to four steps, each a title and a short text; the placeholders are the theme's steps. */
function Steps({ defaults }: { defaults: HomeDefaults["steps"]["items"] }) {
  const t = useTranslations("homeEditor")
  const { fields, append, remove } = useFieldArray<Values, "steps.items">({ name: "steps.items" })
  return (
    <div className="space-y-4">
      <ol className="space-y-4">
        {fields.map((step, i) => (
          <li key={step.id} className="bg-muted/30 space-y-4 rounded-lg border p-4">
            <div className="flex min-h-7 items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{t("steps.step", { n: i + 1 })}</h3>
              {fields.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => remove(i)}
                  aria-label={t("steps.remove", { n: i + 1 })}
                  title={t("steps.remove", { n: i + 1 })}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2Icon />
                </Button>
              )}
            </div>
            <LocalizedInput
              name={`steps.items.${i}.title`}
              label={t("steps.stepTitle")}
              placeholder={defaults[i]?.title}
              maxLength={HOME_TEXT_MAX}
            />
            <LocalizedTextarea
              name={`steps.items.${i}.text`}
              label={t("steps.stepText")}
              placeholder={defaults[i]?.text}
              maxLength={HOME_TEXT_MAX}
              rows={2}
            />
          </li>
        ))}
      </ol>
      {fields.length < HOME_STEPS_MAX && (
        <Button type="button" variant="outline" size="sm" onClick={() => append(emptyStep())}>
          <PlusIcon />
          {t("steps.add")}
        </Button>
      )}
    </div>
  )
}
