import type { Page } from "@playwright/test"

import { chooseSelect, expect, field, fillDateTime, fillLocalized, istanbulDate, mailMark, RUN, test, toast } from "./helpers/app"
import { one, sql } from "./helpers/db"
import { linksOf, P2, waitMail } from "./helpers/p2"

/**
 * Phase 2, admin side, set-up: Settings → Payments (cash, bank transfer with a
 * checked IBAN, online payment link), a category, two instructors invited by
 * email, and four workshops (A: two places and an online payment link, B, C
 * of the second instructor, D for the day-before reminder). Later specs build
 * on these (11 instructor panel, 12 students, 13 admin registrations).
 */

const DAY = 86_400_000
const inDays = (n: number) => istanbulDate(new Date(Date.now() + n * DAY))
const CATEGORY = { fa: `سفال‌گری ${RUN}`, tr: `Atölye P2 ${RUN}`, en: `Workshop P2 ${RUN}` }

type Teacher = (typeof P2)["nur"]

async function fillInstructor(page: Page, p: Teacher) {
  await fillLocalized(page, "Display name", p.displayName)
  await fillLocalized(page, "Teaching field", p.teachingField)
  await field(page, "Official full name").getByRole("textbox").fill(p.officialName)
  await field(page, "ID number").getByRole("textbox").fill(p.idNumber)
  await field(page, "Mobile number").getByRole("textbox").fill(p.mobile)
  await field(page, /^Email/).getByRole("textbox").fill(p.email)
}

