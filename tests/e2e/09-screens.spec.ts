import fs from "node:fs"
import path from "node:path"

import type { Page } from "@playwright/test"

import { expect, SCREENS, settle, test } from "./helpers/app"
import { INSTRUCTORS, WORKSHOPS } from "./helpers/data"
import { sql } from "./helpers/db"

/**
 * Full-page screenshots of every admin page: fa (RTL) and tr, light theme at
 * 1440×900; plus dark theme and phone width (390×844) for the main pages.
 * Files: .e2e/screens/<page>-<locale>-<theme>-<size>.png. Each page is also
 * checked for raw message keys, unfilled placeholders, sideways scrolling on a
 * phone and browser errors (soft checks: every screenshot is still taken).
 */

type Ids = Record<"open" | "held" | "cancelled" | "instructor" | "category" | "terms", string>

/** This run's records, or the latest ones when the flow specs ran with another suffix. */
async function ids(): Promise<Ids> {
  const pick = async (bySlug: [string, string[]], fallback: string) =>
    (await sql<{ id: string }>(bySlug[0], bySlug[1]))[0]?.id ?? (await sql<{ id: string }>(fallback))[0]?.id ?? "00000000-0000-0000-0000-000000000000"
  return {
    open: await pick(["select id from courses where slug = $1", [WORKSHOPS.open.slug]], "select id from courses where status = 'published' order by created_at desc limit 1"),
    held: await pick(["select id from courses where slug = $1", [WORKSHOPS.held.slug]], "select id from courses where status = 'closed' and cancelled_at is null order by created_at desc limit 1"),
    cancelled: await pick(["select id from courses where slug = $1", [WORKSHOPS.cancelled.slug]], "select id from courses where cancelled_at is not null order by created_at desc limit 1"),
    instructor: await pick(["select id from instructors where email = $1", [INSTRUCTORS.elif.email]], "select id from instructors order by created_at desc limit 1"),
    category: await pick(["select id from categories where slug like $1", ["%"]], "select id from categories limit 1"),
    terms: await pick(["select id from templates where kind = 'terms' and is_default", []], "select id from templates limit 1"),
  }
}

/** Every admin page: [name, path] (path without the locale). */
function pages(i: Ids): [string, string][] {
  return [
    ["dashboard", "/admin"],
    ["workshops", "/admin/workshops?view=all"],
    ["workshop-new", "/admin/workshops/new"],
    ["workshop-detail", `/admin/workshops/${i.open}`],
    ["workshop-detail-closed", `/admin/workshops/${i.held}`],
    ["workshop-detail-cancelled", `/admin/workshops/${i.cancelled}`],
    ["workshop-edit", `/admin/workshops/${i.open}/edit`],
    ["contract", `/admin/workshops/${i.held}/contract`],
    ["registrations", `/admin/workshops/${i.held}/registrations`],
    ["finances", `/admin/workshops/${i.open}/finances`],
    ["finances-closed", `/admin/workshops/${i.held}/finances`],
    ["gallery", `/admin/workshops/${i.held}/gallery`],
    ["instructors", "/admin/instructors"],
    ["instructor-new", "/admin/instructors/new"],
    ["instructor-detail", `/admin/instructors/${i.instructor}`],
    ["instructor-edit", `/admin/instructors/${i.instructor}/edit`],
    ["categories", "/admin/categories"],
    ["category-new", "/admin/categories/new"],
    ["category-edit", `/admin/categories/${i.category}`],
    ["wallet", "/admin/money"],
    ["partners", "/admin/money/partners"],
    ["transactions", "/admin/money/transactions"],
    ["reports", "/admin/money/reports"],
    ["reports-workshops", "/admin/money/reports?report=workshops"],
    ["reports-instructors", "/admin/money/reports?report=instructors"],
    ["reports-partner", "/admin/money/reports?report=partner"],
    ["settings", "/admin/settings"],
    ["settings-storage", "/admin/settings/storage"],
    ["settings-watermark", "/admin/settings/watermark"],
    ["templates", "/admin/templates"],
    ["template-edit", `/admin/templates/${i.terms}`],
    ["template-new", "/admin/templates/new"],
    ["audit", "/admin/audit"],
    // Phase 1 has no public site yet: the language root should still be a proper page, not the bare framework 404.
    ["site-root", ""],
    ["not-found-admin", "/admin/no-such-page"],
    ["not-found", "/no-such-page"],
  ]
}

/** The pages also taken in dark theme and at phone width. */
const MAIN = new Set(["login", "dashboard", "workshops", "workshop-new", "workshop-detail", "finances", "wallet", "instructor-new", "settings"])

const NAMESPACES = "common|auth|admin|categories|instructors|workshops|contracts|money|settings|templates|dashboard|media|emails"
const RAW_KEY = new RegExp(`(^|[\\s>"'(])(${NAMESPACES})\\.[a-z][A-Za-z]+(\\.[A-Za-z_]+)*(?=$|[\\s<"'),.])`, "m")

