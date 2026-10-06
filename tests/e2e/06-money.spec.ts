import type { Locator, Page } from "@playwright/test"
import fs from "node:fs"

import { formatLira } from "../../src/lib/money"
import { ADMIN, chooseSelect, expect, field, RUN, test, toast } from "./helpers/app"
import { INSTRUCTORS, WORKSHOPS } from "./helpers/data"
import { one, sql } from "./helpers/db"
import { refundRegistrations } from "./helpers/scripts"

const lira = (kurus: number) => formatLira(kurus, "en")

async function workshopId(slug: string) {
  return (await one<{ id: string }>("select id from courses where slug = $1", [slug])).id
}

async function walletInDb() {
  return Number((await one<{ n: string }>("select coalesce(sum(amount), 0) as n from ledger_lines where account = 'wallet'")).n)
}

/** A <Stat> card (label + big value + hint) by its exact label. */
function stat(page: Page, label: string) {
  return page.getByText(label, { exact: true }).first().locator("xpath=../..")
}

/** Open a dialog form from its trigger button and return the dialog. */
async function openDialog(page: Page, trigger: string | RegExp, title: string | RegExp) {
  await page.getByRole("button", { name: trigger, exact: typeof trigger === "string" }).first().click()
  const dialog = page.getByRole("dialog").filter({ hasText: title })
  await expect(dialog).toBeVisible()
  return dialog
}

async function fillAmount(dialog: Locator, value: string) {
  await field(dialog, /^Amount/).getByRole("textbox").fill(value)
}

async function addExpense(page: Page, what: string, amount: string, paidFrom: string | RegExp) {
  const dialog = await openDialog(page, "Add expense", "Add a workshop expense")
  await field(dialog, /^What was it for\?/).locator("input").fill(what)
  await fillAmount(dialog, amount)
  await chooseSelect(page, /^Paid from/, paidFrom)
  await dialog.getByRole("button", { name: "Save" }).click()
  await expect(toast(page, "Expense saved.")).toBeVisible()
  await expect(dialog).toBeHidden()
  await expect(page.getByText(what, { exact: true }).first()).toBeVisible()
}

