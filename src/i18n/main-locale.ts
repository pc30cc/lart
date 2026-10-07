import "server-only"
import { eq } from "drizzle-orm"

import { errorForLog } from "@/lib/errors"
import { FALLBACK_LOCALE, isAppLocale, type AppLocale } from "./locales"

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
 * The cache lives on `globalThis`: the proxy and the app are bundled
 * separately and get their own copy of this module, but run in one process.
 */
export const MAIN_LOCALE_TTL_MS = 30_000
const RETRY_MS = 5_000
const COLD_WAIT_MS = 1_500

type Store = { value: AppLocale | null; expiresAt: number; inflight: Promise<AppLocale> | null; version: number }

const store = ((globalThis as { [key: symbol]: Store })[Symbol.for("lart.mainLocale")] ??= {
  value: null,
  expiresAt: 0,
  inflight: null,
  version: 0,
})

async function load(): Promise<AppLocale> {
  const version = store.version
  try {
    // Imported here, not at the top: the proxy and `next build` load this
    // module without touching the environment or the connection pool.
    const [{ db }, { settings }] = await Promise.all([import("@/db"), import("@/db/schema")])
    const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "defaultLocale")).limit(1)
    const value = isAppLocale(row?.value) ? row.value : FALLBACK_LOCALE
    // A save in this process while the query ran wins over what it read.
    if (store.version === version) Object.assign(store, { value, expiresAt: Date.now() + MAIN_LOCALE_TTL_MS })
    return store.value ?? value
  } catch (err) {
    console.warn("[i18n] main language not read", errorForLog(err))
    const value = store.value ?? FALLBACK_LOCALE
    if (store.version === version) Object.assign(store, { value, expiresAt: Date.now() + RETRY_MS })
    return value
  }
}

/** One load at a time; a load started before `resetMainLocaleCache()` does not clear the next one. */
function refresh(): Promise<AppLocale> {
  const promise: Promise<AppLocale> = load().finally(() => {
    if (store.inflight === promise) store.inflight = null
  })
  return promise
}

/** The main language (cached; see above). */
export async function getMainLocale(): Promise<AppLocale> {
  if (store.value && Date.now() < store.expiresAt) return store.value
  const inflight = (store.inflight ??= refresh())
  if (store.value) return store.value
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<AppLocale>((resolve) => {
    timer = setTimeout(() => resolve(FALLBACK_LOCALE), COLD_WAIT_MS)
    timer.unref?.()
  })
  try {
    return await Promise.race([inflight, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/** After the setting was saved (committed): this process switches at once. */
export function setMainLocale(locale: AppLocale): void {
  store.version++
  store.value = locale
  store.expiresAt = Date.now() + MAIN_LOCALE_TTL_MS
}

/** Tests: forget the cached value. */
export function resetMainLocaleCache(): void {
  store.version++
  store.value = null
  store.expiresAt = 0
  store.inflight = null
}
