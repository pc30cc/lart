import fs from "node:fs"
import path from "node:path"

import { test as base, expect, type Locator, type Page } from "@playwright/test"

/** Suffix that makes this run's names, emails and slugs unique (set in playwright.config.ts). */
export const RUN = process.env.E2E_RUN ?? "local"

export const ADMIN = { email: "owner@lart.test", password: "Correct-Horse-Battery-9", name: "Owner One" }

export const E2E_DIR = path.resolve(__dirname, "../../../.e2e")
export const SCREENS = path.join(E2E_DIR, "screens")
export const PROBLEMS_FILE = path.join(E2E_DIR, "problems.jsonl")
export const FIXTURES = path.resolve(__dirname, "../fixtures")

/** The server's output, where emails are printed without a Resend key. */
export const SERVER_LOG = process.env.E2E_SERVER_LOG ?? path.join(E2E_DIR, "server.log")

export type Problem = {
  test: string
  page: string
  type: "console" | "pageerror" | "requestfailed" | "http"
  text: string
}

/**
 * `test` with an automatic fixture that records, for every page of the test,
 * browser console errors, uncaught page errors, failed requests and HTTP
 * responses >= 400 (into `.e2e/problems.jsonl` and the test's annotations).
 * `problems` is the list for the current test, so a spec can assert on it.
 */
export const test = base.extend<{ problems: Problem[] }>({
  problems: [
    async ({ context }, use, info) => {
      const found: Problem[] = []
      const title = info.titlePath.slice(1).join(" › ")
      const add = (p: Omit<Problem, "test">) => {
        // Expected noise: aborted RSC prefetches when navigating away, media range requests.
        if (p.type === "requestfailed" && /ERR_ABORTED/.test(p.text)) return
        found.push({ test: title, ...p })
      }
      const watch = (page: Page) => {
        page.on("console", (msg) => {
          if (msg.type() === "error") add({ page: page.url(), type: "console", text: msg.text().slice(0, 500) })
        })
        page.on("pageerror", (err) => add({ page: page.url(), type: "pageerror", text: String(err).slice(0, 500) }))
        page.on("requestfailed", (req) =>
          add({ page: page.url(), type: "requestfailed", text: `${req.method()} ${req.url()} ${req.failure()?.errorText ?? ""}` }),
        )
        page.on("response", (res) => {
          if (res.status() >= 400) add({ page: page.url(), type: "http", text: `${res.status()} ${res.request().method()} ${res.url()}` })
        })
      }
      context.pages().forEach(watch)
      context.on("page", watch)
      await use(found)
      if (found.length) {
        fs.mkdirSync(E2E_DIR, { recursive: true })
        fs.appendFileSync(PROBLEMS_FILE, found.map((p) => JSON.stringify(p)).join("\n") + "\n")
        for (const p of found) info.annotations.push({ type: `browser-${p.type}`, description: `${p.page}: ${p.text}` })
      }
    },
    { auto: true },
  ],
})

export { expect }

// ─── Small UI helpers ─────────────────────────────────────────────────────────

/** Wait until the page is settled (no pending requests) and fonts are ready. */
export async function settle(page: Page, timeout = 10_000) {
  await page.waitForLoadState("networkidle", { timeout }).catch(() => {})
  await page.evaluate(() => document.fonts.ready).catch(() => {})
}

/** A sonner toast with this text. */
export function toast(page: Page, text: string | RegExp) {
  return page.locator("[data-sonner-toast]").filter({ hasText: text }).first()
}

/** The <Field> block (label + control + hint) whose label contains `label`. */
export function field(scope: Page | Locator, label: string | RegExp) {
  // The inner `has` locator is matched inside each field, so it must start from the page, not from `scope`.
  const root = "page" in scope && typeof scope.page === "function" ? (scope as Locator).page() : (scope as Page)
  return scope
    .locator('[data-slot="field"]')
    .filter({ has: root.locator('[data-slot="field-label"]', { hasText: label }) })
    .first()
}

const LOCALE_TABS = { fa: "فارسی", tr: "Türkçe", en: "English" } as const

/** Fill a LocalizedInput / LocalizedTextarea (FA / TR / EN tabs) by its label. */
export async function fillLocalized(
  scope: Page | Locator,
  label: string | RegExp,
  values: Partial<Record<"fa" | "tr" | "en", string>>,
) {
  const box = field(scope, label)
  for (const locale of ["fa", "tr", "en"] as const) {
    const value = values[locale]
    if (value === undefined) continue
    await box.getByRole("tab", { name: LOCALE_TABS[locale] }).click()
    await box.locator(`[lang="${locale}"]:is(input, textarea)`).fill(value)
  }
}

