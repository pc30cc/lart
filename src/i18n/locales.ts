/**
 * The site's languages. Pure (no imports): the proxy, client components,
 * scripts, unit tests and the end-to-end helpers all use it.
 */
export const locales = ["fa", "tr", "en"] as const
export type AppLocale = (typeof locales)[number]

/**
 * The main language when the `defaultLocale` setting cannot be read (and its
 * default, `settingDefaults.defaultLocale`). The real main language is that
 * setting: `getMainLocale()` (src/i18n/main-locale.ts).
 */
export const FALLBACK_LOCALE: AppLocale = "tr"

export const rtlLocales: readonly AppLocale[] = ["fa"]
export const isRtl = (locale: string) => (rtlLocales as readonly string[]).includes(locale)
export const isAppLocale = (value: unknown): value is AppLocale => (locales as readonly unknown[]).includes(value)