async function checkPage(page: Page, name: string) {
  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ")
  if (name !== "audit") {
    const raw = RAW_KEY.exec(text)
    expect.soft(raw?.[0] ?? null, `${name}: raw message key on the page`).toBeNull()
  }
  // Templates and settings show placeholders on purpose (they explain and edit them).
  if (!/^(template|settings)/.test(name)) {
    const placeholder = /\{(brand|instructor_[a-z_]+|workshop_[a-z_]+|[a-z]+_[a-z_]+)\}/.exec(text)
    expect.soft(placeholder?.[0] ?? null, `${name}: unfilled placeholder`).toBeNull()
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect.soft(overflow, `${name}: page scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1)
}

async function capture(page: Page, name: string, url: string, file: string) {
  const res = await page.goto(url)
  const notFound = name.startsWith("not-found")
  if (!notFound) expect.soft(res?.status(), `${name}: HTTP status`).toBeLessThan(400)
  // A not-found page keeps a router prefetch open, so it never goes network-idle.
  await settle(page, notFound ? 2_000 : 10_000)
  // Charts and entrance animations.
  await page.waitForTimeout(name === "dashboard" ? 1800 : 500)
  await checkPage(page, name)
  fs.mkdirSync(SCREENS, { recursive: true })
  await page.screenshot({ path: path.join(SCREENS, `${file}.png`), fullPage: true })
}

function browserErrors(problems: { type: string; text: string }[]) {
  return problems.filter((p) => p.type === "console" || p.type === "pageerror").map((p) => p.text.split("\n")[0])
}

const variants = [
  { theme: "light", size: "1440", viewport: { width: 1440, height: 900 }, all: true },
  { theme: "dark", size: "1440", viewport: { width: 1440, height: 900 }, all: false },
  { theme: "light", size: "390", viewport: { width: 390, height: 844 }, all: false },
  { theme: "dark", size: "390", viewport: { width: 390, height: 844 }, all: false },
] as const

let IDS: Ids
test.beforeAll(async () => {
  IDS = await ids()
})

for (const locale of ["fa", "tr"] as const) {
  for (const v of variants) {
    test.describe(`${locale} ${v.theme} ${v.size}`, () => {
      test.use({ viewport: v.viewport, colorScheme: v.theme, ...(v.size === "390" ? { isMobile: true, hasTouch: true } : {}) })

      test.describe("signed out", () => {
        test.use({ storageState: { cookies: [], origins: [] } })
        test(`login-${locale}-${v.theme}-${v.size}`, async ({ page, problems }) => {
          await capture(page, "login", `/${locale}/admin/login`, `login-${locale}-${v.theme}-${v.size}`)
          await expect(page.locator("html")).toHaveAttribute("dir", locale === "fa" ? "rtl" : "ltr")
          expect.soft(browserErrors(problems), "browser errors").toEqual([])
        })
      })

      // One test per page, so browser errors are reported page by page.
      for (const name of pages({ open: "", held: "", cancelled: "", instructor: "", category: "", terms: "" }).map(([n]) => n)) {
        if (!v.all && !MAIN.has(name)) continue
        test(`${name}-${locale}-${v.theme}-${v.size}`, async ({ page, problems }) => {
          const target = pages(IDS).find(([n]) => n === name)![1]
          await capture(page, name, `/${locale}${target}`, `${name}-${locale}-${v.theme}-${v.size}`)
          await expect(page.locator("html")).toHaveAttribute("lang", locale)
          const expected = name.startsWith("not-found") ? [] : browserErrors(problems)
          expect.soft(expected, "browser errors").toEqual([])
        })
      }
    })
  }
}

// Right-to-left details the screenshots show, checked directly.
test.describe("Persian layout", () => {
  test("a large amount sits on the right, like the rest of the card", async ({ page }) => {
    await page.goto("/fa/admin/money")
    await settle(page)
    const r = await page.evaluate(() => {
      const amount = document.querySelector("main bdi.block")!
      const range = document.createRange()
      range.selectNodeContents(amount)
      const text = range.getBoundingClientRect()
      const box = amount.parentElement!.getBoundingClientRect()
      return { direction: getComputedStyle(amount).direction, gapRight: Math.round(box.right - text.right), gapLeft: Math.round(text.left - box.left) }
    })
    test.info().annotations.push({ type: "wallet-amount", description: JSON.stringify(r) })
    expect(r.gapRight, `the wallet balance is pushed to the left (${JSON.stringify(r)})`).toBeLessThanOrEqual(2)
  })

  test("numbers in the workshop status use Persian digits", async ({ page }) => {
    await page.goto(`/fa/admin/workshops/${IDS.open}`)
    await settle(page)
    const status = await page.locator("main").innerText()
    const minimum = /حداقل لازم\s*(\S+)\s*نفر/.exec(status)?.[1] ?? null
    test.info().annotations.push({ type: "minimum", description: String(minimum) })
    expect.soft(minimum, "the minimum is written with Latin digits").not.toMatch(/[0-9]/)
    const steps = await page.locator("main ol.overflow-x-auto > li").allInnerTexts()
    expect.soft(steps.join(" "), "the step numbers are written with Latin digits").not.toMatch(/[0-9]/)
  })
})