/** Choose an option of a Radix <Select> inside the field with this label. */
export async function chooseSelect(page: Page, label: string | RegExp, option: string | RegExp) {
  await field(page, label).getByRole("combobox").click()
  await page.getByRole("option", { name: option }).first().click()
}

/** "YYYY-MM-DD" of a Date in Istanbul. */
export function istanbulDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(d)
}

/**
 * Pick a date in the react-day-picker popover opened by `trigger`, walking
 * months forward or back. Works for the en-GB calendar (data-day "dd/mm/yyyy").
 */
export async function pickDate(page: Page, trigger: Locator, isoDate: string) {
  await trigger.click()
  const [y, m, d] = isoDate.split("-")
  const pop = page.locator('[data-slot="popover-content"]').last()
  const day = pop.locator(`button[data-day="${d}/${m}/${y}"]`)
  const target = Number(y) * 12 + Number(m)
  for (let i = 0; i < 36 && !(await day.isVisible()); i++) {
    const caption = (await pop.locator(".rdp-caption_label, [role=status]").first().textContent()) ?? ""
    const shown = Date.parse(`1 ${caption.trim()}`)
    const current = Number.isNaN(shown) ? target - 1 : new Date(shown).getFullYear() * 12 + new Date(shown).getMonth() + 1
    await pop.locator(current < target ? ".rdp-button_next" : ".rdp-button_previous").click()
  }
  await day.click()
  await expect(pop).toBeHidden()
}

/** A DateTimeFields block: pick the date and type the start (and end) time. */
export async function fillDateTime(page: Page, label: string | RegExp, isoDate: string, start: string, end?: string) {
  const box = field(page, label)
  await pickDate(page, box.locator("button").first(), isoDate)
  await box.getByLabel("Start time").fill(start)
  if (end) await box.getByLabel("End time").fill(end)
}

/** Save a full-page screenshot as .e2e/screens/<name>.png. */
export async function shot(page: Page, name: string) {
  await settle(page)
  // Let entrance animations (motion, tw-animate) finish.
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(SCREENS, `${name}.png`), fullPage: true })
}

/** Emails caught by the fake Resend API (helpers/mail-sink.mjs), one JSON object per line. */
export const MAIL_LOG = process.env.E2E_MAIL_LOG ?? path.join(E2E_DIR, "mail.jsonl")

export type SentEmail = { to: string | string[]; subject: string; html: string; text: string; from: string; idempotencyKey: string | null }

/** Emails sent since `mark` (from `mailMark()`). */
export function emailsSince(mark: number): SentEmail[] {
  try {
    return fs
      .readFileSync(MAIL_LOG, "utf8")
      .split("\n")
      .filter(Boolean)
      .slice(mark)
      .map((l) => JSON.parse(l) as SentEmail)
  } catch {
    return []
  }
}

export function mailMark(): number {
  try {
    return fs.readFileSync(MAIL_LOG, "utf8").split("\n").filter(Boolean).length
  } catch {
    return 0
  }
}

/**
 * Wait for an email to `to` (sent since `mark`): from the mail sink, or printed
 * in the server log by a development server without a Resend key.
 */
export async function waitForEmail(to: string, mark: number, logOffset: number, timeoutMs = 10_000) {
  const until = Date.now() + timeoutMs
  for (;;) {
    const found = emailsSince(mark).find((e) => [e.to].flat().includes(to))
    if (found) return { subject: found.subject, text: found.text, html: found.html, from: found.from, links: links(found.html) }
    const log = serverLog(logOffset)
    const block = log.split("──── email").find((b) => b.includes(`To: ${to}`))
    if (block) return { subject: /Subject: (.*)/.exec(block)?.[1] ?? "", text: block, html: "", from: "", links: /Links: (.*)/.exec(block)?.[1]?.split(/\s+/) ?? [] }
    if (Date.now() > until) return null
    await new Promise((r) => setTimeout(r, 250))
  }
}

function links(html: string) {
  return [...new Set(Array.from(html.matchAll(/href="([^"]+)"/g), (m) => m[1].replaceAll("&amp;", "&")))]
}

/** Text of the server log from `offset` (bytes) on. */
export function serverLog(offset = 0): string {
  try {
    return fs.readFileSync(SERVER_LOG, "utf8").slice(offset)
  } catch {
    return ""
  }
}

export function serverLogSize(): number {
  try {
    return fs.statSync(SERVER_LOG).size
  } catch {
    return 0
  }
}
