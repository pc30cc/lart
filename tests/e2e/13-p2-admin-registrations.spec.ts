import { execFileSync } from "node:child_process"
import path from "node:path"

import type { Locator, Page } from "@playwright/test"

import { formatLira } from "../../src/lib/money"
import { at, expect, field, mailMark, MAIL_LOG, RUN, test, toast } from "./helpers/app"
import { E2E_DATABASE_URL, one, sql } from "./helpers/db"
import { courseId, lead, linksOf, mailTo, P2, personContext, tr, waitMail } from "./helpers/p2"

/**
 * Phase 2, the admin side of registrations: the Registrations tab, recording
 * payments (cash, bank transfer, online link) and what the member then sees
 * and receives, cancelling a paid registration with the refund under the
 * terms, the refunds list and "Mark as refunded", a member's own cancellation
 * of a paid place (refund_due to the admins), the go decision counting
 * everyone registered, cancelling a whole workshop, and the day-before
 * reminder job.
 */

const ROOT = path.resolve(__dirname, "../..")
const lira = (kurus: number, locale = "en") => formatLira(kurus, locale)

/** The text of an element without the bidi isolates the app puts around amounts (⁨₺800⁩). */
const plain = (s: string) => s.replace(/[\u2066-\u2069]/g, "")
async function expectText(locator: Locator, expected: string) {
  await expect.poll(async () => plain((await locator.textContent()) ?? ""), { message: `text: ${expected}` }).toContain(expected)
}

async function regId(memberEmail: string, slug: string, participant?: string) {
  return (
    await one<{ id: string }>(
      `select r.id from registrations r join members m on m.id = r.member_id join courses c on c.id = r.course_id
        where m.email = $1 and c.slug = $2 and ($3::text is null or r.participant_name = $3) order by r.created_at desc limit 1`,
      [memberEmail, slug, participant ?? null],
    )
  ).id
}

async function registrationsTab(page: Page, slug: string) {
  await page.goto(`/en/admin/workshops/${await courseId(slug)}`)
  await page.getByRole("navigation", { name: "Workshop sections" }).getByRole("link", { name: "Registrations" }).click()
  await expect(page).toHaveURL(/\/registrations$/)
}

/** The row of one participant (the "Registered by" column repeats the member's name on their other people's rows). */
function regRow(page: Page, participant: string) {
  return page.getByRole("row").filter({ has: page.getByRole("button", { name: `Actions for ${participant}`, exact: true }) })
}

