import fs from "node:fs"
import path from "node:path"

import type { Page } from "@playwright/test"

import { splitLocale } from "../../src/i18n/paths"
import { at, E2E_DIR, expect, mailMark, RUN, SCREENS, settle, test } from "./helpers/app"
import { sql } from "./helpers/db"
import { anonContext, createWorkshop, fillInstructor, hasSession, linksOf, P2, personContext, tr, waitMail } from "./helpers/p2"

/**
 * Full-page screenshots of every phase-2 page: the public site frame (header,
 * footer), workshops, a workshop page, registering, the confirmation with the
 * payment instructions, My workshops, the member and instructor sign-in pages,
 * every instructor panel page, and the admin's Settings → Payments,
 * Registrations tab and Refunds list. fa (RTL) and tr, light at 1440×900;
 * the main pages also dark and at phone width (390×844).
 *
 * Files: .e2e/screens/p2-<page>-<locale>-<theme>-<size>.png. Each page is also
 * checked for raw message keys, unfilled placeholders, sideways scrolling and
 * browser errors (soft checks: every screenshot is still taken).
 *
 * Runs after 10–14 (their people and workshops). The set-up test adds what the
 * flow leaves behind used up: a workshop whose contract Nur has not signed yet
 * (the sign page), an invitation not accepted yet, and unused password-reset
 * links (the reset forms).
 */

type Who = "anon" | "admin" | "ayla" | "bahar" | "nur"
type Locale = "fa" | "tr"

const SCREENS_WORKSHOP = {
  title: { fa: `ورکشاپ نمونه ${RUN}`, tr: `Örnek atölye ${RUN}`, en: `Sample workshop ${RUN}` },
  slug: `ornek-atolye-${RUN}`,
  venue: { tr: `Galata Atölye ${RUN}`, en: `Galata Studio ${RUN}` },
}
const INVITEE = {
  displayName: { fa: `آیدا ${RUN}`, tr: `Ayda Er ${RUN}`, en: `Ayda Er ${RUN}` },
  teachingField: { fa: "خوشنویسی", tr: "Hat sanatı", en: "Calligraphy" },
  officialName: `Ayda Er ${RUN}`,
  idNumber: "10293847561",
  mobile: "+90 536 444 55 66",
  email: `ayda.${RUN}@lart.test`,
}
const LINKS_FILE = path.join(E2E_DIR, `p2-screen-links-${RUN}.json`)

type Links = { invite?: string; memberReset?: string; instructorReset?: string }
const readLinks = (): Links => {
  try {
    return JSON.parse(fs.readFileSync(LINKS_FILE, "utf8")) as Links
  } catch {
    return {}
  }
}
/** An emailed link ("http://…/en/…?token=x") in another language: the same path and token at `locale`'s address. */
function inLocale(link: string | undefined, locale: Locale, fallback: string) {
  if (!link) return at(locale, fallback)
  const url = new URL(link)
  return at(locale, splitLocale(url.pathname).rest + url.search)
}

type Ids = {
  a: string
  b: string
  c: string
  aSlug: string
  bSlug: string
  cSlug: string
  signedContract: string
  unsignedContract: string
  aylaUnpaid: string
  aylaPaid: string
  aylaCancelled: string
}

const NONE = "00000000-0000-0000-0000-000000000000"

async function ids(): Promise<Ids> {
  const first = async (text: string, params: unknown[] = []) => (await sql<{ id: string }>(text, params))[0]?.id ?? NONE
  const slug = async (s: string) => (await sql<{ slug: string }>("select slug from courses where slug = $1", [s]))[0]?.slug ?? s
  const reg = (slugValue: string, extra = "") =>
    first(
      `select r.id from registrations r join members m on m.id = r.member_id join courses c on c.id = r.course_id
        where m.email = $1 and c.slug = $2 ${extra} order by r.created_at desc limit 1`,
      [P2.ayla.email, slugValue],
    )
  return {
    a: await first("select id from courses where slug = $1", [P2.wA.slug]),
    b: await first("select id from courses where slug = $1", [P2.wB.slug]),
    c: await first("select id from courses where slug = $1", [P2.wC.slug]),
    aSlug: await slug(P2.wA.slug),
    bSlug: await slug(P2.wB.slug),
    cSlug: await slug(P2.wC.slug),
    signedContract: await first(
      "select c.id from contracts c join courses w on w.id = c.course_id where w.slug = $1 and c.status = 'signed'",
      [P2.wA.slug],
    ),
    unsignedContract: await first(
      "select c.id from contracts c join courses w on w.id = c.course_id where w.slug = $1 and c.status = 'sent'",
      [SCREENS_WORKSHOP.slug],
    ),
    // Unpaid: her place in D (or her child's in B).
    aylaUnpaid: await first(
      `select r.id from registrations r join members m on m.id = r.member_id join courses c on c.id = r.course_id
        where m.email = $1 and r.status = 'pending' order by (c.slug = $2) desc, r.created_at desc limit 1`,
      [P2.ayla.email, P2.wD.slug],
    ),
    aylaPaid: await reg(P2.wA.slug, "and r.status = 'confirmed'"),
    aylaCancelled: await reg(P2.wB.slug, "and r.status = 'cancelled'"),
  }
}

