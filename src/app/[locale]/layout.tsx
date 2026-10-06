import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { hasLocale, NextIntlClientProvider } from "next-intl"
import { setRequestLocale } from "next-intl/server"

import { LocaleProviders } from "@/components/providers"
import { routing } from "@/i18n/routing"
import { getBrand } from "@/lib/settings"

export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params
  const brand = await getBrand(locale)
  return { title: { default: brand, template: `%s · ${brand}` }, applicationName: brand }
}

export default async function LocaleLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) notFound()
  setRequestLocale(locale)

  return (
    <NextIntlClientProvider>
      <LocaleProviders locale={locale}>{children}</LocaleProviders>
    </NextIntlClientProvider>
  )
}
