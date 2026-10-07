import fs from "node:fs"
import path from "node:path"

import type { APIRequestContext, Browser, BrowserContext, Page } from "@playwright/test"
import { createTranslator } from "next-intl"

import { at, chooseSelect, E2E_DIR, emailsSince, expect, field, fillDateTime, fillLocalized, istanbulDate, PROBLEMS_FILE, RUN, RUN_NAME, test, toast, type Problem, type SentEmail } from "./app"
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
  /** Members (students). Names without digits: the sign-up form refuses them. */
  ayla: { name: `Ayla Kurt ${RUN_NAME}`, email: `ayla.${RUN}@member.test`, phone: "+90 532 000 11 22" },
  bahar: { name: `Bahar Ece ${RUN_NAME}`, email: `bahar.${RUN}@member.test`, phone: "" },
  cemre: { name: `Cemre Su ${RUN_NAME}`, email: `cemre.${RUN}@member.test`, phone: "+90 535 000 33 44" },
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

/**
 * Record browser problems of a context of our own (console errors, page errors,
 * failed requests, HTTP >= 400) in .e2e/problems.jsonl, as the `problems`
 * fixture does for the test's default context (it doesn't see these).
 */
function watchProblems(context: BrowserContext, who: string) {
  let title = who
  try {
    title = `${test.info().titlePath.slice(1).join(" › ")} [${who}]`
  } catch {
    // outside a test
  }
  const add = (p: Omit<Problem, "test">) => {
    if (p.type === "requestfailed" && /ERR_ABORTED/.test(p.text)) return
    fs.mkdirSync(E2E_DIR, { recursive: true })
    fs.appendFileSync(PROBLEMS_FILE, JSON.stringify({ test: title, ...p }) + "\n")
  }
  context.on("page", (page) => {
    page.on("console", (msg) => {
      if (msg.type() === "error") add({ page: page.url(), type: "console", text: msg.text().slice(0, 500) })
    })
    page.on("pageerror", (err) => add({ page: page.url(), type: "pageerror", text: String(err).slice(0, 500) }))
    page.on("requestfailed", (req) => add({ page: page.url(), type: "requestfailed", text: `${req.method()} ${req.url()} ${req.failure()?.errorText ?? ""}` }))
    page.on("response", (res) => {
      if (res.status() >= 400) add({ page: page.url(), type: "http", text: `${res.status()} ${res.request().method()} ${res.url()}` })
    })
  })
  return context
}

/** A fresh, signed-out context (no admin cookie), with its own client IP. */
export async function anonContext(browser: Browser, options: Parameters<Browser["newContext"]>[0] = {}) {
  return watchProblems(await browser.newContext({ storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { "x-real-ip": randomIp() }, ...options }), "visitor")
}

/** The saved session of a member or instructor of this run (from an earlier spec), in a new context. */
export async function personContext(browser: Browser, who: string, options: Parameters<Browser["newContext"]>[0] = {}) {
  const file = sessionFile(who)
  if (!fs.existsSync(file)) throw new Error(`no saved session for ${who}: run the earlier phase-2 specs first`)
  return watchProblems(await browser.newContext({ storageState: file, extraHTTPHeaders: { "x-real-ip": randomIp() }, ...options }), who)
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
  await page.goto(at(locale, `/account/login${next ? `?next=${encodeURIComponent(next)}` : ""}`))
  await page.getByLabel(t("account.form.email")).fill(email)
  await page.getByLabel(t("account.form.password"), { exact: true }).fill(password)
  await page.getByRole("button", { name: t("account.login.submit") }).click()
}

/** Raw HTML of a page as a signed-out visitor (or with the context's cookies). */
export async function html(page: Page, url: string) {
  const res = await page.request.get(url)
  return { status: res.status(), headers: res.headers(), body: await res.text() }
}

// ─── Admin forms ───────────────────────────────────────────────────────────────

const DAY = 86_400_000
/** "YYYY-MM-DD" in Istanbul, n days from now. */
export const inDays = (n: number) => istanbulDate(new Date(Date.now() + n * DAY))

/** The category of this run's phase-2 workshops (10-p2-admin-setup creates it). */
export const CATEGORY = { fa: `سفال‌گری ${RUN}`, tr: `Atölye P2 ${RUN}`, en: `Workshop P2 ${RUN}` }