/** "Record payment" on a row: choose the way, confirm. */
async function recordPayment(page: Page, participant: string, method: "Cash" | "Bank transfer" | "Online payment link") {
  const row = regRow(page, participant)
  await row.getByRole("button", { name: "Record payment" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toContainText(`Has ${participant} paid`)
  await dialog.getByRole("radio", { name: new RegExp(`^${method}`) }).click()
  await dialog.getByRole("button", { name: "Yes, it’s paid" }).click()
  await expect(toast(page, /^Payment recorded\./)).toBeVisible()
  await expect(dialog).toBeHidden()
}

function runJobs() {
  return execFileSync(path.join(ROOT, "node_modules/.bin/tsx"), [path.join(ROOT, "scripts/jobs.ts")], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_URL: E2E_DATABASE_URL,
      APP_URL: "http://localhost:3100",
      RESEND_API_KEY: "re_e2e_fake",
      RESEND_BASE_URL: "http://127.0.0.1:3199",
      EMAIL_FROM: "Lart <hello@lart.test>",
      E2E_MAIL_LOG: MAIL_LOG,
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
}

test.describe.serial("phase 2 · admin: registrations, payments, refunds", () => {
  test("the Registrations tab of workshop A: totals, both people, consent, contact", async ({ page }) => {
    await registrationsTab(page, P2.wA.slug)
    await expect(page.locator("main").getByText("Registered", { exact: true }).first().locator("xpath=..")).toContainText("2")
    await expect(page.locator("main").getByText("Not paid yet", { exact: true }).first().locator("xpath=..")).toContainText(lira(200_000))
    for (const who of [P2.ayla, P2.cemre]) {
      const row = page.getByRole("row").filter({ hasText: who.name }).first()
      await expect(row).toContainText("Not paid yet")
      await expect(row).toContainText(who.email)
    }
    // Bahar's cancelled place is listed as cancelled (filter).
    await page.goto(`${page.url()}?status=cancelled`)
    await expect(page.getByRole("row").filter({ hasText: P2.bahar.name })).toContainText("Cancelled")

    // CSV export: everyone, with the payment state.
    const res = await page.request.get(`/en/admin/workshops/${await courseId(P2.wA.slug)}/registrations/export`)
    expect(res.status()).toBe(200)
    expect(res.headers()["content-type"]).toContain("text/csv")
    const csv = await res.text()
    test.info().annotations.push({ type: "registrations.csv", description: csv.slice(0, 800) })
    for (const who of [P2.ayla, P2.cemre, P2.bahar]) expect(csv).toContain(who.name)
    expect(await sql("select 1 from audit_log where action like '%export%' and at > now() - interval '2 minutes'")).not.toHaveLength(0)
  })

  test("record Ayla's payment in cash: paid, booked in the wallet, she sees Paid and gets payment_received", async ({ page, browser }) => {
    const mark = mailMark()
    const id = await regId(P2.ayla.email, P2.wA.slug)
    await registrationsTab(page, P2.wA.slug)
    await recordPayment(page, P2.ayla.name, "Cash")
    await expect(regRow(page, P2.ayla.name)).toContainText("Cash")
    const reg = await one<{ status: string; payment_method: string; paid_at: Date | null }>("select status, payment_method, paid_at from registrations where id = $1", [id])
    expect(reg).toMatchObject({ status: "confirmed", payment_method: "cash" })
    expect(reg.paid_at).not.toBeNull()
    const ledger = await one<{ n: string }>(
      `select sum(l.amount) as n from ledger_transactions t join ledger_lines l on l.transaction_id = t.id
        where t.registration_id = $1 and t.kind = 'registration_payment' and l.account = 'wallet'`,
      [id],
    )
    expect(Number(ledger.n)).toBe(100_000)
    expect(await sql("select 1 from audit_log where action = 'registration.payment' and entity_id = $1", [id])).toHaveLength(1)

    const email = await waitMail(P2.ayla.email, mark, P2.wA.title.tr)
    expect(email.subject).toContain(lead("tr", "emails.payment_received.subject"))

    const t = tr("tr")
    const context = await personContext(browser, "ayla")
    const member = await context.newPage()
    await member.goto("/account")
    await expect(member.locator("article").filter({ hasText: P2.wA.title.tr })).toContainText(t("registration.status.paid"))
    await member.goto(`/account/registrations/${id}`)
    await expect(member.locator("main").getByText(t("registration.detail.paidTitle"))).toBeVisible()
    await expect(member.locator("main")).toContainText(t("registration.detail.method.cash"))
    // No payment instructions any more.
    await expect(member.locator("main").getByText(t("registration.payment.title"), { exact: true })).toHaveCount(0)
    await context.close()

    // Recording it twice is not possible: the button is gone.
    await page.reload()
    await expect(page.getByRole("row").filter({ hasText: P2.ayla.name }).getByRole("button", { name: "Record payment" })).toHaveCount(0)
  })

  test("workshop B: Ayla paid by bank transfer, Cemre through the online link; Deniz not yet", async ({ page }) => {
    const mark = mailMark()
    // A bank transfer names the participant in its description: Registrations (all workshops), search, record it there.
    await page.goto("/en/admin/registrations")
    await expect(page.getByRole("heading", { level: 1, name: "Registrations" })).toBeVisible()
    await page.getByPlaceholder("Search by name, email or phone").fill(P2.ayla.name)
    await expect(page).toHaveURL(/[?&]q=/)
    const aylaB = page
      .getByRole("row")
      .filter({ hasText: P2.wB.title.en })
      .filter({ has: page.getByRole("button", { name: `Actions for ${P2.ayla.name}`, exact: true }) })
    await expect(aylaB).toContainText("Not paid yet")
    await aylaB.getByRole("button", { name: "Record payment" }).click()
    const pay = page.getByRole("dialog")
    await expect(pay).toContainText(`Has ${P2.ayla.name} paid`)
    await pay.getByRole("radio", { name: /^Bank transfer/ }).click()
    await pay.getByRole("button", { name: "Yes, it’s paid" }).click()
    await expect(toast(page, /^Payment recorded\./)).toBeVisible()
    await expect(pay).toBeHidden()
    // It leaves "Not paid yet" (the default tab) and is listed under Paid.
    await expect(aylaB).toHaveCount(0)
    await page.getByRole("navigation", { name: "Payment" }).getByRole("link", { name: /^Paid/ }).click()
    await expect(page).toHaveURL(/view=paid/)
    await expect(page.getByRole("row").filter({ hasText: P2.wB.title.en }).filter({ hasText: P2.ayla.name }).first()).toContainText("Bank transfer")

    await registrationsTab(page, P2.wB.slug)
    await recordPayment(page, P2.cemre.name, "Online payment link")
    const rows = await sql<{ participant_name: string; status: string; payment_method: string | null }>(
      "select participant_name, status, payment_method from registrations where course_id = $1 order by participant_name",
      [await courseId(P2.wB.slug)],
    )
    expect(rows).toEqual([
      { participant_name: P2.ayla.name, status: "confirmed", payment_method: "transfer" },
      { participant_name: P2.cemre.name, status: "confirmed", payment_method: "online" },
      { participant_name: `Deniz Kurt ${RUN}`, status: "pending", payment_method: null },
    ])
    await waitMail(P2.ayla.email, mark, P2.wB.title.tr)
    const e = await waitMail(P2.cemre.email, mark, P2.wB.title.en)
    expect(e.subject).toContain("Thank you! We’ve received your payment")
  })

  test("cancel Cemre's paid registration in B: the refund under the terms, then the refunds list and Mark as refunded", async ({ page, browser }) => {
    const id = await regId(P2.cemre.email, P2.wB.slug)
    let mark = mailMark()
    await registrationsTab(page, P2.wB.slug)
    await page.getByRole("button", { name: `Actions for ${P2.cemre.name}` }).click()
    await page.getByRole("menuitem", { name: "Cancel registration" }).click()
    const dialog = page.getByRole("dialog")
    await expectText(dialog, `${lira(80_000)} was paid. How much should go back?`)
    // More than 72 hours before the start: all of it under the terms.
    const terms = dialog.getByRole("radio", { name: /^Under the terms/ })
    await expect(terms).toBeChecked()
    await expectText(dialog, `Under the terms: 100% · ${lira(80_000)}`)
    await expect(dialog).toContainText("Cancelled 72 hours or more before the start.")
    await dialog.getByRole("button", { name: "Yes, cancel it" }).click()
    await expect(toast(page, "Registration cancelled.")).toBeVisible()
    const reg = await one<{ status: string; refund_amount: string }>("select status, refund_amount from registrations where id = $1", [id])
    expect(reg.status).toBe("cancelled")
    expect(Number(reg.refund_amount)).toBe(80_000)
    const cancelled = await waitMail(P2.cemre.email, mark, P2.wB.title.en)
    test.info().annotations.push({ type: "registration_cancelled (by admin)", description: `${cancelled.subject}\n${cancelled.text}`.slice(0, 1500) })
    expect(`${cancelled.text} ${cancelled.html}`).toContain(lira(80_000))

    // Money › Refunds: owed, then marked as paid back.
    await page.goto("/en/admin/money/refunds")
    await expect(page.getByRole("heading", { level: 1, name: "Refunds" })).toBeVisible()
    const row = page.getByRole("row").filter({ hasText: P2.cemre.name })
    await expect(row).toContainText(lira(80_000))
    await expect(row).toContainText("Registration cancelled")
    mark = mailMark()
    await row.getByRole("button", { name: "Mark as refunded" }).click()
    const mdialog = page.getByRole("dialog")
    await expectText(mdialog, `Paid ${lira(80_000)} back?`)
    await mdialog.getByRole("button", { name: "Yes, it’s paid back" }).click()
    await expect(toast(page, /^Marked as refunded\./)).toBeVisible()
    const after = await one<{ refunded_at: Date | null }>("select refunded_at from registrations where id = $1", [id])
    expect(after.refunded_at).not.toBeNull()
    const refundTx = await one<{ n: string }>(
      `select sum(l.amount) as n from ledger_transactions t join ledger_lines l on l.transaction_id = t.id
        where t.registration_id = $1 and t.kind = 'registration_refund' and l.account = 'wallet'`,
      [id],
    )
    expect(Number(refundTx.n)).toBe(-80_000)
    const sent = await waitMail(P2.cemre.email, mark, P2.wB.title.en)
    expect(sent.subject).toContain("refund")
    await page.goto("/en/admin/money/refunds?view=refunded")
    await expect(page.getByRole("row").filter({ hasText: P2.cemre.name })).toContainText(lira(80_000))

    // Cemre sees it: refunded.
    const context = await personContext(browser, "cemre")
    const member = await context.newPage()
    await member.goto(`/en/account/registrations/${id}`)
    await expect(member.locator("main")).toContainText(tr("en")("registration.status.refundSent", { amount: `⁨${lira(80_000)}⁩` }))
    await context.close()
  })

  test("Ayla cancels her own paid place in B: the full refund shown first, then refund_due to the admins", async ({ browser, page }) => {
    const t = tr("tr")
    const id = await regId(P2.ayla.email, P2.wB.slug, P2.ayla.name)
    const mark = mailMark()
    const context = await personContext(browser, "ayla")
    const member = await context.newPage()
    await member.goto("/account")
    const card = member.locator("article").filter({ hasText: P2.wB.title.tr }).filter({ hasText: P2.ayla.name })
    await expect(card).toContainText(t("registration.status.paid"))
    await card.getByRole("button", { name: t("registration.cancel.button") }).click()
    const dialog = member.getByRole("alertdialog")
    await expect(dialog).toContainText(lira(80_000, "tr"))
    await expect(dialog).toContainText(lead("tr", "registration.cancel.full"))
    await dialog.getByRole("button", { name: t("registration.cancel.confirm") }).click()
    await expect(toast(member, lead("tr", "registration.cancel.doneRefund"))).toBeVisible()
    const reg = await one<{ status: string; refund_amount: string }>("select status, refund_amount from registrations where id = $1", [id])
    expect(reg).toMatchObject({ status: "cancelled" })
    expect(Number(reg.refund_amount)).toBe(80_000)
    await context.close()

    // Ayla gets the cancellation with the refund; every admin gets refund_due.
    await waitMail(P2.ayla.email, mark, P2.wB.title.tr)
    const due = await waitMail("owner@lart.test", mark, P2.ayla.name)
    test.info().annotations.push({ type: "refund_due", description: `${due.subject}\n${due.text}`.slice(0, 1500) })
    expect(`${due.text} ${due.html}`).toMatch(/800/)
    // Its link ("Open the refunds list") is checked in the last test of this file, outside the serial flow.
    test.info().annotations.push({ type: "refund_due links", description: linksOf(due).join(" ") })

    await page.goto("/en/admin/money/refunds")
    await expect(page.getByRole("row").filter({ hasText: P2.ayla.name })).toContainText(lira(80_000))
  })

  test("go decision on A counts everyone registered, paid or not yet", async ({ page }) => {
    await page.goto(`/en/admin/workshops/${await courseId(P2.wA.slug)}`)
    await page.getByRole("button", { name: "Confirm workshop" }).click()
    const dialog = page.getByRole("alertdialog")
    await expect(dialog).toContainText("2 people have registered (paid or not yet).")
    await dialog.getByRole("button", { name: "Yes, it goes ahead" }).click()
    await expect(toast(page, "Workshop confirmed.")).toBeVisible()
    const course = await one<{ status: string; final_participants: number }>("select status, final_participants from courses where slug = $1", [P2.wA.slug])
    expect(course).toEqual({ status: "confirmed", final_participants: 2 })
  })

  test("cancel workshop C: whoever paid is owed a full refund, the others are told not to come", async ({ page }) => {
    await registrationsTab(page, P2.wC.slug)
    await recordPayment(page, P2.bahar.name, "Cash")
    const mark = mailMark()
    await page.goto(`/en/admin/workshops/${await courseId(P2.wC.slug)}`)
    await page.getByRole("button", { name: "Cancel workshop" }).click()
    const dialog = page.getByRole("alertdialog")
    await expect(dialog).toContainText("2 registrations will be cancelled.")
    await dialog.getByRole("button", { name: "Yes, cancel it" }).click()
    await expect(toast(page, "Workshop cancelled.")).toBeVisible()

    const regs = await sql<{ participant_name: string; status: string; refund_amount: string | null }>(
      "select participant_name, status, refund_amount from registrations where course_id = $1 order by participant_name",
      [await courseId(P2.wC.slug)],
    )
    expect(regs.map((r) => [r.participant_name, r.status, Number(r.refund_amount ?? 0)])).toEqual([
      [P2.bahar.name, "cancelled", 60_000],
      [P2.cemre.name, "cancelled", 0],
    ])
    const paid = await waitMail(P2.bahar.email, mark, P2.wC.title.fa)
    const unpaid = await waitMail(P2.cemre.email, mark, P2.wC.title.en)
    test.info().annotations.push({ type: "workshop_cancelled", description: `${paid.subject}\n${paid.text}\n----\n${unpaid.subject}\n${unpaid.text}`.slice(0, 2500) })
    expect(`${paid.text} ${paid.html}`).toContain(lira(60_000, "fa"))
    expect(`${unpaid.text} ${unpaid.html}`).not.toContain(lira(60_000, "en"))
    expect(unpaid.text ?? unpaid.html).toMatch(/don’t come to the venue/)

    await page.goto("/en/admin/money/refunds")
    const row = page.getByRole("row").filter({ hasText: P2.bahar.name })
    await expect(row).toContainText(lira(60_000))
    await expect(row).toContainText("Workshop cancelled")
    // The registrations of a cancelled workshop can't change any more.
    await registrationsTab(page, P2.wC.slug)
    await expect(page.getByRole("button", { name: /^Actions for / })).toHaveCount(0)
    // The public page says cancelled; the list no longer shows it.
    const anon = await page.context().browser()!.newContext({ storageState: { cookies: [], origins: [] } })
    const p = await anon.newPage()
    await p.goto(`/workshops/${P2.wC.slug}`)
    await expect(p.locator("main").getByText(tr("tr")("registration.workshop.state.cancelledTitle"))).toBeVisible()
    await p.goto("/workshops")
    await expect(p.locator("main").getByText(P2.wC.title.tr)).toHaveCount(0)
    await anon.close()
  })

  test("the 50 % band: two days before workshop D, Cemre cancels her paid place and the admin cancels Bahar's", async ({ page, browser }) => {
    // Cemre and Bahar register in D and pay (recorded by the admin).
    for (const [who, locale] of [
      ["cemre", "en"],
      ["bahar", "fa"],
    ] as const) {
      const t = tr(locale)
      const context = await personContext(browser, who)
      const p = await context.newPage()
      await p.goto(at(locale, `/workshops/${P2.wD.slug}/register`))
      await p.getByRole("checkbox", { name: t("registration.register.acceptTerms") }).click()
      await p.getByRole("button", { name: t("registration.register.submit"), exact: true }).click()
      await expect(p).toHaveURL(/\/account\/registrations\/[0-9a-f-]{36}\?welcome=1$/)
      await context.close()
    }
    await registrationsTab(page, P2.wD.slug)
    await recordPayment(page, P2.cemre.name, "Bank transfer")
    await recordPayment(page, P2.bahar.name, "Cash")
    // Workshop D now starts in two days (the form only takes dates further away; done in the database).
    await sql(
      `update courses set starts_at = now() + interval '48 hours', ends_at = now() + interval '50 hours',
         registration_deadline = now() + interval '30 hours', decision_at = now() + interval '26 hours' where slug = $1`,
      [P2.wD.slug],
    )
    test.info().annotations.push({ type: "note", description: "workshop D moved to start in 48 hours via SQL" })

    // The member's side: 50 % shown before confirming, then refund_due to the admins.
    const cemreReg = await regId(P2.cemre.email, P2.wD.slug)
    let mark = mailMark()
    const t = tr("en")
    const context = await personContext(browser, "cemre")
    const member = await context.newPage()
    await member.goto("/en/account")
    const card = member.locator("article").filter({ hasText: P2.wD.title.en })
    await expect(card).toContainText(t("registration.status.paid"))
    await card.getByRole("button", { name: t("registration.cancel.button") }).click()
    const dialog = member.getByRole("alertdialog")
    await expect(dialog).toContainText(lead("en", "registration.cancel.partial"))
    await expect(dialog).toContainText("50%")
    await expect(dialog).toContainText(lira(25_000))
    await dialog.getByRole("button", { name: t("registration.cancel.confirm") }).click()
    await expect(toast(member, lead("en", "registration.cancel.doneRefund"))).toBeVisible()
    await context.close()
    expect(Number((await one<{ refund_amount: string }>("select refund_amount from registrations where id = $1", [cemreReg])).refund_amount)).toBe(25_000)
    const cancelled = await waitMail(P2.cemre.email, mark, P2.wD.title.en)
    expect(`${cancelled.text} ${cancelled.html}`).toContain(lira(25_000))
    expect(`${cancelled.text} ${cancelled.html}`).toContain("50%")
    const due = await waitMail("owner@lart.test", mark, P2.cemre.name)
    expect(`${due.text} ${due.html}`).toContain(lira(25_000))

    // The admin's side: "Under the terms: 50%", the band explained.
    const baharReg = await regId(P2.bahar.email, P2.wD.slug)
    mark = mailMark()
    await registrationsTab(page, P2.wD.slug)
    await page.getByRole("button", { name: `Actions for ${P2.bahar.name}` }).click()
    await page.getByRole("menuitem", { name: "Cancel registration" }).click()
    const admin = page.getByRole("dialog")
    await expectText(admin, `${lira(50_000)} was paid. How much should go back?`)
    await expect(admin.getByRole("radio", { name: /^Under the terms/ })).toBeChecked()
    await expectText(admin, `Under the terms: 50% · ${lira(25_000)}`)
    await expect(admin).toContainText("Cancelled between 72 and 24 hours before the start.")
    await admin.getByRole("button", { name: "Yes, cancel it" }).click()
    await expect(toast(page, "Registration cancelled.")).toBeVisible()
    expect(Number((await one<{ refund_amount: string }>("select refund_amount from registrations where id = $1", [baharReg])).refund_amount)).toBe(25_000)
    const baharMail = await waitMail(P2.bahar.email, mark, P2.wD.title.fa)
    expect(`${baharMail.text} ${baharMail.html}`).toContain(lira(25_000, "fa"))
    await page.goto("/en/admin/money/refunds")
    for (const who of [P2.cemre, P2.bahar]) {
      await expect(page.getByRole("row").filter({ hasText: who.name }).filter({ hasText: P2.wD.title.en })).toContainText(lira(25_000))
    }

    // The admin decides on a full refund for Bahar after all ("Change refund"), then pays it back.
    mark = mailMark()
    const baharRow = page.getByRole("row").filter({ hasText: P2.bahar.name }).filter({ hasText: P2.wD.title.en })
    await baharRow.getByRole("button", { name: "Change refund" }).click()
    const change = page.getByRole("dialog")
    await expect(change).toContainText(`Change the refund for ${P2.bahar.name}`)
    await expectText(change, `${lira(50_000)} was paid, and ${lira(25_000)} is to go back now.`)
    await field(change, /^Refund/).getByRole("textbox").fill("500")
    await change.getByRole("button", { name: "Save refund" }).click()
    await expect(toast(page, "Refund changed.")).toBeVisible()
    await expect(change).toBeHidden()
    expect(Number((await one<{ refund_amount: string }>("select refund_amount from registrations where id = $1", [baharReg])).refund_amount)).toBe(50_000)
    expect(await sql("select 1 from audit_log where action = 'registration.refundChange' and entity_id = $1", [baharReg])).toHaveLength(1)
    const changed = await waitMail(P2.bahar.email, mark, P2.wD.title.fa)
    expect(`${changed.text} ${changed.html}`).toContain(lira(50_000, "fa"))
    await expect(baharRow).toContainText(lira(50_000))
    await baharRow.getByRole("button", { name: "Mark as refunded" }).click()
    const paidBack = page.getByRole("dialog")
    await expectText(paidBack, `Paid ${lira(50_000)} back?`)
    await paidBack.getByRole("button", { name: "Yes, it’s paid back" }).click()
    await expect(toast(page, /^Marked as refunded\./)).toBeVisible()
    const refunded = await one<{ refunded_at: Date | null }>("select refunded_at from registrations where id = $1", [baharReg])
    expect(refunded.refunded_at).not.toBeNull()
  })

  test("the day-before reminder job emails Ayla once, with what is still to pay and how", async () => {
    // Workshop D moves to tomorrow (the form only accepts dates further away; done in the database).
    await sql(
      `update courses set starts_at = now() + interval '20 hours', ends_at = now() + interval '22 hours',
         registration_deadline = now() + interval '10 hours', decision_at = now() + interval '5 hours' where slug = $1`,
      [P2.wD.slug],
    )
    test.info().annotations.push({ type: "note", description: "workshop D moved to start in 20 hours via SQL before running pnpm jobs" })
    const mark = mailMark()
    const out1 = runJobs()
    test.info().annotations.push({ type: "jobs run 1", description: out1 })
    expect(out1).toMatch(/workshop_reminder: \d+ of \d+/)
    const first = mailTo(P2.ayla.email, mark).filter((e) => e.subject.includes(P2.wD.title.tr))
    expect(first, "one reminder to Ayla").toHaveLength(1)
    const email = first[0]
    test.info().annotations.push({ type: "workshop_reminder", description: `${email.subject}\n${email.text}`.slice(0, 2000) })
    expect(email.subject).toContain(lead("tr", "emails.workshop_reminder.subject") || P2.wD.title.tr)
    expect(`${email.text} ${email.html}`).toContain(lira(50_000, "tr"))
    expect(`${email.text} ${email.html}`).toContain("TR33 0006 1005 1978 6457 8413 26")
    const reg = await one<{ reminder_sent_at: Date | null }>("select reminder_sent_at from registrations where id = $1", [await regId(P2.ayla.email, P2.wD.slug)])
    expect(reg.reminder_sent_at).not.toBeNull()

    // Once only.
    const mark2 = mailMark()
    const out2 = runJobs()
    test.info().annotations.push({ type: "jobs run 2", description: out2 })
    expect(mailTo(P2.ayla.email, mark2)).toHaveLength(0)
  })
})

// Outside the serial flow: a failure here reports a bug without stopping the specs that build on this data.
test("refund_due: its button “Open the refunds list” opens the refunds list (the only page with “Mark as refunded”)", async () => {
  const due = mailTo("owner@lart.test", 0)
    .filter((e) => e.subject.includes(P2.ayla.name) && e.subject.includes(P2.wB.title.en))
    .pop()
  test.skip(!due, "no refund_due email for Ayla's cancellation in B (run the flow above first)")
  const admin = linksOf(due!).filter((l) => l.includes("/admin/"))
  test.info().annotations.push({ type: "refund_due links", description: admin.join(" ") })
  expect(admin).toContainEqual(expect.stringMatching(/\/admin\/money\/refunds$/))
})
