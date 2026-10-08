/**
 * One-time notices an action leaves for the next page as `?notice=…`: the site
 * layout shows them as a toast (messages: site.notices.<notice>) and removes
 * the parameter. Only these values are ever shown.
 */
export const siteNotices = ["checkEmail", "signedOut", "passwordSaved"] as const
export type SiteNotice = (typeof siteNotices)[number]

export const isSiteNotice = (value: unknown): value is SiteNotice =>
  typeof value === "string" && (siteNotices as readonly string[]).includes(value)

/** `path` (a safe, same-site path with an optional query) with `?notice=…` added. */
export function withNotice(path: string, notice: SiteNotice): string {
  const url = new URL(path, "http://notice.invalid")
  url.searchParams.set("notice", notice)
  return url.pathname + url.search
}