type WorkshopInput = {
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

async function createWorkshop(page: Page, w: WorkshopInput) {
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

test.describe.serial("phase 2 · admin set-up", () => {
  test("Settings → Payments: a wrong IBAN is refused, then bank transfer and online payment are switched on", async ({ page }) => {
    // Start from the defaults (cash only), also when the suite runs again on the same database.
    await sql("delete from settings where key = 'payment'")
    await page.goto("/en/admin/settings/payments")
    await expect(page.getByRole("link", { name: "Payments" })).toHaveAttribute("aria-current", "page")
    const save = page.getByRole("button", { name: "Save changes" })
    await expect(save).toBeDisabled()
    // Cash is on by default; the preview shows what students see.
    const preview = page.getByRole("region", { name: "What students see" })
    await expect(preview).toContainText("Cash at the workshop")

    const transfer = page.getByRole("switch", { name: /^Bank transfer/ })
    await transfer.click()
    await expect(transfer).toBeChecked()
    // Turned on with nothing filled in: holder and IBAN are required.
    await save.click()
    await expect(field(page, /^Account holder/)).toContainText("Please write the account holder’s name.")
    await expect(field(page, /^IBAN/)).toContainText("Please write the IBAN.")

    await field(page, /^Account holder/).getByRole("textbox").fill(`Lart Sanat ${RUN}`)
    await field(page, /^Bank$/).getByRole("textbox").fill("Ziraat Bankası")
    const iban = field(page, /^IBAN/).getByRole("textbox")
    // Not Turkish, too short, a mistyped digit: each explained.
    await iban.fill("DE89370400440532013000")
    await save.click()
    await expect(field(page, /^IBAN/)).toContainText("The IBAN should start with TR.")
    await iban.fill("TR33 0006 1005")
    await save.click()
    await expect(field(page, /^IBAN/)).toContainText("A Turkish IBAN is TR followed by 24 digits.")
    await iban.fill(P2.iban.typo.toLowerCase())
    await save.click()
    await expect(field(page, /^IBAN/)).toContainText("This IBAN doesn’t add up")
    expect(await sql("select 1 from settings where key = 'payment' and value->'transfer'->>'enabled' = 'true'")).toHaveLength(0)

    // Persian digits and spaces are fine; shown in groups of four once it leaves the field.
    await iban.fill("tr33 ۰۰۰۶ 1005 1978 6457 8413 26")
    await iban.blur()
    await expect(iban).toHaveValue("TR33 0006 1005 1978 6457 8413 26")
    await expect(field(page, /^IBAN/).getByLabel("This IBAN looks right")).toBeVisible()
    await fillLocalized(page, /^Note for students/, {
      fa: "لطفاً تا دو روز پس از ثبت‌نام واریز کنید.",
      tr: "Lütfen kayıttan sonraki iki gün içinde gönderin.",
      en: "Please send it within two days of registering.",
    })
    await expect(preview).toContainText("TR33 0006 1005 1978 6457 8413 26")

    const online = page.getByRole("switch", { name: /^Online payment link/ })
    await online.click()
    await expect(online).toBeChecked()
    await fillLocalized(page.locator("section").filter({ has: online }), /^Note for students/, {
      tr: "iyzico size e-postayla makbuz gönderir.",
      en: "You’ll get a receipt from iyzico by email.",
    })
    await expect(preview).toContainText("Pay online")
    await save.click()
    await expect(toast(page, "Settings saved.")).toBeVisible()
    await expect(save).toBeDisabled()

    const saved = await one<{ value: { cash: boolean; transfer: Record<string, unknown>; online: Record<string, unknown> } }>(
      "select value from settings where key = 'payment'",
    )
    expect(saved.value.cash).toBe(true)
    expect(saved.value.transfer).toMatchObject({ enabled: true, iban: P2.iban.valid, accountHolder: `Lart Sanat ${RUN}`, bankName: "Ziraat Bankası" })
    expect(saved.value.online).toMatchObject({ enabled: true })

    // At least one way stays on: switching all off is refused.
    await page.reload()
    await expect(page.getByRole("switch", { name: /^Cash at the workshop/ })).toBeChecked()
    await expect(field(page, /^IBAN/).getByRole("textbox")).toHaveValue("TR33 0006 1005 1978 6457 8413 26")
  })

  test("a category for the phase-2 workshops", async ({ page }) => {
    if ((await sql("select 1 from categories where name->>'en' = $1", [CATEGORY.en])).length) return
    await page.goto("/en/admin/categories/new")
    await fillLocalized(page, "Category name", CATEGORY)
    await page.getByRole("button", { name: "Create category" }).click()
    await expect(toast(page, "Category created.")).toBeVisible()
  })

  test("invite two instructors: the invitation emails carry a one-time link in their language", async ({ page }) => {
    for (const [p, lang, locale] of [
      [P2.nur, "Türkçe", "tr"],
      [P2.derya, "فارسی", "fa"],
    ] as const) {
      const mark = mailMark()
      await page.goto("/en/admin/instructors/new")
      await fillInstructor(page, p)
      await field(page, "Email language").getByRole("radio", { name: lang }).click()
      await page.getByRole("button", { name: "Add and send invitation" }).click()
      await expect(toast(page, "Instructor added. We’ve emailed them their invitation.")).toBeVisible()
      const email = await waitMail(p.email, mark, /./)
      const link = linksOf(email).find((l) => l.includes("/instructor/accept-invite?token="))
      expect(link, `invite link in ${linksOf(email).join(" ")}`).toMatch(new RegExp(`^http://localhost:3100/${locale}/instructor/accept-invite\\?token=[\\w-]{20,}$`))
      const row = await one<{ password_hash: string | null; locale: string }>("select password_hash, locale from instructors where email = $1", [p.email])
      expect(row.password_hash).toBeNull()
      // The invitation's language is not stored: instructors.locale stays the default until the
      // instructor accepts (emails sent before that, e.g. contract_ready, go in that default).
      test.info().annotations.push({ type: `locale after invite (${locale})`, description: row.locale })
    }
  })

  test("workshop form: the online payment link is checked and stored", async ({ page }) => {
    const mark = mailMark()
    await page.goto("/en/admin/workshops/new")
    // A link without https is refused on the field.
    await fillLocalized(page, /^Workshop name/, P2.wA.title)
    await field(page, /^Online payment link/).getByRole("textbox").fill("iyzi.link/abc")
    await page.getByRole("button", { name: "Create and send contract" }).click()
    await expect(field(page, /^Online payment link/)).toContainText("Please paste the whole payment link, starting with https://.")

    await createWorkshop(page, {
      title: P2.wA.title,
      instructor: P2.nur.displayName.en,
      date: 10,
      start: "10:00",
      end: "13:00",
      deadline: [9, "18:00"],
      decision: [8, "12:00"],
      venue: P2.wA.venue,
      min: 1,
      max: 2,
      price: "1000",
      fee: "300",
      paymentUrl: P2.wA.paymentUrl,
      intro: {
        fa: "روی بشقاب سفالی نقاشی می‌کنیم.",
        tr: "Seramik tabak boyuyoruz. Tüm malzemeler bizden.",
        en: "We paint ceramic plates. All materials provided.",
      },
    })
    const a = await one<{ payment_url: string; price: string; status: string }>("select payment_url, price, status from courses where slug = $1", [P2.wA.slug])
    expect(a).toMatchObject({ payment_url: P2.wA.paymentUrl, status: "awaiting_signature" })
    expect(Number(a.price)).toBe(100_000)
    // The overview shows the link.
    await expect(page.locator("main")).toContainText(P2.wA.paymentUrl)
    // The contract email went to Nur, in Turkish, with a link to the panel.
    const email = await waitMail(P2.nur.email, mark, /./)
    expect(linksOf(email).join(" ")).toMatch(/\/tr\/instructor\/contracts\/[0-9a-f-]{36}/)
  })

  test("workshops B, C and D", async ({ page }) => {
    await createWorkshop(page, {
      title: P2.wB.title,
      instructor: P2.nur.displayName.en,
      date: 12,
      start: "14:00",
      end: "17:00",
      deadline: [11, "18:00"],
      decision: [11, "20:00"],
      venue: P2.wB.venue,
      min: 2,
      max: 10,
      price: "800",
      fee: "250",
      paymentUrl: P2.wB.paymentUrl,
    })
    await createWorkshop(page, {
      title: P2.wC.title,
      instructor: P2.derya.displayName.en,
      date: 14,
      start: "11:00",
      end: "13:30",
      deadline: [13, "18:00"],
      decision: [13, "19:00"],
      venue: P2.wC.venue,
      min: 3,
      max: 6,
      price: "600",
      fee: "200",
    })
    await createWorkshop(page, {
      title: P2.wD.title,
      instructor: P2.nur.displayName.en,
      date: 5,
      start: "18:00",
      end: "20:00",
      deadline: [4, "18:00"],
      decision: [3, "12:00"],
      venue: P2.wD.venue,
      min: 1,
      max: 8,
      price: "500",
      fee: "100",
    })
    const rows = await sql<{ slug: string; status: string }>("select slug, status from courses where slug = any($1) order by slug", [
      [P2.wB.slug, P2.wC.slug, P2.wD.slug],
    ])
    expect(rows.map((r) => r.status)).toEqual(["awaiting_signature", "awaiting_signature", "awaiting_signature"])
  })
})
