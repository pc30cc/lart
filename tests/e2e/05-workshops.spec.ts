import type { Page } from "@playwright/test"

import {
  chooseSelect,
  emailsSince,
  expect,
  field,
  fillDateTime,
  fillLocalized,
  istanbulDate,
  mailMark,
  RUN,
  shot,
  test,
  toast,
} from "./helpers/app"
import { CATEGORIES, INSTRUCTORS, WORKSHOPS } from "./helpers/data"
import { one, sql } from "./helpers/db"
import { makePhoto } from "./helpers/files"
import { payRegistrations, signContract } from "./helpers/scripts"

const DAY = 86_400_000
const inDays = (n: number) => istanbulDate(new Date(Date.now() + n * DAY))

async function workshopId(slug: string) {
  return (await one<{ id: string }>("select id from courses where slug = $1", [slug])).id
}

async function liveContract(courseId: string) {
  return one<{ id: string; version: number; status: string }>(
    "select id, version, status from contracts where course_id = $1 and status <> 'void'",
    [courseId],
  )
}

/** Members and registrations, as the public site will create them in phase 2. */
async function addRegistrations(courseId: string, prefix: string, people: { name: string; status: "confirmed" | "pending"; photo?: boolean; video?: boolean }[]) {
  const course = await one<{ price: string; terms_template_id: string | null }>("select price, terms_template_id from courses where id = $1", [courseId])
  const terms = course.terms_template_id ?? (await one<{ id: string }>("select id from templates where kind = 'terms' and is_default")).id
  const ids: { id: string; status: string }[] = []
  for (const [i, p] of people.entries()) {
    const email = `${prefix}${i + 1}.${RUN}@member.test`
    const [member] = await sql<{ id: string }>(
      `insert into members (email, password_hash, name, phone, email_verified_at)
       values ($1, 'not-a-real-hash', $2, '+905550000000', now()) returning id`,
      [email, p.name],
    )
    const [reg] = await sql<{ id: string }>(
      `insert into registrations (course_id, member_id, participant_name, status, amount, terms_template_id, terms_sha256,
         terms_accepted_at, photo_consent, video_consent, paid_at)
       values ($1, $2, $3, $4::registration_status, $5, $6, repeat('a', 64), now(), $7, $8, case when $4::text = 'confirmed' then now() end) returning id`,
      [courseId, member.id, p.name, p.status, Number(course.price), terms, Boolean(p.photo), Boolean(p.video)],
    )
    ids.push({ id: reg.id, status: p.status })
  }
  return ids
}

async function uploadIn(page: Page, label: string, files: string[], expectImages: number) {
  const box = field(page, label)
  await box.locator('input[type="file"]').setInputFiles(files)
  await expect(box.getByRole("img")).toHaveCount(expectImages, { timeout: 60_000 })
  await expect(box.getByText(/Uploading|Optimizing/)).toHaveCount(0, { timeout: 60_000 })
}

