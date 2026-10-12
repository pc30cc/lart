/**
 * The visit statistics' rules that need no server (client-safe): what a
 * visit report holds, which browsers are robots, the kind of device, and the
 * referrer's host. See record.ts.
 */

export const devices = ["mobile", "tablet", "desktop"] as const
export type Device = (typeof devices)[number]

/** What the page sends: the page without its language, its language, and on the first page only the site it came from. */
export type ViewReport = { path: string; locale: string; referrer?: string }

/** Search engines, link previews, uptime checks and headless browsers: never counted. */
const ROBOT =
  /bot|crawl|spider|slurp|archiver|preview|fetch|monitor|uptime|headless|lighthouse|pagespeed|facebookexternalhit|whatsapp|telegram|discord|skype|curl|wget|python|axios|node-fetch|go-http|java\/|httpclient|okhttp/i

export const isRobot = (userAgent: string | null): boolean => !userAgent || ROBOT.test(userAgent)

/** The kind of device from the browser's user agent. */
export function deviceOf(userAgent: string): Device {
  if (/ipad|tablet|kindle|silk|playbook|(android(?!.*mobile))/i.test(userAgent)) return "tablet"
  if (/mobi|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(userAgent)) return "mobile"
  return "desktop"
}

/**
 * The host of the site a visitor came from ("google.com"), without "www." and
 * "m."; null when there is none, it is not a web address, or it is this site.
 */
export function referrerHost(referrer: string | undefined, ownHost: string): string | null {
  if (!referrer) return null
  try {
    const url = new URL(referrer)
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    const host = url.hostname.toLowerCase().replace(/^(www|m|l|lm)\./, "")
    if (!host || host === ownHost.toLowerCase().replace(/^www\./, "")) return null
    // Apps that open links (Instagram, Facebook, Google's app) send these.
    if (host === "instagram.com" || host.endsWith(".instagram.com")) return "instagram.com"
    if (host === "facebook.com" || host.endsWith(".facebook.com")) return "facebook.com"
    if (/^google\.[a-z.]+$/.test(host)) return "google.com"
    if (host === "t.co") return "x.com"
    return host.slice(0, 120)
  } catch {
    return null
  }
}

/** A page address worth keeping: starts with "/", no query, no fragment, short. */
export function cleanPath(path: string): string | null {
  const bare = path.split(/[?#]/)[0]
  if (!bare.startsWith("/") || bare.startsWith("//") || bare.length > 200) return null
  if (!/^[\p{L}\p{N}/._~%-]*$/u.test(bare)) return null
  return bare.length > 1 ? bare.replace(/\/+$/, "") : "/"
}