/** [name, who, path without the locale, also dark and phone]. */
function pages(i: Ids, links: Links): [string, Who, (l: Locale) => string, boolean][] {
  return [
    // The public site, signed out.
    ["site-home", "anon", (l) => at(l, "/"), true],
    ["site-workshops", "anon", (l) => at(l, "/workshops"), true],
    ["site-workshop", "anon", (l) => at(l, `/workshops/${i.bSlug}`), true],
    ["site-workshop-full", "anon", (l) => at(l, `/workshops/${i.aSlug}`), false],
    ["site-workshop-cancelled", "anon", (l) => at(l, `/workshops/${i.cSlug}`), false],
    ["register-signed-out", "anon", (l) => at(l, `/workshops/${i.bSlug}/register`), false],
    // Member account pages, signed out.
    ["account-login", "anon", (l) => at(l, "/account/login"), false],
    ["account-signup", "anon", (l) => at(l, "/account/signup"), false],
    ["account-forgot", "anon", (l) => at(l, "/account/forgot"), false],
    ["account-reset", "anon", (l) => inLocale(links.memberReset, l, "/account/reset?token=missing"), false],
    ["account-reset-invalid", "anon", (l) => at(l, `/account/reset?token=not-a-real-token-${RUN}`), false],
    ["account-verify-invalid", "anon", (l) => at(l, `/account/verify?token=not-a-real-token-${RUN}`), false],
    // A member: registering, the confirmation with the payment instructions, My workshops.
    ["register", "bahar", (l) => at(l, `/workshops/${i.bSlug}/register`), true],
    ["site-workshop-registered", "ayla", (l) => at(l, `/workshops/${i.bSlug}`), false],
    ["confirmation", "ayla", (l) => at(l, `/account/registrations/${i.aylaUnpaid}?welcome=1`), true],
    ["registration-paid", "ayla", (l) => at(l, `/account/registrations/${i.aylaPaid}`), false],
    ["registration-refund", "ayla", (l) => at(l, `/account/registrations/${i.aylaCancelled}`), false],
    ["my-workshops", "ayla", (l) => at(l, "/account"), true],
    // Instructor sign-in pages.
    ["instructor-login", "anon", (l) => at(l, "/instructor/login"), false],
    ["instructor-forgot", "anon", (l) => at(l, "/instructor/forgot"), false],
    ["instructor-reset", "anon", (l) => inLocale(links.instructorReset, l, "/instructor/reset?token=missing"), false],
    ["instructor-reset-invalid", "anon", (l) => at(l, `/instructor/reset?token=not-a-real-token-${RUN}`), false],
    ["instructor-verify-invalid", "anon", (l) => at(l, `/instructor/verify?token=not-a-real-token-${RUN}`), false],
    ["instructor-invite", "anon", (l) => inLocale(links.invite, l, "/instructor/invite?token=missing"), false],
    ["instructor-invite-invalid", "anon", (l) => at(l, `/instructor/invite?token=not-a-real-token-${RUN}`), false],
    // The instructor panel.
    ["instructor-home", "nur", (l) => at(l, "/instructor"), true],
    ["instructor-contracts", "nur", (l) => at(l, "/instructor/contracts"), false],
    ["instructor-contract-sign", "nur", (l) => at(l, `/instructor/contracts/${i.unsignedContract}`), true],
    ["instructor-contract-signed", "nur", (l) => at(l, `/instructor/contracts/${i.signedContract}`), false],
    ["instructor-workshops", "nur", (l) => at(l, "/instructor/workshops"), false],
    ["instructor-workshop", "nur", (l) => at(l, `/instructor/workshops/${i.a}`), false],
    ["instructor-earnings", "nur", (l) => at(l, "/instructor/earnings"), false],
    ["instructor-profile", "nur", (l) => at(l, "/instructor/profile"), false],
    // The admin's new pages.
    ["admin-settings-payments", "admin", (l) => at(l, "/admin/settings/payments"), true],
    ["admin-registrations", "admin", (l) => at(l, `/admin/workshops/${i.a}/registrations`), false],
    ["admin-registrations-b", "admin", (l) => at(l, `/admin/workshops/${i.b}/registrations?status=all`), false],
    ["admin-refunds", "admin", (l) => at(l, "/admin/money/refunds"), false],
    ["admin-refunds-refunded", "admin", (l) => at(l, "/admin/money/refunds?view=refunded"), false],
  ]
}