test.describe.serial("money", () => {
  test("wallet: capital contribution, withdrawal and a general expense", async ({ page }) => {
    const before = await walletInDb()
    await page.goto("/en/admin/money")
    await expect(page.getByRole("heading", { level: 1, name: "Wallet" })).toBeVisible()
    await expect(page.getByText("In the wallet", { exact: true }).locator("xpath=../..")).toContainText(lira(before))

    // Contribution: the only partner is chosen already.
    let dialog = await openDialog(page, "Add contribution", "Add a capital contribution")
    await expect(dialog.getByRole("radio", { name: ADMIN.name })).toHaveAttribute("aria-checked", "true")
    await fillAmount(dialog, "0")
    await dialog.getByRole("button", { name: "Save" }).click()
    await expect(field(dialog, /^Amount/)).toContainText("Please enter an amount above zero.")
    await fillAmount(dialog, "20.000")
    await field(dialog, /^Note/).getByRole("textbox").fill(`Starting capital ${RUN}`)
    await dialog.getByRole("button", { name: "Save" }).click()
    await expect(toast(page, "Contribution saved.")).toBeVisible()
    await expect(dialog).toBeHidden()

    dialog = await openDialog(page, "Withdrawal", "Record a withdrawal")
    await fillAmount(dialog, "2000")
    await field(dialog, /^Note/).getByRole("textbox").fill(`Owner draw ${RUN}`)
    await dialog.getByRole("button", { name: "Save" }).click()
    await expect(toast(page, "Withdrawal saved.")).toBeVisible()

    dialog = await openDialog(page, "General expense", "Add a general expense")
    // A general expense cannot be paid out of an instructor's advance.
    await field(dialog, /^Paid from/).getByRole("combobox").click()
    await expect(page.getByRole("option", { name: /advance/ })).toHaveCount(0)
    await page.keyboard.press("Escape")
    await field(dialog, /^What was it for\?/).locator("input").fill(`Website hosting ${RUN}`)
    await fillAmount(dialog, "500")
    await dialog.getByRole("button", { name: "Save" }).click()
    await expect(toast(page, "Expense saved.")).toBeVisible()

    const after = await walletInDb()
    expect(after - before).toBe(2_000_000 - 200_000 - 50_000)
    await expect(page.getByText(lira(after), { exact: true }).first()).toBeVisible()
    await expect(page.getByText(`Website hosting ${RUN}`).first()).toBeVisible()
    await expect(page.getByText(`Starting capital ${RUN}`).first()).toBeVisible()

    const rows = await sql<{ kind: string; description: string }>(
      "select kind, description from ledger_transactions where description like $1 order by created_at desc limit 3",
      [`%${RUN}`],
    )
    expect(rows.map((r) => r.kind).reverse()).toEqual(["capital_contribution", "capital_withdrawal", "expense"])
  })

  test("workshop finances: advance and expenses from the wallet, a partner and the advance", async ({ page }) => {
    const id = await workshopId(WORKSHOPS.held.slug)
    await page.goto(`/en/admin/workshops/${id}/finances`)
    await expect(stat(page, "Registrations")).toContainText("3")
    await expect(stat(page, "Registrations")).toContainText("1 more waiting for payment")
    await expect(stat(page, "Revenue")).toContainText(lira(450_000))
    await expect(stat(page, "Instructor fee")).toContainText(lira(300_000))
    await expect(stat(page, "Instructor fee")).toContainText("Fixed fee from the contract.")
    await expect(stat(page, "Advance with the instructor")).toContainText("Agreed in the contract: ₺1,000")
    await expect(stat(page, "Expected net profit")).toContainText(lira(150_000))
    // Still running: closing is not possible yet.
    await expect(page.getByText("The workshop hasn’t finished yet. You can close it after it ends.")).toBeVisible()
    await expect(page.getByRole("button", { name: "Close workshop…" })).toBeDisabled()

    // The advance agreed in the contract is suggested.
    const dialog = await openDialog(page, "Advance paid", "Record an advance paid")
    await expect(field(dialog, /^Amount/).getByRole("textbox")).toHaveValue(/1[,.]?000/)
    await field(dialog, /^Note/).getByRole("textbox").fill(`Advance by bank transfer ${RUN}`)
    await dialog.getByRole("button", { name: "Save" }).click()
    await expect(toast(page, "Advance saved.")).toBeVisible()
    await expect(stat(page, "Advance with the instructor")).toContainText(lira(100_000))

    await addExpense(page, `Venue rent ${RUN}`, "800", "The shared wallet")
    await addExpense(page, `Materials ${RUN}`, "400", `${ADMIN.name}, personally`)
    await addExpense(page, `Catering ${RUN}`, "300", "The shared wallet")
    await addExpense(page, `Printing ${RUN}`, "200", /The instructor’s advance \(₺1,000 left\)/)
    await expect(stat(page, "Advance with the instructor")).toContainText(lira(80_000))

    // More than the instructor still holds is refused on the amount.
    const tooMuch = await openDialog(page, "Add expense", "Add a workshop expense")
    await field(tooMuch, /^What was it for\?/).locator("input").fill("Too much")
    await fillAmount(tooMuch, "5000")
    await chooseSelect(page, /^Paid from/, /The instructor’s advance/)
    await tooMuch.getByRole("button", { name: "Save" }).click()
    await expect(field(tooMuch, /^Amount/)).toContainText("That is more than the advance the instructor still holds.")
    await tooMuch.getByRole("button", { name: "Cancel" }).click()

    // 4,500 − 3,000 − (800 + 400 + 300 + 200) = −200
    await expect(stat(page, "Workshop expenses")).toContainText(lira(170_000))
    await expect(stat(page, "Workshop expenses")).toContainText("4 expenses")
    await expect(stat(page, "Expected net profit")).toContainText(lira(-20_000))
    await expect(page.getByText(`paid by ${ADMIN.name}`).first()).toBeVisible()
    await expect(page.getByText("from the instructor’s advance").first()).toBeVisible()
  })

  test("transactions: search, debit and credit lines, reverse an expense", async ({ page }) => {
    await page.goto("/en/admin/money/transactions")
    await expect(page.getByRole("heading", { level: 1, name: "Transactions" })).toBeVisible()
    await page.getByPlaceholder("Search descriptions and workshops…").fill(`Catering ${RUN}`)
    await expect(page).toHaveURL(/q=Catering/)
    const row = page.getByRole("row").filter({ hasText: `Catering ${RUN}` }).first()
    await expect(row).toBeVisible()
    await expect(page.getByRole("row").filter({ hasText: `Venue rent ${RUN}` })).toHaveCount(0)

    await row.getByRole("button", { name: "Show the debit and credit lines" }).click()
    const lines = page.locator("table table")
    await expect(lines).toContainText("Workshop expenses")
    await expect(lines).toContainText("Wallet")
    await expect(lines).toContainText(lira(30_000))
    await expect(page.getByText(`Recorded by ${ADMIN.name}`).first()).toBeVisible()

    await page.getByRole("button", { name: "Reverse" }).first().click()
    const confirm = page.getByRole("alertdialog")
    await expect(confirm).toContainText("Reverse this entry?")
    await expect(confirm).toContainText(`Catering ${RUN}`)
    await confirm.getByRole("button", { name: "Reverse entry" }).click()
    await expect(toast(page, "Entry reversed.")).toBeVisible()

    const original = await one<{ id: string }>("select id from ledger_transactions where description = $1 and kind = 'expense'", [`Catering ${RUN}`])
    const reversal = await one<{ kind: string; total: string }>(
      `select t.kind, sum(l.amount) as total from ledger_transactions t join ledger_lines l on l.transaction_id = t.id
        where t.reversal_of = $1 and l.account = 'wallet' group by t.kind`,
      [original.id],
    )
    expect(reversal.kind).toBe("reversal")
    expect(Number(reversal.total)).toBe(30_000)

    // The list shows the original as reversed and the correction; neither can be reversed again.
    await page.reload()
    await expect(page.getByText("Reversed").first()).toBeVisible()
    await expect(page.getByText(/Correction/).first()).toBeVisible()
    for (const r of await page.getByRole("row").filter({ hasText: `Catering ${RUN}` }).all()) {
      await r.getByRole("button", { name: "Show the debit and credit lines" }).click()
    }
    await expect(page.getByRole("button", { name: "Reverse" })).toHaveCount(0)

    // Filters: by kind.
    await page.goto("/en/admin/money/transactions?kind=capital_contribution")
    await expect(page.getByRole("row").filter({ hasText: `Starting capital ${RUN}` })).toBeVisible()
    await expect(page.getByRole("row").filter({ hasText: `Venue rent ${RUN}` })).toHaveCount(0)
  })

  test("close the confirmed workshop once it is over (dates moved into the past with SQL)", async ({ page }) => {
    const id = await workshopId(WORKSHOPS.held.slug)
    // The form only accepts future dates, so the workshop is moved to yesterday directly in the database.
    await sql(
      `update courses set starts_at = now() - interval '1 day 3 hours', ends_at = now() - interval '1 day',
         registration_deadline = now() - interval '3 days', decision_at = now() - interval '2 days' where id = $1`,
      [id],
    )
    test.info().annotations.push({ type: "note", description: "starts_at/ends_at of the held workshop moved to yesterday via SQL before closing" })

    await page.goto(`/en/admin/workshops/${id}/finances`)
    await expect(page.getByText("Everything is ready.")).toBeVisible()
    // 4,500 − 3,000 − (800 + 400 + 200) = 100
    await expect(stat(page, "Expected net profit")).toContainText(lira(10_000))
    await page.getByRole("button", { name: "Close workshop…" }).click()
    const dialog = page.getByRole("dialog").filter({ hasText: "These are the final figures." })
    await expect(dialog).toContainText(`Close “${WORKSHOPS.held.title.en}”?`)
    await expect(dialog).toContainText(lira(450_000))
    await expect(dialog).toContainText(lira(-300_000))
    await expect(dialog).toContainText(lira(-140_000))
    await expect(dialog).toContainText("Profit to the partners")
    await expect(dialog).toContainText(`${ADMIN.name} · 100%`)
    await expect(dialog).toContainText("The instructor’s advance of ₺800 is set off against the fee. Still to pay them: ₺2,200.")
    await dialog.getByRole("button", { name: "Close and lock" }).click()
    await expect(toast(page, "Workshop closed. The figures are locked.")).toBeVisible()

    await expect(page.getByText(/^Closed on /)).toBeVisible()
    await expect(page.getByText("These figures are final and can’t change any more.")).toBeVisible()
    await expect(page.getByRole("button", { name: "Add expense" })).toHaveCount(0)
    await expect(page.getByText("Still to pay").locator("xpath=..")).toContainText(lira(220_000))
    await expect(page.getByText("Set off from the advance").locator("xpath=..")).toContainText(lira(-80_000))

    const course = await one<{ status: string; closed_totals: Record<string, unknown> }>(
      "select status, closed_totals from courses where id = $1",
      [id],
    )
    expect(course.status).toBe("closed")
    expect(course.closed_totals).toMatchObject({ revenue: 450_000, instructorFee: 300_000, expenses: 140_000, netProfit: 10_000, participants: 3 })
    expect((course.closed_totals.partners as { amount: number; name: string }[])[0]).toMatchObject({ amount: 10_000, name: ADMIN.name })
    const kinds = await sql<{ kind: string }>("select kind from ledger_transactions where course_id = $1 and kind in ('course_settlement','course_close')", [id])
    expect(kinds.map((k) => k.kind).sort()).toEqual(["course_close", "course_settlement"])

    // A closed workshop's entries can no longer be reversed.
    await page.goto(`/en/admin/money/transactions?q=${encodeURIComponent(`Venue rent ${RUN}`)}`)
    const row = page.getByRole("row").filter({ hasText: `Venue rent ${RUN}` }).first()
    await row.getByRole("button", { name: "Show the debit and credit lines" }).click()
    await expect(page.getByRole("button", { name: "Reverse" })).toHaveCount(0)
  })

  test("pay the instructor in two parts", async ({ page }) => {
    const id = await workshopId(WORKSHOPS.held.slug)
    await page.goto(`/en/admin/workshops/${id}/finances`)
    let dialog = await openDialog(page, "Pay instructor", "Pay the instructor")
    await expect(dialog).toContainText(`${INSTRUCTORS.elif.displayName.en} is still owed ₺2,200 for this workshop.`)
    await expect(field(dialog, /^Amount/).getByRole("textbox")).toHaveValue(/2[,.]?200/)
    await fillAmount(dialog, "2000")
    await dialog.getByRole("button", { name: "Save payment" }).click()
    await expect(toast(page, "Payment saved.")).toBeVisible()
    await expect(page.getByText("Still to pay").locator("xpath=..")).toContainText(lira(20_000))

    dialog = await openDialog(page, "Pay instructor", "Pay the instructor")
    await fillAmount(dialog, "500")
    await dialog.getByRole("button", { name: "Save payment" }).click()
    await expect(field(dialog, /^Amount/)).toContainText("That is more than the instructor is still owed for this workshop.")
    await fillAmount(dialog, "200")
    await chooseSelect(page, /^Paid from/, `${ADMIN.name}, personally`)
    await dialog.getByRole("button", { name: "Save payment" }).click()
    await expect(toast(page, "Payment saved.")).toBeVisible()
    await expect(page.getByText("The instructor is fully paid.")).toBeVisible()
    await expect(page.getByRole("button", { name: "Pay instructor" })).toHaveCount(0)
    const payable = await one<{ n: string }>(
      `select coalesce(sum(l.amount), 0) as n from ledger_lines l join ledger_transactions t on t.id = l.transaction_id
        where t.course_id = $1 and l.account = 'instructor_payable'`,
      [id],
    )
    expect(Number(payable.n)).toBe(0)
  })

  test("the cancelled workshop: refunds in the books (phase-2 stand-in), then close it", async ({ page }) => {
    const id = await workshopId(WORKSHOPS.cancelled.slug)
    await page.goto(`/en/admin/workshops/${id}/finances`)
    await expect(page.getByText("Some payments or refunds of this workshop aren’t in the books yet.")).toBeVisible()
    await expect(page.getByRole("button", { name: "Close workshop…" })).toBeDisabled()
    await expect(stat(page, "Instructor fee")).toContainText("No fee: the workshop was cancelled.")
    // No advance can be paid for a cancelled workshop.
    await expect(page.getByRole("button", { name: "Advance paid" })).toHaveCount(0)

    const regs = await sql<{ id: string }>("select id from registrations where course_id = $1 and refund_amount > 0", [id])
    expect(refundRegistrations(regs.map((r) => r.id))).toHaveLength(2)

    await page.reload()
    await expect(page.getByText("Everything is ready.")).toBeVisible()
    await page.getByRole("button", { name: "Close workshop…" }).click()
    const dialog = page.getByRole("dialog").filter({ hasText: "These are the final figures." })
    await expect(dialog).toContainText(lira(0))
    await dialog.getByRole("button", { name: "Close and lock" }).click()
    await expect(toast(page, "Workshop closed. The figures are locked.")).toBeVisible()
    // A cancelled workshop stays "cancelled" once its books are closed, with closed_at set.
    const course = await one<{ status: string; closed_at: Date | null; closed_totals: { netProfit: number; revenue: number } }>(
      "select status, closed_at, closed_totals from courses where id = $1",
      [id],
    )
    expect(course.status).toBe("cancelled")
    expect(course.closed_at).not.toBeNull()
    expect(course.closed_totals).toMatchObject({ revenue: 0, netProfit: 0 })

    // Neither workshop waits on the wallet page any more.
    await page.goto("/en/admin/money")
    const toClose = page.getByRole("heading", { name: "Ready to close" }).locator("xpath=ancestor::section[1]")
    await expect(page.getByRole("link", { name: new RegExp(WORKSHOPS.held.title.en) })).toHaveCount(0)
    await expect(page.getByRole("link", { name: new RegExp(WORKSHOPS.cancelled.title.en) })).toHaveCount(0)
    test.info().annotations.push({ type: "to-close", description: (await toClose.textContent().catch(() => "")) ?? "" })
  })

  test("reports: profit and loss, by workshop, by instructor, partner statement, CSV export", async ({ page }) => {
    await page.goto("/en/admin/money/reports")
    await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible()
    await expect(page.getByRole("link", { name: "Profit and loss" })).toHaveAttribute("aria-current", "page")
    await expect(page.locator("main")).toContainText("Revenue")
    await expect(page.locator("main")).not.toContainText(/money\.[a-z]+\./)

    // Quarter and year grouping.
    await page.getByRole("link", { name: "Quarter" }).click()
    await expect(page).toHaveURL(/group=quarter/)
    await expect(page.locator("main")).toContainText(/Q\d 20\d\d/)

    await page.getByRole("link", { name: "By workshop" }).click()
    await expect(page).toHaveURL(/report=workshops/)
    const wrow = page.getByRole("row").filter({ hasText: WORKSHOPS.held.title.en })
    await expect(wrow).toBeVisible()
    await expect(wrow).toContainText(lira(450_000))
    await expect(wrow).toContainText(lira(10_000))

    // CSV export of this report.
    const download = page.waitForEvent("download")
    await page.getByRole("link", { name: "Export CSV" }).click()
    const file = await download
    expect(file.suggestedFilename()).toMatch(/^workshops_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/)
    const csv = fs.readFileSync((await file.path())!, "utf8")
    test.info().annotations.push({ type: "csv-workshops", description: csv.slice(0, 800) })
    expect(csv).toContain(WORKSHOPS.held.title.en)
    const line = csv.split(/\r?\n/).find((l) => l.includes(WORKSHOPS.held.title.en))!
    expect(line).toMatch(/4500/)
    expect(line).toMatch(/(^|,)100(\.00?)?(,|$)/)

    await page.getByRole("link", { name: "By instructor" }).click()
    await expect(page).toHaveURL(/report=instructors/)
    await expect(page.getByRole("row").filter({ hasText: INSTRUCTORS.elif.displayName.en })).toContainText(lira(300_000))

    await page.getByRole("link", { name: "Partner statement" }).click()
    await expect(page).toHaveURL(/report=partner/)
    await expect(page.locator("main")).toContainText(`Starting capital ${RUN}`)

    // The ledger export, straight from the API, in Turkish.
    const res = await page.request.get(`/api/admin/money/export/transactions?locale=tr`)
    expect(res.status()).toBe(200)
    expect(res.headers()["content-type"]).toContain("text/csv")
    const ledgerCsv = await res.text()
    expect(ledgerCsv).toContain(`Website hosting ${RUN}`)
    test.info().annotations.push({ type: "csv-transactions", description: ledgerCsv.slice(0, 600) })

    // Exports are audited; strangers get nothing.
    expect(await sql("select 1 from audit_log where action = 'money.export' and at > now() - interval '5 minutes'")).not.toHaveLength(0)
    const anon = await page.context().browser()!.newContext({ storageState: { cookies: [], origins: [] } })
    const denied = await anon.request.get("http://localhost:3100/api/admin/money/export/pnl")
    expect(denied.status()).toBe(401)
    await anon.close()
  })

  test("partners: share and capital account", async ({ page }) => {
    await page.goto("/en/admin/money/partners")
    await expect(page.getByRole("heading", { level: 1, name: "Partners" })).toBeVisible()
    const card = page.locator("article").filter({ hasText: ADMIN.email })
    await expect(card).toContainText("100%")
    const capital = await one<{ n: string }>(
      "select coalesce(-sum(amount), 0) as n from ledger_lines where account = 'partner_capital' and partner_id = (select id from admins where email = $1)",
      [ADMIN.email],
    )
    await expect(card.getByText("Capital", { exact: true }).locator("xpath=..")).toContainText(lira(Number(capital.n)))
    await expect(page.getByRole("status").filter({ hasText: "Together: 100%. All good." })).toBeVisible()

    // A share that doesn't add up is flagged and can't be saved.
    const input = page.getByLabel(ADMIN.name)
    await input.fill("90")
    await expect(page.getByRole("status").filter({ hasText: "10% still to share." })).toBeVisible()
    await expect(page.getByRole("button", { name: "Save shares" })).toBeDisabled()
    await input.fill("abc")
    await expect(page.getByRole("status").filter({ hasText: "Please write each share as a number" })).toBeVisible()
    await input.fill("100")
    await expect(page.getByRole("button", { name: "Save shares" })).toBeEnabled()
  })

  test("the wallet adds up", async ({ page }) => {
    await page.goto("/en/admin/money")
    const wallet = await walletInDb()
    await expect(page.getByText(lira(wallet), { exact: true }).first()).toBeVisible()
    await expect(stat(page, "Owed to instructors")).toContainText(lira(0))
  })
})
