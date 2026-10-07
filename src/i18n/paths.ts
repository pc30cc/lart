import { isAppLocale, type AppLocale } from "./locales"

/**
 * The address of a page in a language (docs/DEVELOPMENT.md, "URL rules"):
 * the main language has no prefix, the others do. Pure, with a relative
 * import only: the proxy, client components, scripts, unit tests and the
 * end-to-end helpers use it.
 */

/**
 * `path` is the page's path without a language, starting with "/"; it may
 * carry a ?query and a #hash. In the main language it stays as it is; in the
 * others it gets the language in front: "/workshops" → "/fa/workshops", and
 * the home page "/" → "/fa" ("/?q=1" → "/fa?q=1"), never a trailing slash.
 * `main` null: the main language is not known (only the proxy, while the
 * setting could not be read yet); every language keeps its prefix.
 */
export function localePath(locale: string, path: string, main: string | null): string {
  if (locale === main) return path
  return /^\/(?=[?#]|$)/.test(path) ? `/${locale}${path.slice(1)}` : `/${locale}${path}`
}

/**
 * The language prefix of a path, if any (the first segment, matched without
 * regard to letter case, so "/TR/x" is found too) and the path without it
 * ("/" when nothing is left).
 */
export function splitLocale(pathname: string): { locale: AppLocale | null; rest: string } {
  const match = /^\/([^/]+)(\/.*)?$/.exec(pathname)
  const first = match?.[1].toLowerCase()
  if (!match || !isAppLocale(first)) return { locale: null, rest: pathname }
  return { locale: first, rest: match[2] || "/" }
}

/** `pathname` without the "/<locale>" prefix (exact case) when it has one: "/fa" → "/", "/fa/x" → "/x". */
export function stripLocale(pathname: string, locale: string): string {
  if (pathname === `/${locale}`) return "/"
  return pathname.startsWith(`/${locale}/`) ? pathname.slice(locale.length + 1) : pathname
}