/** Fill in the instructor form (new or edit) with a phase-2 instructor. */
export async function fillInstructor(page: Page, p: Pick<(typeof P2)["nur"], "displayName" | "teachingField" | "officialName" | "idNumber" | "mobile" | "email">) {
  await fillLocalized(page, "Display name", p.displayName)
  await fillLocalized(page, "Teaching field", p.teachingField)
  await field(page, "Official full name").getByRole("textbox").fill(p.officialName)
  await field(page, "ID number").getByRole("textbox").fill(p.idNumber)
  await field(page, "Mobile number").getByRole("textbox").fill(p.mobile)
  await field(page, /^Email/).getByRole("textbox").fill(p.email)
}

export type WorkshopInput = {
  title: { fa?: string; tr: string; en?: string }
  instructor: string
  date: number
  start: string
  end: string
  deadline: [number, string]
  decision: [number, string]
  venue: Record<string, string>
  min: number
  max: number
  price: string
  fee: string
  paymentUrl?: string
  intro?: { fa?: string; tr?: string; en?: string }
}

/** Create a workshop with the admin form (per-participant fee), which emails the contract to the instructor. */
export async function createWorkshop(page: Page, w: WorkshopInput) {
  await page.goto("/en/admin/workshops/new")
  await expect(page.getByRole("heading", { level: 1, name: "New workshop" })).toBeVisible()
  await fillLocalized(page, /^Workshop name/, w.title)
  await chooseSelect(page, /^Category/, CATEGORY.en)
  await chooseSelect(page, /^Instructor/, w.instructor)
  await fillDateTime(page, /^Date and time/, inDays(w.date), w.start, w.end)
  await fillDateTime(page, /^Registration closes/, inDays(w.deadline[0]), w.deadline[1])
  await fillDateTime(page, /^Go \/ no-go decision/, inDays(w.decision[0]), w.decision[1])
  await fillLocalized(page, /^Place/, w.venue)
  await field(page, /^Minimum participants/).getByRole("spinbutton").fill(String(w.min))
  await field(page, /^Maximum participants/).getByRole("spinbutton").fill(String(w.max))
  await field(page, /^Price per person/).getByRole("textbox").fill(w.price)
  if (w.intro) await fillLocalized(page, /^Short introduction/, w.intro)
  if (w.paymentUrl) await field(page, /^Online payment link/).getByRole("textbox").fill(w.paymentUrl)
  await field(page, /^Amount per participant/).getByRole("textbox").fill(w.fee)
  await page.getByRole("button", { name: "Create and send contract" }).click()
  await expect(toast(page, /Workshop created\./)).toBeVisible()
  await expect(page).toHaveURL(/\/en\/admin\/workshops\/[0-9a-f-]{36}$/)
}

// ─── Server actions, replayed ──────────────────────────────────────────────────

export type CapturedAction = { url: string; headers: Record<string, string>; body: string }

/**
 * Run `trigger` (a click that posts a server action) and catch that POST
 * before it reaches the server (aborted, so nothing happens): its address,
 * headers and body, to be replayed with someone else's cookies.
 */
export async function captureAction(page: Page, trigger: () => Promise<void>): Promise<CapturedAction> {
  let captured: CapturedAction | undefined
  await page.route("**/*", async (route) => {
    const req = route.request()
    if (!captured && req.method() === "POST" && req.headers()["next-action"]) {
      captured = { url: req.url(), headers: req.headers(), body: req.postData() ?? "" }
      return route.abort("aborted")
    }
    return route.continue()
  })
  await trigger()
  await expect.poll(() => Boolean(captured), { message: "a server action was posted" }).toBe(true)
  await page.unrouteAll({ behavior: "ignoreErrors" })
  return captured!
}

/** Post a captured server action again, as whoever `request` belongs to (same-origin, as a browser would). */
export async function replayAction(request: APIRequestContext, action: CapturedAction, body = action.body) {
  const keep = ["next-action", "content-type", "next-router-state-tree", "accept"]
  const headers = Object.fromEntries(Object.entries(action.headers).filter(([k]) => keep.includes(k.toLowerCase())))
  const res = await request.post(action.url, { headers: { ...headers, origin: new URL(action.url).origin }, data: body, maxRedirects: 0 })
  return { status: res.status(), text: await res.text() }
}
