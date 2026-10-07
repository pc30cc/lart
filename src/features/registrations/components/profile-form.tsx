"use client"

import { RadioGroup as RadioGroupPrimitive } from "radix-ui"
import { useLocale, useTranslations } from "next-intl"
import { toast } from "sonner"

import { Form, FormField } from "@/components/admin/form/form"
import { BigSubmit, BigTextField, FormAlert } from "@/components/site/auth/fields"
import { useSiteForm } from "@/components/site/auth/use-site-form"
import { usePathname, useRouter } from "@/i18n/navigation"
import { locales, type AppLocale } from "@/i18n/routing"
import { cn } from "@/lib/utils"
import { saveProfileAction } from "../actions"
import { profileSchema } from "../schema"

/**
 * "My details": name, mobile number and the language of our emails. Choosing
 * another language also shows the site in it (as the header's switch does).
 */
export function ProfileForm({ name, phone, locale }: { name: string; phone: string | null; locale: AppLocale }) {
  const t = useTranslations("registration.account")
  const tc = useTranslations("common")
  const pageLocale = useLocale()
  const pathname = usePathname()
  const router = useRouter()
  const { form, submit, pending, error } = useSiteForm({
    schema: profileSchema,
    action: saveProfileAction,
    defaultValues: { name, phone: phone ?? "", locale },
    onSuccess: () => {
      toast.success(t("saved"))
      const chosen = form.getValues("locale")
      if (chosen !== pageLocale) router.replace(pathname, { locale: chosen, scroll: false })
    },
  })

  return (
    <Form form={form} onSubmit={submit} className="space-y-5">
      <BigTextField name="name" label={t("name")} autoComplete="name" maxLength={80} />
      <BigTextField
        name="phone"
        label={
          <>
            {t("phone")} <span className="text-muted-foreground font-normal">({t("optional")})</span>
          </>
        }
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        dir="ltr"
        maxLength={40}
      />
      <FormField name="locale" label={t("language")} className="[&_label]:text-base">
        {({ id, value, onChange, ref, ...aria }) => (
          <RadioGroupPrimitive.Root
            id={id}
            ref={ref}
            value={value as string}
            onValueChange={onChange}
            aria-invalid={aria["aria-invalid"]}
            aria-describedby={aria["aria-describedby"]}
            className="grid grid-cols-3 gap-2"
          >
            {locales.map((l) => (
              <RadioGroupPrimitive.Item
                key={l}
                value={l}
                lang={l}
                className={cn(
                  "focus-visible:ring-ring/50 data-[state=checked]:border-primary data-[state=checked]:bg-primary/8 data-[state=checked]:text-primary h-12 rounded-xl border text-base font-medium outline-none focus-visible:ring-3",
                  l === "fa" && "font-(family-name:--font-iransans)",
                )}
              >
                {tc(`locales.${l}`)}
              </RadioGroupPrimitive.Item>
            ))}
          </RadioGroupPrimitive.Root>
        )}
      </FormField>
      {error && <FormAlert>{error}</FormAlert>}
      <BigSubmit pending={pending}>{t("save")}</BigSubmit>
    </Form>
  )
}
