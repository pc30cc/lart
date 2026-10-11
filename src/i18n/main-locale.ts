import "server-only"
import { inArray } from "drizzle-orm"

import { errorForLog } from "@/lib/errors"
import { FALLBACK_LOCALE, isAppLocale, locales, type AppLocale } from "./locales"

/**
 * The site's main language: the `defaultLocale` setting (Settings → General).
 * Its addresses have no language prefix (docs/DEVELOPMENT.md, "URL rules"),
 * so every URL decision reads it here: the proxy on each request, links,
 * canonical URLs, the sitemap and email links.
 *
 * Read from the database at most every 30 seconds per process: a stale value
 * is served while a fresh one loads, and a first read that hangs gives the
 * fallback after 1.5 s (the proxy must not wait on the database). Saving the
 * setting updates it at once in the process that saved it (`setMainLocale`);
 * the other processes follow within the 30 seconds. It never throws.
 *
 * Until one read has succeeded (a cold start with a slow or unreachable
 * database), the value is only a guess: `getMainLocaleState()` says so
 * (`known: false`), and the proxy then sends no permanent redirect that
 * depends on it.
 *
 * The site's languages (the `siteLocales` setting: which languages the public
 * site is shown in) are read and cached with it, the main language always
 * among them; while nothing was read, every language counts as on.
 *
 * The cache lives on `globalThis`: the proxy and the app are bundled
 * separately and get their own copy of this module, but run in one process.
 */
export const MAIN_LOCALE_TTL_MS = 30_000
const RETRY_MS = 5_000
const COLD_WAIT_MS = 1_500

/**
 * The main language, and whether it was read from the setting (`known`) or is
 * the fallback guessed while the database did not answer; with the site's
 * languages (`site`, the main one included).
 */
export type MainLocaleState = { locale: AppLocale; known: boolean; site: readonly AppLocale[] }

type Store = {
  value: AppLocale | null
  /** The site's languages read with `value` (null: none read, every language is on). */
  site: AppLocale[] | null
  /** `value` came from a successful read (or a save), not from the fallback. */
  known: boolean
  expiresAt: number
  inflight: Promise<MainLocaleState> | null
  version: number
}

const store = ((globalThis as { [key: symbol]: Store })[Symbol.for("lart.mainLocale")] ??= {
  value: null,
  site: null,
  known: false,
  expiresAt: 0,
  inflight: null,
  version: 0,
})

const GUESS: MainLocaleState = { locale: FALLBACK_LOCALE, known: false, site: locales }

/** The site's languages as stored, in the usual order, always with the main language (none valid: all of them). */
export function siteLocalesOf(raw: unknown, main: AppLocale): AppLocale[] {
  const picked = Array.isArray(raw) ? locales.filter((l) => raw.includes(l)) : []
  return picked.length ? locales.filter((l) => l === main || picked.includes(l)) : [...locales]
}

/** The cached value, if any. (`=== true`: a store left by an older copy of this module, in development, has no `known`.) */
const cached = (): MainLocaleState | null =>
  store.value ? { locale: store.value, known: store.known === true, site: siteLocalesOf(store.site ?? locales, store.value) } : null

async function load(): Promise<MainLocaleState> {
  const version = store.version
  try {
    // Imported here, not at the top: the proxy and `next build` load this
    // module without touching the environment or the connection pool.
    const [{ db }, { settings }] = await Promise.all([import("@/db"), import("@/db/schema")])
    const rows = await db
      .select({ key: settings.key, value: settings.value })
      .from(settings)
      .where(inArray(settings.key, ["defaultLocale", "siteLocales"]))
      .limit(2)
    const raw = (key: string) => rows.find((r) => r.key === key)?.value
    // No row or an unknown value: the setting's own default, a real answer.
    const main = raw("defaultLocale")
    const value = isAppLocale(main) ? main : FALLBACK_LOCALE
    const site = siteLocalesOf(raw("siteLocales"), value)
    // A save in this process while the query ran wins over what it read.
    if (store.version === version) Object.assign(store, { value, site, known: true, expiresAt: Date.now() + MAIN_LOCALE_TTL_MS })
    return cached() ?? { locale: value, known: true, site }
  } catch (err) {
    console.warn("[i18n] main language not read", errorForLog(err))
    // The last value read stays (still known); without one, the fallback is a guess.
    if (store.version === version) {
      Object.assign(store, { value: store.value ?? FALLBACK_LOCALE, known: store.known === true, expiresAt: Date.now() + RETRY_MS })
    }
    return cached() ?? GUESS
  }
}

/** One load at a time; a load started before `resetMainLocaleCache()` does not clear the next one. */
function refresh(): Promise<MainLocaleState> {
  const promise: Promise<MainLocaleState> = load().finally(() => {
    if (store.inflight === promise) store.inflight = null
  })
  return promise
}

/** The main language and whether it is known or only guessed (cached; see above). The proxy's redirects need the difference. */
export async function getMainLocaleState(): Promise<MainLocaleState> {
  if (store.value && Date.now() < store.expiresAt) return cached()!
  const inflight = (store.inflight ??= refresh())
  if (store.value) return cached()!
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<MainLocaleState>((resolve) => {
    timer = setTimeout(() => resolve(GUESS), COLD_WAIT_MS)
    timer.unref?.()
  })
  try {
    return await Promise.race([inflight, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/** The main language (cached; see above). */
export async function getMainLocale(): Promise<AppLocale> {
  return (await getMainLocaleState()).locale
}

/** The languages the public site is shown in, the main one included (cached; see above). */
export async function getSiteLocales(): Promise<readonly AppLocale[]> {
  return (await getMainLocaleState()).site
}

/** After the setting was saved (committed): this process switches at once. */
export function setMainLocale(locale: AppLocale, site?: readonly AppLocale[]): void {
  store.version++
  store.value = locale
  if (site) store.site = [...site]
  store.known = true
  store.expiresAt = Date.now() + MAIN_LOCALE_TTL_MS
}

/** Tests: forget the cached value. */
export function resetMainLocaleCache(): void {
  store.version++
  store.value = null
  store.site = null
  store.known = false
  store.expiresAt = 0
  store.inflight = null
}
