import { isolate } from "../../src/lib/format"
import { formatLira } from "../../src/lib/money"
import { ADMIN, expect, RUN, settle, test } from "./helpers/app"
import { INSTRUCTORS, WORKSHOPS } from "./helpers/data"
import { one } from "./helpers/db"

const lira = (kurus: number) => formatLira(kurus, "en")

/** Income minus every expense in [from, to] (the closing entries only move the result to the partners). */
async function netBetween(from: string, to: string) {
  const row = await one<{ n: string }>(
    `select coalesce(-sum(l.amount), 0) as n from ledger_lines l join ledger_transactions t on t.id = l.transaction_id
      where t.kind <> 'course_close' and t.occurred_on between $1 and $2
        and l.account in ('revenue', 'instructor_fees', 'course_expenses', 'general_expenses')`,
    [from, to],
  )
  return Number(row.n)
}

test.describe("dashboard", () => {
  test("the figures match the books", async ({ page }) => {
    await page.goto("/en/admin")
    await expect(page.getByRole("heading", { level: 1 })).toContainText(ADMIN.name.split(" ")[0])
    await settle(page)

    const wallet = Number((await one<{ n: string }>("select coalesce(sum(amount), 0) as n from ledger_lines where account = 'wallet'")).n)
    const kpi = (label: string | RegExp) => page.getByRole("link").filter({ hasText: label }).first()
    await expect(kpi("In the wallet")).toContainText(lira(wallet))

    const year = new Date().getFullYear()
    const net = await netBetween(`${year}-01-01`, `${year}-12-31`)
    await expect(kpi(`Net profit in ${year}`)).toContainText(lira(net))
    test.info().annotations.push({ type: "net-ytd", description: lira(net) })

    // The candle workshop was held and closed: 4 of its 8 places taken, the number fixed at the go decision
    // (3 paid, 1 not paid yet then; that one was cancelled before closing as she didn't come).
    await expect(kpi("Average fill rate")).toContainText(/4 of 8 places taken in 1 workshop/)
    await expect(kpi("Average fill rate")).toContainText("50%")

    // Charts are drawn.
    await expect(page.locator(".recharts-surface").first()).toBeVisible()
    test.info().annotations.push({ type: "charts", description: String(await page.locator(".recharts-surface").count()) })
    await expect(page.locator("main")).not.toContainText(/dashboard\.[a-z]+\.[a-z]/)
  })

  test("no browser errors on the dashboard (registrations chart)", async ({ page, problems }) => {
    await page.goto("/en/admin")
    await settle(page)
    await page.locator("#dashboard-seats").scrollIntoViewIfNeeded().catch(() => {})
    await page.waitForTimeout(1500)
    const errors = problems.filter((p) => p.type === "console" || p.type === "pageerror")
    expect(errors.map((e) => e.text.split("\n")[0])).toEqual([])
  })
})

test.describe("activity log", () => {
  test("lists what was done, with readable labels, filters and links", async ({ page }) => {
    await page.goto("/en/admin/audit")
    await expect(page.getByRole("heading", { level: 1, name: "Activity log" })).toBeVisible()
    await expect(page.getByRole("cell").filter({ hasText: ADMIN.name }).first()).toBeVisible()
    // Each action of the flow is there, with its label (the search matches the action code).
    const actions = {
      "workshop.close": "Workshop closed",
      "money.instructor_payment": "Instructor paid",
      "money.reverse": "Transaction reversed",
      "money.export": "Report exported",
      "workshop.gallery": "Gallery updated",
      "media.upload": "File uploaded",
      "instructor.reveal_id": "ID number viewed",
      "partner.shares": null,
      "template.set_default": "Default template changed",
      "auth.logout": "Signed out",
    } as const
    for (const [code, label] of Object.entries(actions)) {
      if (!label) continue
      await page.goto(`/en/admin/audit?q=${encodeURIComponent(code)}`)
      await expect(page.getByRole("cell").filter({ hasText: label }).first(), label).toBeVisible()
    }
    // The words people see are searched too, in the page's language.
    await page.goto(`/en/admin/audit?q=${encodeURIComponent("Transaction reversed")}`)
    await expect(page.getByRole("cell").filter({ hasText: "Transaction reversed" }).first()).toBeVisible()

    // Filter by record type: workshops only.
    await page.goto("/en/admin/audit?entity=workshop")
    await expect(page.getByRole("cell").filter({ hasText: "Workshop created" }).first()).toBeVisible()
    await expect(page.getByRole("cell").filter({ hasText: "Signed in" })).toHaveCount(0)

    // A change of one language of a localized text shows that language (here the English venue, edited in 05;
    // the summary line is cut at 140 characters).
    await page.goto(`/en/admin/audit?entity=workshop&q=${encodeURIComponent(`Studio 2, Kadıköy ${RUN}`)}`)
    await expect(
      // Each value is wrapped in bidi isolates (lib/format `isolate`); the new venue goes on past "Studio 2".
      page.getByRole("cell").filter({ hasText: `venue (en): ${isolate(`Moda Art House, Kadıköy ${RUN}`)} → \u2068Moda Art House, Studio 2` }),
    ).toHaveCount(1)
    await expect(page.getByRole("cell").filter({ hasText: `venue: ${WORKSHOPS.held.venue.fa}` })).toHaveCount(0)

    // The contract signature came from the instructor (no admin): shown as "System".
    await page.goto("/en/admin/audit?entity=contract")
    const signed = page.getByRole("row").filter({ hasText: "Contract signed" }).first()
    await expect(signed).toBeVisible()
    await expect(signed).toContainText("System")

    // Search, and a link from an entry to its record.
    await page.goto(`/en/admin/audit?entity=workshop&q=${encodeURIComponent("workshop.close")}`)
    const closed = page.getByRole("row").filter({ hasText: "Workshop closed" }).first()
    await expect(closed).toBeVisible()
    await closed.getByRole("link").first().click()
    await expect(page).toHaveURL(/\/en\/admin\/workshops\/[0-9a-f-]{36}$/)
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/workshop/i)

    // No private data in the log: the instructor's ID number is never written.
    const leak = await one<{ n: string }>("select count(*) as n from audit_log where data::text like $1", [`%${INSTRUCTORS.elif.idNumber}%`])
    expect(Number(leak.n)).toBe(0)
    test.info().annotations.push({ type: "workshops", description: `${WORKSHOPS.held.title.en}` })
  })

  test("the details of an entry can be opened", async ({ page }) => {
    await page.goto("/en/admin/audit?entity=ledger_transaction")
    const row = page.getByRole("row").filter({ hasText: "Expense recorded" }).first()
    await expect(row).toBeVisible()
    const more = row.getByRole("button", { name: "Show all details" })
    if (await more.count()) {
      await more.click()
      await expect(page.locator("main")).toContainText(/category|amount/i)
    }
  })
})