const NAMESPACES =
  "common|auth|admin|categories|instructors|workshops|contracts|money|settings|templates|dashboard|media|emails|site|account|registration|instructorPanel"
const RAW_KEY = new RegExp(`(^|[\\s>"'(])(${NAMESPACES})\\.[a-z][A-Za-z]+(\\.[A-Za-z_]+)*(?=$|[\\s<"'),.])`, "m")

async function checkPage(page: Page, name: string) {
  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ")
  const raw = RAW_KEY.exec(text)
  expect.soft(raw?.[0] ?? null, `${name}: raw message key on the page`).toBeNull()
  // The settings page explains placeholders on purpose; the contract shows none.
  if (!/settings/.test(name)) {
    const placeholder = /\{(brand|instructor_[a-z_]+|workshop_[a-z_]+|[a-z]+_[a-z_]+|[a-z]+)\}/.exec(text)
    expect.soft(placeholder?.[0] ?? null, `${name}: unfilled placeholder`).toBeNull()
  }
  expect.soft(/\[object Object\]|undefined|NaN/.exec(text)?.[0] ?? null, `${name}: [object Object] / undefined / NaN on the page`).toBeNull()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect.soft(overflow, `${name}: page scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1)
}

function browserErrors(problems: { type: string; text: string }[]) {
  return problems.filter((p) => p.type === "console" || p.type === "pageerror").map((p) => p.text.split("\n")[0])
}

const SESSION: Record<Exclude<Who, "anon" | "admin">, string> = {
  ayla: path.join(E2E_DIR, "p2-session-ayla.json"),
  bahar: path.join(E2E_DIR, "p2-session-bahar.json"),
  nur: path.join(E2E_DIR, "p2-session-nur.json"),
}
const storage = (who: Who) =>
  who === "admin" ? path.join(E2E_DIR, "auth.json") : who === "anon" ? { cookies: [], origins: [] } : SESSION[who]

// ─── Set-up: what the flow specs used up ─────────────────────────────────────

test.describe.serial("phase 2 screens · set-up", () => {
  test("a workshop waiting for Nur's signature, an invitation and two reset links", async ({ page, browser }) => {
    test.skip(!hasSession("nur") || !hasSession("ayla") || !hasSession("bahar"), "run 10–14 first")
    const links = readLinks()
    // An unsigned contract for the sign page.
    if (!(await sql("select 1 from courses where slug = $1", [SCREENS_WORKSHOP.slug])).length) {
      await createWorkshop(page, {
        title: SCREENS_WORKSHOP.title,
        instructor: P2.nur.displayName.en,
        date: 20,
        start: "10:00",
        end: "12:30",
        deadline: [19, "18:00"],
        decision: [18, "12:00"],
        venue: SCREENS_WORKSHOP.venue,
        min: 2,
        max: 6,
        price: "750",
        fee: "200",
      })
    }
    // An invitation not accepted yet (its form).
    if (!links.invite) {
      const mark = mailMark()
      await page.goto("/en/admin/instructors/new")
      await fillInstructor(page, INVITEE)
      await page.getByRole("button", { name: "Add and send invitation" }).click()
      const email = await waitMail(INVITEE.email, mark, /./)
      links.invite = linksOf(email).find((l) => l.includes("/instructor/invite?token="))
    }
    // Reset links, requested and never used (their forms).
    const anon = await anonContext(browser)
    const p = await anon.newPage()
    if (!links.memberReset) {
      const t = tr("en")
      const mark = mailMark()
      await p.goto("/en/account/forgot")
      await p.getByLabel(t("account.form.email")).fill(P2.cemre.email)
      await p.getByRole("button", { name: t("account.forgot.submit") }).click()
      await expect(p.locator("main").getByText(t("account.forgot.sentTitle"))).toBeVisible()
      links.memberReset = linksOf(await waitMail(P2.cemre.email, mark, /./)).find((l) => l.includes("/account/reset?token="))
    }
    if (!links.instructorReset) {
      const t = tr("en")
      const mark = mailMark()
      await p.goto("/en/instructor/forgot")
      await p.getByLabel(t("account.form.email")).fill(P2.derya.email)
      await p.getByRole("button", { name: t("auth.instructor.forgot.submit") }).click()
      await expect(p.locator("main").getByText(t("auth.instructor.forgot.sentTitle"))).toBeVisible()
      links.instructorReset = linksOf(await waitMail(P2.derya.email, mark, /./)).find((l) => l.includes("/instructor/reset?token="))
    }
    await anon.close()
    fs.writeFileSync(LINKS_FILE, JSON.stringify(links, null, 2))
    expect(links.invite).toBeTruthy()
    expect(links.memberReset).toBeTruthy()
    expect(links.instructorReset).toBeTruthy()
  })
})

// ─── Screenshots ─────────────────────────────────────────────────────────────

const variants = [
  { theme: "light", size: "1440", viewport: { width: 1440, height: 900 }, all: true },
  { theme: "dark", size: "1440", viewport: { width: 1440, height: 900 }, all: false },
  { theme: "light", size: "390", viewport: { width: 390, height: 844 }, all: false },
  { theme: "dark", size: "390", viewport: { width: 390, height: 844 }, all: false },
] as const

let IDS: Ids | undefined
const NAMES = pages({} as Ids, {}).map(([name, who, , main]) => ({ name, who, main }))

for (const locale of ["fa", "tr"] as const) {
  for (const v of variants) {
    for (const who of ["anon", "ayla", "bahar", "nur", "admin"] as const) {
      const list = NAMES.filter((p) => p.who === who && (v.all || p.main))
      if (!list.length) continue
      test.describe(`p2 ${locale} ${v.theme} ${v.size} · ${who}`, () => {
        test.use({
          viewport: v.viewport,
          colorScheme: v.theme,
          storageState: storage(who),
          // Every group its own client address (the site's rate limits are per network).
          extraHTTPHeaders: { "x-real-ip": `10.96.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
          ...(v.size === "390" ? { isMobile: true, hasTouch: true } : {}),
        })
        for (const { name } of list) {
          const file = `p2-${name}-${locale}-${v.theme}-${v.size}`
          test(file, async ({ page, problems }) => {
            test.skip(who !== "anon" && who !== "admin" && !fs.existsSync(SESSION[who]), `no saved session for ${who}: run 10–14 first`)
            IDS ??= await ids()
            const url = pages(IDS, readLinks()).find(([n]) => n === name)![2](locale)
            const res = await page.goto(url)
            expect.soft(res?.status(), `${name}: HTTP status of ${url}`).toBeLessThan(400)
            await settle(page)
            await page.waitForTimeout(500)
            await expect(page.locator("html")).toHaveAttribute("lang", locale)
            await expect(page.locator("html")).toHaveAttribute("dir", locale === "fa" ? "rtl" : "ltr")
            // Still where we meant to be (not sent to a login page).
            expect.soft(new URL(page.url()).pathname, `${name}: redirected`).toBe(new URL(url, "http://x").pathname)
            await checkPage(page, name)
            fs.mkdirSync(SCREENS, { recursive: true })
            await page.screenshot({ path: path.join(SCREENS, `${file}.png`), fullPage: true })
            expect.soft(browserErrors(problems), `${name}: browser errors`).toEqual([])
          })
        }
      })
    }
  }
}

