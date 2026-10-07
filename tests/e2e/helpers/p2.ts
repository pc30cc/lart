import fs from "node:fs"
import path from "node:path"

import type { Browser, BrowserContext, Page } from "@playwright/test"
import { createTranslator } from "next-intl"

import { E2E_DIR, emailsSince, expect, RUN, type SentEmail } from "./app"
import { one } from "./db"

/**
 * Phase-2 helpers: the app's own messages (so the specs follow the wording in
 * every language), people of this run, per-person browser contexts with their
 * own client IP (the public forms are rate limited per network) and saved
 * sessions, and the emails the fake Resend API caught.
 */

const ROOT = path.resolve(__dirname, "../../..")
type Locale = "fa" | "tr" | "en"

const cache = new Map<Locale, ReturnType<typeof createTranslator>>()

/** A translator over messages/<locale>/*.json, e.g. `tr("tr")("registration.register.submit")`. */
export function tr(locale: Locale) {
  let t = cache.get(locale)
  if (!t) {
    const dir = path.join(ROOT, "messages", locale)
    const messages = Object.fromEntries(
      fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => [f.replace(/\.json$/, ""), JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))]),
    )
    t = createTranslator({ locale, messages, timeZone: "Europe/Istanbul", onError: () => {} })
    cache.set(locale, t)
  }
  return t as unknown as (key: string, values?: Record<string, unknown>) => string
}

const raws = new Map<Locale, Record<string, unknown>>()

/** The raw text of a message (ICU source), e.g. raw("tr", "emails.member_exists.subject"). */
export function raw(locale: Locale, key: string): string {
  let all = raws.get(locale)
  if (!all) {
    const dir = path.join(ROOT, "messages", locale)
    all = Object.fromEntries(
      fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => [f.replace(/\.json$/, ""), JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))]),
    )
    raws.set(locale, all)
  }
  const value = key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], all)
  if (typeof value !== "string") throw new Error(`no message ${locale}:${key}`)
  return value
}

/** The fixed text of a message before its first argument (for partial matching; "" when it starts with one). */
export function lead(locale: Locale, key: string): string {
  return raw(locale, key).split("{")[0].trim()
}

// ─── People of this run ────────────────────────────────────────────────────────

export const PASSWORD = "Lart-e2e-Password-2026"

export const P2 = {
  /** Instructor A: signs in the panel, teaches workshops A, B and D. */
  nur: {
    displayName: { fa: `نور ${RUN}`, tr: `Nur Aksoy ${RUN}`, en: `Nur Aksoy ${RUN}` },
    teachingField: { fa: "سفال", tr: "Seramik boyama", en: "Ceramic painting" },
    officialName: `Nur Aksoy Yıldız ${RUN}`,
    idNumber: "98765432109",
    mobile: "+90 533 111 22 33",
    email: `nur.${RUN}@lart.test`,
  },
  /** Instructor B: teaches workshop C (cancelled by the admin); must not see A's data. */
  derya: {
    displayName: { fa: `دریا ${RUN}`, tr: `Derya Şahin ${RUN}`, en: `Derya Sahin ${RUN}` },
    teachingField: { fa: "نقاشی", tr: "Resim", en: "Painting" },
    officialName: `Derya Şahin ${RUN}`,
    idNumber: "11223344556",
    mobile: "+90 534 222 33 44",
    email: `derya.${RUN}@lart.test`,
  },
  /** Members (students). */
  ayla: { name: `Ayla Kurt ${RUN}`, email: `ayla.${RUN}@member.test`, phone: "+90 532 000 11 22" },
  bahar: { name: `Bahar Ece ${RUN}`, email: `bahar.${RUN}@member.test`, phone: "" },
  cemre: { name: `Cemre Su ${RUN}`, email: `cemre.${RUN}@member.test`, phone: "+90 535 000 33 44" },
  /** Workshops of phase 2. */
  wA: {
    title: { fa: `نقاشی روی سفال ${RUN}`, tr: `Seramik boyama ${RUN}`, en: `Ceramic painting ${RUN}` },
    slug: `seramik-boyama-${RUN}`,
    venue: { tr: `Nur Atölye, Moda ${RUN}`, en: `Nur Studio, Moda ${RUN}` },
    paymentUrl: `https://iyzi.link/AA${RUN}`,
  },
  wB: {
    title: { fa: `ماکرامه ${RUN}`, tr: `Makrome atölyesi ${RUN}`, en: `Macrame workshop ${RUN}` },
    slug: `makrome-atolyesi-${RUN}`,
    venue: { tr: `Kuzguncuk Evi ${RUN}` },
    paymentUrl: `https://www.paytr.com/link/B${RUN}`,
  },
  wC: {
    title: { fa: `آبرنگ گل ${RUN}`, tr: `Çiçek suluboya ${RUN}`, en: `Flower watercolour ${RUN}` },
    slug: `cicek-suluboya-${RUN}`,
    venue: { tr: `Cihangir Stüdyo ${RUN}` },
  },
  wD: {
    title: { fa: `شمع معطر ${RUN}`, tr: `Kokulu mum ${RUN}`, en: `Scented candles ${RUN}` },
    slug: `kokulu-mum-${RUN}`,
    venue: { tr: `Bebek Atölye ${RUN}` },
  },
  /** A valid Turkish IBAN (checksum ok) and one with a mistyped digit. */
  iban: { valid: "TR330006100519786457841326", typo: "TR330006100519786457841327" },
}