test.describe.serial("workshops", () => {
  test("prerequisites are met (category, instructor, contract template)", async ({ page }) => {
    await page.goto("/en/admin/workshops")
    await expect(page.getByRole("heading", { level: 1, name: "Workshops" })).toBeVisible()
    await expect(page.getByText("A few things first")).toHaveCount(0)
  })

  test("create the candle workshop with every field (fixed fee + advance)", async ({ page }) => {
    const cover = await makePhoto("cover.jpg", 2400, 1300, 30)
    const s1 = await makePhoto("sample1.jpg", 1200, 900, 90)
    const s2 = await makePhoto("sample2.jpg", 900, 1200, 300)
    const mark = mailMark()
    const w = WORKSHOPS.held

    await page.goto("/en/admin/workshops/new")
    await expect(page.getByRole("heading", { level: 1, name: "New workshop" })).toBeVisible()
    // Submitting empty shows the friendly messages.
    await page.getByRole("button", { name: "Create and send contract" }).click()
    await expect(page.getByText("Please choose a category.")).toBeVisible()
    await expect(page.getByText("Please choose an instructor.")).toBeVisible()

    await fillLocalized(page, /^Workshop name/, w.title)
    await chooseSelect(page, /^Category/, CATEGORIES.candles.en)
    await chooseSelect(page, /^Instructor/, INSTRUCTORS.elif.displayName.en)
    await expect(field(page, /^Page address/).getByRole("textbox")).toHaveValue(w.slug)

    await fillDateTime(page, /^Date and time/, inDays(10), "10:00", "13:00")
    await fillDateTime(page, /^Registration closes/, inDays(9), "18:00")
    await fillDateTime(page, /^Go \/ no-go decision/, inDays(8), "12:00")
    // The weekday is shown with the date.
    await expect(field(page, /^Date and time/).locator("button").first()).toContainText(
      new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "Europe/Istanbul" }).format(new Date(Date.now() + 10 * DAY)),
    )

    await field(page, /^Place/).getByRole("textbox").fill(`Moda Art House, Kadıköy ${RUN}`)
    await page.getByRole("radio", { name: /Children/ }).click()
    await field(page, /^From age/).getByRole("spinbutton").fill("8")
    await field(page, /^To age/).getByRole("spinbutton").fill("14")
    await field(page, /^Minimum participants/).getByRole("spinbutton").fill("2")
    await field(page, /^Maximum participants/).getByRole("spinbutton").fill("8")
    await field(page, /^Price per person/).getByRole("textbox").fill("1500")
    await chooseSelect(page, /^Registration terms/, "Default terms")

    await fillLocalized(page, /^Short introduction/, {
      fa: "در این کارگاه شمع سویا می‌سازیم.",
      tr: "Bu atölyede soya mumu yapıyoruz.",
      en: "In this workshop we make soy candles.",
    })
    await fillLocalized(page, /^What the price includes/, { fa: "مواد و ابزار", tr: "Malzeme ve aletler", en: "Materials and tools" })
    await fillLocalized(page, /^What to bring/, { fa: "پیش‌بند", tr: "Önlük", en: "An apron" })
    await page.getByRole("switch", { name: /Previous experience needed/ }).click()
    await fillLocalized(page, /^What should they know\?/, { fa: "هیچ", tr: "Temel bilgi", en: "Basic knowledge" })
    await fillLocalized(page, /^Additional notes/, { fa: "یادداشت", tr: "Not", en: "Parking nearby." })

    await uploadIn(page, "Cover photo", [cover], 1)
    await uploadIn(page, "Sample work", [s1, s2], 2)

    await page.getByRole("radio", { name: /Fixed for the workshop/ }).click()
    await field(page, /^Amount for the whole workshop/).getByRole("textbox").fill("3000")
    await page.getByRole("switch", { name: /Advance payment/ }).click()
    await expect(field(page, /^Advance amount/)).toContainText("At most ₺3,000")
    await field(page, /^Advance amount/).getByRole("textbox").fill("4000")
    await page.getByRole("button", { name: "Create and send contract" }).click()
    await expect(field(page, /^Advance amount/)).toContainText("The advance can’t be more than the total fee")
    await field(page, /^Advance amount/).getByRole("textbox").fill("1000")

    await page.getByRole("button", { name: "Create and send contract" }).click()
    await expect(toast(page, `Workshop created. The contract is on its way to ${INSTRUCTORS.elif.displayName.en}.`)).toBeVisible()
    await expect(page).toHaveURL(/\/en\/admin\/workshops\/[0-9a-f-]{36}$/)

    const id = await workshopId(w.slug)
    const course = await one<Record<string, unknown>>("select * from courses where id = $1", [id])
    expect(course).toMatchObject({ status: "awaiting_signature", age_min: 8, age_max: 14, min_capacity: 2, max_capacity: 8, experience_required: true })
    expect(Number(course.price)).toBe(150_000)
    expect(course.cover_path).toMatch(/^courses\//)
    const samples = await sql("select 1 from media where course_id = $1 and kind = 'sample'", [id])
    expect(samples).toHaveLength(2)
    const contract = await one<{ fee_type: string; fee_amount: string; advance_amount: string; version: number }>(
      "select * from contracts where course_id = $1",
      [id],
    )
    expect(contract).toMatchObject({ fee_type: "fixed", version: 1 })
    expect(Number(contract.fee_amount)).toBe(300_000)
    expect(Number(contract.advance_amount)).toBe(100_000)

    // The contract email went to the instructor.
    await expect.poll(() => emailsSince(mark).filter((e) => [e.to].flat().includes(INSTRUCTORS.elif.email)).length).toBe(1)
    const email = emailsSince(mark).find((e) => [e.to].flat().includes(INSTRUCTORS.elif.email))!
    expect(email.html).toMatch(/\/instructor\/contracts\//)

    await expect(page.getByText(`Waiting for ${INSTRUCTORS.elif.displayName.en} to sign`)).toBeVisible()
  })

  test("create the pottery workshop (per-participant fee)", async ({ page }) => {
    const w = WORKSHOPS.cancelled
    await page.goto("/en/admin/workshops/new")
    await fillLocalized(page, /^Workshop name/, w.title)
    await chooseSelect(page, /^Category/, CATEGORIES.ceramics.en.replace("Ceramics", "Ceramics and pottery"))
    await chooseSelect(page, /^Instructor/, INSTRUCTORS.sara.displayName.en)
    await fillDateTime(page, /^Date and time/, inDays(14), "14:00", "17:30")
    await fillDateTime(page, /^Registration closes/, inDays(12), "20:00")
    await fillDateTime(page, /^Go \/ no-go decision/, inDays(12), "21:00")
    await field(page, /^Place/).getByRole("textbox").fill("Clay Studio, Beşiktaş")
    await field(page, /^Minimum participants/).getByRole("spinbutton").fill("3")
    await field(page, /^Maximum participants/).getByRole("spinbutton").fill("6")
    await field(page, /^Price per person/).getByRole("textbox").fill("900")
    await page.getByRole("switch", { name: /Nothing needed/ }).click()
    await expect(page.getByRole("radio", { name: /Per participant/ })).toBeChecked()
    await field(page, /^Amount per participant/).getByRole("textbox").fill("400")
    await expect(field(page, /^Amount per participant/)).toContainText("With a full workshop this comes to ₺2,400")
    await page.getByRole("button", { name: "Create and send contract" }).click()
    await expect(toast(page, /Workshop created\./)).toBeVisible()
    const id = await workshopId(w.slug)
    const contract = await one<{ fee_type: string; fee_amount: string; advance_amount: string }>("select * from contracts where course_id = $1", [id])
    expect(contract.fee_type).toBe("per_participant")
    expect(Number(contract.fee_amount)).toBe(40_000)
    expect(Number(contract.advance_amount)).toBe(0)
  })

  test("a duplicate page address and a past date are refused", async ({ page }) => {
    await page.goto("/en/admin/workshops/new")
    await fillLocalized(page, /^Workshop name/, WORKSHOPS.held.title)
    await chooseSelect(page, /^Category/, CATEGORIES.candles.en)
    await chooseSelect(page, /^Instructor/, INSTRUCTORS.elif.displayName.en)
    await fillDateTime(page, /^Date and time/, inDays(-1), "10:00", "11:00")
    await fillDateTime(page, /^Registration closes/, inDays(-2), "10:00")
    await fillDateTime(page, /^Go \/ no-go decision/, inDays(-2), "11:00")
    await field(page, /^Place/).getByRole("textbox").fill("Somewhere")
    await field(page, /^Minimum participants/).getByRole("spinbutton").fill("1")
    await field(page, /^Maximum participants/).getByRole("spinbutton").fill("2")
    await field(page, /^Price per person/).getByRole("textbox").fill("100")
    await field(page, /^Amount per participant/).getByRole("textbox").fill("10")
    await page.getByRole("button", { name: "Create and send contract" }).click()
    await expect(page.getByText("Please choose a date and time in the future.")).toBeVisible()
    await fillDateTime(page, /^Date and time/, inDays(20), "10:00", "11:00")
    await page.getByRole("button", { name: "Create and send contract" }).click()
    await expect(field(page, /^Page address/)).toContainText("Another workshop already uses this page address")
  })

  test("contract page and print view", async ({ page }) => {
    const id = await workshopId(WORKSHOPS.held.slug)
    await page.goto(`/en/admin/workshops/${id}/contract`)
    const doc = page.locator("article").first()
    await expect(page.getByText("Not signed yet. This is the text as the instructor sees it now.")).toBeVisible()
    await expect(page.locator("main")).toContainText(INSTRUCTORS.elif.officialName)
    await expect(page.locator("main")).toContainText(INSTRUCTORS.elif.idNumber)
    await expect(page.locator("main")).toContainText(`Moda Art House, Kadıköy ${RUN}`)
    await expect(page.locator("main")).toContainText("₺3,000")
    await expect(page.locator("main")).toContainText("₺1,000")
    await expect(page.locator("main")).not.toContainText(/\{[a-z_]+\}/)
    test.info().annotations.push({ type: "contract-article", description: String(await doc.count()) })

    // Persian version of the text.
    await page.getByRole("link", { name: "فارسی" }).click()
    await expect(page).toHaveURL(/lang=fa/)
    await expect(page.locator("main [dir=rtl], main [lang=fa]").first()).toBeVisible()

    // Print: only the contract.
    await page.goto(`/en/admin/workshops/${id}/contract`)
    await page.emulateMedia({ media: "print" })
    await expect(page.getByRole("button", { name: "Print" })).toBeHidden()
    await expect(page.getByRole("navigation", { name: "You are here" })).toBeHidden()
    await shot(page, "contract-print-en-light-1440")
    await page.emulateMedia({ media: "screen" })
  })

  test("editing a contract field warns and sends version 2", async ({ page }) => {
    const id = await workshopId(WORKSHOPS.held.slug)
    const mark = mailMark()
    await page.goto(`/en/admin/workshops/${id}/edit`)
    // A text-only change does not touch the contract.
    await fillLocalized(page, /^Additional notes/, { en: "Parking nearby. Tea is served." })
    await expect(page.getByText("These changes update the contract")).toHaveCount(0)
    await field(page, /^Place/).getByRole("textbox").fill(`Moda Art House, Studio 2, Kadıköy ${RUN}`)
    await expect(page.getByText("These changes update the contract")).toBeVisible()
    await expect(page.getByText("Contract version 1 hasn’t been signed yet.")).toBeVisible()
    await page.getByRole("button", { name: "Save changes" }).click()
    const dialog = page.getByRole("alertdialog")
    await expect(dialog).toContainText("Send a new contract?")
    await expect(dialog).toContainText("version 2")
    await dialog.getByRole("button", { name: "Yes, save and send" }).click()
    await expect(toast(page, `Changes saved. Contract version 2 is on its way to ${INSTRUCTORS.elif.displayName.en}.`)).toBeVisible()

    const versions = await sql<{ version: number; status: string }>("select version, status from contracts where course_id = $1 order by version", [id])
    expect(versions).toEqual([
      { version: 1, status: "void" },
      { version: 2, status: "sent" },
    ])
    await expect.poll(() => emailsSince(mark).filter((e) => [e.to].flat().includes(INSTRUCTORS.elif.email)).length).toBe(1)

    await page.goto(`/en/admin/workshops/${id}/contract`)
    await expect(page.locator("main")).toContainText(`Studio 2, Kadıköy ${RUN}`)
    await expect(page.getByText("All versions")).toBeVisible()
  })

  test("the instructors sign (phase-2 stand-in) and the workshops are published", async ({ page }) => {
    for (const [w, who] of [
      [WORKSHOPS.held, INSTRUCTORS.elif],
      [WORKSHOPS.cancelled, INSTRUCTORS.sara],
    ] as const) {
      const id = await workshopId(w.slug)
      const contract = await liveContract(id)
      const mark = mailMark()
      const result = signContract(contract.id, who.officialName, "tr")
      expect(result.courseId).toBe(id)
      expect(result.sha256).toMatch(/^[0-9a-f]{64}$/)
      const course = await one<{ status: string; published_at: Date | null }>("select status, published_at from courses where id = $1", [id])
      expect(course.status).toBe("published")
      expect(course.published_at).not.toBeNull()
      // The admins are told.
      await expect.poll(() => emailsSince(mark).filter((e) => [e.to].flat().includes("owner@lart.test")).length).toBeGreaterThanOrEqual(1)

      await page.goto(`/en/admin/workshops/${id}`)
      await expect(page.getByText("Registration is open")).toBeVisible()
    }
    // Signed contract page shows the evidence.
    const id = await workshopId(WORKSHOPS.held.slug)
    await page.goto(`/en/admin/workshops/${id}/contract`)
    await expect(page.getByText(`Signed electronically by ${INSTRUCTORS.elif.officialName}`)).toBeVisible()
    await expect(page.getByText("203.0.113.7")).toBeVisible()
  })

  test("registrations arrive and are paid (phase-2 stand-in)", async ({ page }) => {
    const held = await workshopId(WORKSHOPS.held.slug)
    const pottery = await workshopId(WORKSHOPS.cancelled.slug)
    const a = await addRegistrations(held, "ayse", [
      { name: "Ayşe Kaya", status: "confirmed", photo: true, video: true },
      { name: "Zeynep Arslan", status: "confirmed", photo: true },
      { name: "Mina Rahimi", status: "confirmed" },
      { name: "Leyla Demir", status: "pending" },
    ])
    const b = await addRegistrations(pottery, "pot", [
      { name: "Deniz Acar", status: "confirmed" },
      { name: "Sima Karimi", status: "confirmed", photo: true },
      { name: "Ece Yildiz", status: "pending" },
    ])
    const paid = [...a, ...b].filter((r) => r.status === "confirmed").map((r) => r.id)
    const txIds = payRegistrations(paid)
    expect(txIds).toHaveLength(5)
    const revenue = await one<{ sum: string }>(
      "select sum(-l.amount) as sum from ledger_lines l join ledger_transactions t on t.id = l.transaction_id where l.account = 'revenue' and t.course_id = $1",
      [held],
    )
    expect(Number(revenue.sum)).toBe(450_000)

    await page.goto(`/en/admin/workshops/${held}/registrations`)
    for (const name of ["Ayşe Kaya", "Zeynep Arslan", "Mina Rahimi", "Leyla Demir"]) await expect(page.getByText(name).first()).toBeVisible()
    await page.goto(`/en/admin/workshops/${held}`)
    await expect(page.getByText("3 of 8").first()).toBeVisible()
  })

  test("go decision: confirm the candle workshop", async ({ page }) => {
    const id = await workshopId(WORKSHOPS.held.slug)
    await page.goto(`/en/admin/workshops/${id}`)
    await page.getByRole("button", { name: "Confirm workshop" }).click()
    const dialog = page.getByRole("alertdialog")
    await expect(dialog).toContainText("3 people have registered.")
    await dialog.getByRole("button", { name: "Yes, it goes ahead" }).click()
    await expect(toast(page, "Workshop confirmed.")).toBeVisible()
    await expect(page.getByText("Confirmed: it’s happening!")).toBeVisible()
    const course = await one<{ status: string; final_participants: number }>("select status, final_participants from courses where id = $1", [id])
    expect(course).toEqual({ status: "confirmed", final_participants: 3 })
  })

  test("no-go: cancel the pottery workshop, cancellation emails", async ({ page }) => {
    const id = await workshopId(WORKSHOPS.cancelled.slug)
    const mark = mailMark()
    await page.goto(`/en/admin/workshops/${id}`)
    await page.getByRole("button", { name: "Cancel workshop" }).click()
    const dialog = page.getByRole("alertdialog")
    await expect(dialog).toContainText("3 registrations will be cancelled.")
    await dialog.getByRole("button", { name: "Yes, cancel it" }).click()
    await expect(toast(page, "Workshop cancelled.")).toBeVisible()
    await expect(page.getByText("This workshop was cancelled")).toBeVisible()

    const regs = await sql<{ status: string; refund_amount: string | null }>(
      "select status, refund_amount from registrations where course_id = $1 order by participant_name",
      [id],
    )
    expect(regs.every((r) => r.status === "cancelled")).toBe(true)
    expect(regs.map((r) => Number(r.refund_amount))).toEqual([90_000, 0, 90_000])

    // One email per paid member, sent after the response.
    await expect.poll(() => emailsSince(mark).filter((e) => /@member\.test$/.test(String([e.to].flat()[0]))).length, { timeout: 15_000 }).toBe(2)
    const emails = emailsSince(mark).filter((e) => /@member\.test$/.test(String([e.to].flat()[0])))
    for (const e of emails) {
      expect(e.text).toContain("₺900")
      expect(e.subject).toContain(WORKSHOPS.cancelled.title.en)
    }
    test.info().annotations.push({ type: "cancellation-email", description: `${emails[0].subject}\n${emails[0].text}` })
    // The member who had not paid yet is not told.
    const pendingTold = emailsSince(mark).some((e) => [e.to].flat().includes(`pot3.${RUN}@member.test`))
    test.info().annotations.push({ type: "pending-member-emailed", description: String(pendingTold) })
  })

  test("a category or instructor in use cannot be deleted", async ({ page }) => {
    const { id } = await one<{ id: string }>("select id from categories where slug = $1", [CATEGORIES.candles.slug])
    await page.goto(`/en/admin/categories/${id}`)
    await expect(page.getByText("1 workshop uses this category, so it can’t be deleted.")).toBeVisible()
    await expect(page.getByRole("button", { name: "Delete category" })).toBeDisabled()

    const elif = await one<{ id: string }>("select id from instructors where email = $1", [INSTRUCTORS.elif.email])
    await page.goto(`/en/admin/instructors/${elif.id}`)
    await expect(page.getByText("They have workshops or contracts, so they can’t be deleted.")).toBeVisible()
  })

  test("list views: upcoming, confirmed, cancelled", async ({ page }) => {
    await page.goto("/en/admin/workshops?view=confirmed")
    await expect(page.getByRole("link", { name: new RegExp(WORKSHOPS.held.title.en) }).first()).toBeVisible()
    await page.goto("/en/admin/workshops?view=cancelled")
    await expect(page.getByRole("link", { name: new RegExp(WORKSHOPS.cancelled.title.en) }).first()).toBeVisible()
    await page.goto(`/en/admin/workshops?view=all&q=${encodeURIComponent(WORKSHOPS.held.title.en)}`)
    await expect(page.getByRole("link", { name: new RegExp(WORKSHOPS.cancelled.title.en) })).toHaveCount(0)
  })

  test("a third workshop stays open for registration (upcoming)", async ({ page }) => {
    const w = WORKSHOPS.open
    await page.goto("/en/admin/workshops/new")
    await fillLocalized(page, /^Workshop name/, w.title)
    await chooseSelect(page, /^Category/, CATEGORIES.ceramics.en.replace("Ceramics", "Ceramics and pottery"))
    await chooseSelect(page, /^Instructor/, INSTRUCTORS.sara.displayName.en)
    await fillDateTime(page, /^Date and time/, inDays(21), "11:00", "14:00")
    await fillDateTime(page, /^Registration closes/, inDays(19), "20:00")
    await fillDateTime(page, /^Go \/ no-go decision/, inDays(19), "21:00")
    await field(page, /^Place/).getByRole("textbox").fill("Karaköy Atelier, Beyoğlu")
    await field(page, /^Minimum participants/).getByRole("spinbutton").fill("2")
    await field(page, /^Maximum participants/).getByRole("spinbutton").fill("10")
    await field(page, /^Price per person/).getByRole("textbox").fill("1200")
    await fillLocalized(page, /^Short introduction/, { fa: "نقاشی با آبرنگ.", tr: "Suluboya ile manzara.", en: "Landscapes in watercolour." })
    await field(page, /^Amount per participant/).getByRole("textbox").fill("450")
    await page.getByRole("button", { name: "Create and send contract" }).click()
    await expect(toast(page, /Workshop created\./)).toBeVisible()
    const id = await workshopId(w.slug)
    signContract((await liveContract(id)).id, INSTRUCTORS.sara.officialName, "en")
    const regs = await addRegistrations(id, "water", [
      { name: "Nilufar Ahmadi", status: "confirmed", photo: true, video: true },
      { name: "Selin Öztürk", status: "confirmed" },
      { name: "Parisa Moradi", status: "pending" },
    ])
    payRegistrations(regs.filter((r) => r.status === "confirmed").map((r) => r.id))
    await page.goto(`/en/admin/workshops/${id}`)
    await expect(page.getByText("Registration is open")).toBeVisible()
    await expect(page.getByText("2 of 10").first()).toBeVisible()
  })
})