// Right-to-left and phone details the screenshots show, checked directly.
test.describe("p2 layout details", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("the site header on a phone: brand, Workshops, language and account fit in one row", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    for (const locale of ["fa", "tr"] as const) {
      await page.goto(at(locale, "/workshops"))
      await settle(page)
      const header = page.locator("header").first()
      const box = await header.boundingBox()
      expect.soft(box?.height ?? 0, `${locale}: header height`).toBeLessThanOrEqual(80)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect.soft(overflow, `${locale}: page scrolls sideways`).toBeLessThanOrEqual(1)
    }
  })

  test("the brand keeps its room on small phones, signed out and signed in", async ({ browser }) => {
    // On a phone the language and account buttons show only their icon, so
    // the brand gets all it needs, or at least what "Lart Atölye" needs (85 px).
    for (const who of ["anon", "ayla"] as const) {
      if (who === "ayla" && !hasSession("ayla")) continue
      for (const width of [320, 360, 390]) {
        const options = { viewport: { width, height: 800 } }
        const context = who === "anon" ? await anonContext(browser, options) : await personContext(browser, who, options)
        const page = await context.newPage()
        for (const locale of ["fa", "tr", "en"] as const) {
          await page.goto(at(locale, "/"))
          await settle(page)
          const brand = page.locator("header").first().getByRole("link").first()
          const { room, needs } = await brand.evaluate((el) => ({ room: el.clientWidth, needs: el.scrollWidth }))
          expect.soft(room, `${who} ${width}px ${locale}: room for the brand (needs ${needs})`).toBeGreaterThanOrEqual(Math.min(needs, 85))
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
          expect.soft(overflow, `${who} ${width}px ${locale}: page scrolls sideways`).toBeLessThanOrEqual(1)
        }
        await context.close()
      }
    }
  })
})