export type Member = (typeof P2)["ayla"]

// ─── Browser contexts ──────────────────────────────────────────────────────────

/** A client IP of its own, so the per-network rate limits of the public forms don't add up across runs. */
export const randomIp = () => `10.${97 + Math.floor(Math.random() * 3)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`

const sessionFile = (who: string) => path.join(E2E_DIR, `p2-session-${who}.json`)

/** A fresh, signed-out context (no admin cookie), with its own client IP. */
export async function anonContext(browser: Browser, options: Parameters<Browser["newContext"]>[0] = {}) {
  return browser.newContext({ storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { "x-real-ip": randomIp() }, ...options })
}

/** The saved session of a member or instructor of this run (from an earlier spec), in a new context. */
export async function personContext(browser: Browser, who: string, options: Parameters<Browser["newContext"]>[0] = {}) {
  const file = sessionFile(who)
  if (!fs.existsSync(file)) throw new Error(`no saved session for ${who}: run the earlier phase-2 specs first`)
  return browser.newContext({ storageState: file, extraHTTPHeaders: { "x-real-ip": randomIp() }, ...options })
}

export async function saveSession(context: BrowserContext, who: string) {
  fs.mkdirSync(E2E_DIR, { recursive: true })
  await context.storageState({ path: sessionFile(who) })
}

export function hasSession(who: string) {
  return fs.existsSync(sessionFile(who))
}

// ─── Emails ────────────────────────────────────────────────────────────────────

const to = (e: SentEmail) => [e.to].flat().map((a) => String(a).toLowerCase())

/** Emails to this address since `mark`. */
export function mailTo(address: string, mark: number): SentEmail[] {
  return emailsSince(mark).filter((e) => to(e).includes(address.toLowerCase()))
}

/** Wait until an email to `address` whose subject matches `subject` arrives (sent after the response, so poll). */
export async function waitMail(address: string, mark: number, subject: RegExp | string, timeout = 15_000): Promise<SentEmail> {
  let found: SentEmail | undefined
  await expect
    .poll(
      () => {
        found = mailTo(address, mark).find((e) => (typeof subject === "string" ? e.subject.includes(subject) : subject.test(e.subject)))
        return Boolean(found)
      },
      { timeout, message: `email to ${address} with subject ${subject}; got: ${mailTo(address, mark).map((e) => e.subject).join(" | ") || "none"}` },
    )
    .toBe(true)
  return found!
}

/** The links of an email's HTML. */
export function linksOf(email: SentEmail): string[] {
  return [...new Set(Array.from(email.html.matchAll(/href="([^"]+)"/g), (m) => m[1].replaceAll("&amp;", "&")))]
}

/** The subject of an email in a language, with its fixed text only (the part before the first placeholder or after it). */
export function subjectPattern(locale: Locale, template: string, values: Record<string, string>) {
  return tr(locale)(`emails.${template}.subject`, values)
}

// ─── Pages ─────────────────────────────────────────────────────────────────────

export async function courseId(slug: string) {
  return (await one<{ id: string }>("select id from courses where slug = $1", [slug])).id
}

/** Sign a member in on the site (login page), in a language. */
export async function memberLogin(page: Page, locale: Locale, email: string, password = PASSWORD, next?: string) {
  const t = tr(locale)
  await page.goto(`/${locale}/account/login${next ? `?next=${encodeURIComponent(next)}` : ""}`)
  await page.getByLabel(t("account.form.email")).fill(email)
  await page.getByLabel(t("account.form.password"), { exact: true }).fill(password)
  await page.getByRole("button", { name: t("account.login.submit") }).click()
}

/** Raw HTML of a page as a signed-out visitor (or with the context's cookies). */
export async function html(page: Page, url: string) {
  const res = await page.request.get(url)
  return { status: res.status(), headers: res.headers(), body: await res.text() }
}
