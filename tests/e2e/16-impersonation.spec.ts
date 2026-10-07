import type { Browser, Page } from "@playwright/test"

import { ADMIN, at, expect, mailMark, RUN, RUN_NAME, shot, test, toast } from "./helpers/app"
import { one, sql } from "./helpers/db"
import {
  anonContext,
  captureAction,
  CATEGORY,
  createWorkshop,
  fillInstructor,
  memberLogin,
  PASSWORD,
  randomIp,
  replayAction,
  tr,
  waitMail,
  type CapturedAction,
} from "./helpers/p2"

/**
 * Students area, "Change password" and "Enter their panel" (viewing as
 * someone): an admin finds a student, gives them a generated password (the
 * student logs in with it), enters the student's account (the bar, no
 * registering: hidden and refused by the server), ends it and comes back;
 * the same for an instructor (no contract signing); the viewing ends after
 * the hour and when the admin signs out. Runs last: it only adds its own people.
 */

const t = tr("en")
const BLOCKED = "viewing as this person"
/** A name as the app puts it inside a sentence: bidi-isolated (U+2068 … U+2069). */
const isolate = (text: string) => `\u2068${text}\u2069`

const student = { name: `Imp Student ${RUN_NAME}`, email: `imp-student.${RUN}@member.test` }
const teacher = {
  displayName: { fa: `مدرس ${RUN}`, tr: `Imp Eğitmen ${RUN}`, en: `Imp Teacher ${RUN}` },
  teachingField: { fa: "سفال", tr: "Seramik", en: "Ceramics" },
  officialName: `Imp Teacher Official ${RUN}`,
  idNumber: "55667788990",
  mobile: "+90 536 555 66 77",
  email: `imp-teacher.${RUN}@lart.test`,
}

const owner = () => one<{ id: string }>("select id from admins where email = $1", [ADMIN.email])

/** Confirm "Enter their account / panel" on a person's admin page. */
async function enter(page: Page, kind: "member" | "instructor") {
  const label = t(`admin.access.enter.${kind}.trigger`)
  await page.getByRole("button", { name: label, exact: true }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: t(`admin.access.enter.${kind}.confirm`), exact: true }).click()
}

/** The "viewing as" bar (its label in the page's language). */
const bar = (page: Page, locale: "en" | "fa" = "en") => page.getByRole("region", { name: tr(locale)("common.impersonation.label") })

async function instructorContext(browser: Browser) {
  const context = await anonContext(browser)
  const page = await context.newPage()
  await page.goto("/en/instructor/login")
  await page.getByLabel(t("account.form.email")).fill(teacher.email)
  await page.getByLabel(t("account.form.password"), { exact: true }).fill(PASSWORD)
  await page.getByRole("button", { name: t("account.login.submit") }).click()
  await expect(page).toHaveURL(/\/en\/instructor$/)
  return { context, page }
}

test.describe.serial("students, set password, viewing as someone", () => {
  let studentId = ""
  let slug = ""
  let generated = ""
  let registerCapture: CapturedAction

  test.beforeAll(async () => {
    const [row] = await sql<{ id: string }>(
      "insert into members (email, name, password_hash, locale, email_verified_at) values ($1, $2, 'x', 'en', now()) returning id",
      [student.email, student.name],
    )
    studentId = row.id
    // An open workshop with a free place (earlier specs and runs leave some).
    const open = await sql<{ slug: string }>(
      `select c.slug from courses c
        where c.status in ('published', 'confirmed') and c.closed_at is null and c.cancelled_at is null
          and c.registration_deadline > now() + interval '1 hour' and c.starts_at > now()
          and (select count(*) from registrations r where r.course_id = c.id and r.status <> 'cancelled')
              < coalesce(c.final_participants, c.max_capacity)
        order by c.registration_deadline limit 1`,
    )
    expect(open.length, "an open workshop from the earlier specs").toBe(1)
    slug = open[0].slug
  })

  test("the students list finds the student; the detail page shows the account", async ({ page }) => {
    await page.goto(`/en/admin/students?q=${encodeURIComponent(student.email)}`)
    await expect(page.getByRole("heading", { level: 1, name: t("students.title") })).toBeVisible()
    const link = page.getByRole("link", { name: new RegExp(student.name) })
    await expect(link).toBeVisible()
    await link.click()
    await expect(page).toHaveURL(new RegExp(`/en/admin/students/${studentId}$`))
    await expect(page.getByRole("heading", { level: 1, name: student.name })).toBeVisible()
    await expect(page.getByText(t("students.detail.emailConfirmed"))).toBeVisible()
    await expect(page.getByText(t("students.detail.registrations.empty"))).toBeVisible()
  })

  test("Change password → Generate: shown once, the student is emailed and logs in with it", async ({ page, browser }) => {
    const mark = mailMark()
    await page.goto(`/en/admin/students/${studentId}`)
    await page.getByRole("button", { name: t("admin.access.password.trigger"), exact: true }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByRole("heading", { name: t("admin.access.password.dialogTitle", { name: isolate(student.name) }) })).toBeVisible()
    await dialog.getByRole("button", { name: t("admin.access.password.generate") }).click()
    const box = dialog.getByLabel(t("admin.access.password.result.label"))
    await expect(box).toBeVisible()
    generated = await box.inputValue()
    expect(generated).toMatch(/^[a-hjkmnp-zA-HJ-NP-Z2-9]{4}(-[a-hjkmnp-zA-HJ-NP-Z2-9]{4}){3}$/)
    await expect(dialog.getByText(t("admin.access.password.result.emailed", { name: isolate(student.name) }))).toBeVisible()
    const email = await waitMail(student.email, mark, /password was changed/)
    expect(email.html).not.toContain(generated)
    await dialog.getByRole("button", { name: t("common.actions.close") }).click()
    // Opening the dialog again never shows the password again.
    await page.getByRole("button", { name: t("admin.access.password.trigger"), exact: true }).click()
    await expect(page.getByRole("dialog").getByLabel(t("admin.access.password.result.label"))).toHaveCount(0)
    await page.keyboard.press("Escape")

    const context = await anonContext(browser)
    const p = await context.newPage()
    await memberLogin(p, "en", student.email, generated)
    await expect(p).toHaveURL(/\/en\/workshops/)
    // The student's own register form: capture the "Register" post (aborted) to replay it while viewing.
    await p.goto(`/en/workshops/${slug}/register`)
    await p.getByRole("checkbox", { name: t("registration.register.acceptTerms") }).click()
    registerCapture = await captureAction(p, () =>
      p.getByRole("button", { name: t("registration.register.submit"), exact: true }).click(),
    )
    await context.close()
  })

  test("Enter their account: the bar, no registering (hidden and refused), End returns", async ({ page }) => {
    await page.goto(`/en/admin/students/${studentId}`)
    await enter(page, "member")
    await expect(page).toHaveURL(/\/en\/account$/)
    await expect(bar(page)).toBeVisible()
    await expect(bar(page)).toContainText(student.name)
    await expect(bar(page)).toContainText(ADMIN.name)
    await expect(page.getByRole("link", { name: t("registration.account.changePassword") })).toHaveCount(0)
    await expect(page.getByText(t("registration.account.passwordImpersonating"))).toBeVisible()

    await page.goto(`/en/workshops/${slug}/register`)
    await expect(page.getByRole("heading", { level: 1, name: t("registration.register.impersonating.title") })).toBeVisible()
    await expect(page.getByRole("button", { name: t("registration.register.submit"), exact: true })).toHaveCount(0)
    const replay = await replayAction(page.request, registerCapture)
    expect(replay.text).toContain(BLOCKED)
    expect((await one<{ n: number }>("select count(*)::int as n from registrations where member_id = $1", [studentId])).n).toBe(0)

    // Persian: the bar reads right to left.
    await page.goto("/fa/account")
    await expect(bar(page, "fa")).toContainText(student.name)
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl")
    await shot(page, "p2-impersonation-bar-fa")

    await page.goto("/en/account")
    await bar(page).getByRole("button", { name: t("common.impersonation.end") }).click()
    await expect(page).toHaveURL(new RegExp(`/en/admin/students/${studentId}$`))
    await page.goto("/en/account")
    await expect(page).toHaveURL(/\/en\/account\/login\?next=/)

    const { id: ownerId } = await owner()
    const audit = await sql<{ action: string; admin_id: string | null }>(
      "select action, admin_id from audit_log where entity = 'member' and entity_id = $1 order by at",
      [studentId],
    )
    expect(audit.map((a) => a.action)).toEqual(["member.password_set", "member.impersonate", "member.impersonate_end"])
    expect(audit.every((a) => a.admin_id === ownerId)).toBe(true)
  })

  test("a viewing session ends after one hour", async ({ page }) => {
    await page.goto(`/en/admin/students/${studentId}`)
    await enter(page, "member")
    await expect(bar(page)).toBeVisible()
    const { id: ownerId } = await owner()
    await sql(
      "update sessions set created_at = now() - interval '61 minutes', expires_at = now() - interval '1 minute' where impersonated_by = $1",
      [ownerId],
    )
    await page.goto("/en/account")
    await expect(page).toHaveURL(/\/en\/account\/login\?next=/)
    const left = await one<{ n: number }>("select count(*)::int as n from sessions where subject_id = $1 and impersonated_by = $2", [
      studentId,
      ownerId,
    ])
    expect(left.n).toBe(0)
  })

  test("an instructor: password set by the admin, no signing while viewing, End returns", async ({ page, browser }) => {
    test.setTimeout(240_000)
    // A category of this run for the workshop (10-p2-admin-setup makes it; a run of this spec alone needs it too).
    await sql(
      "insert into categories (slug, name) select $1, $2::jsonb where not exists (select 1 from categories where name->>'en' = $3)",
      [`imp-${RUN}`, JSON.stringify(CATEGORY), CATEGORY.en],
    )
    await page.goto("/en/admin/instructors/new")
    await fillInstructor(page, teacher)
    await page.getByRole("button", { name: "Add and send invitation" }).click()
    await expect(toast(page, /Instructor added/)).toBeVisible()
    const { id } = await one<{ id: string }>("select id from instructors where email = $1", [teacher.email])

    // Set a typed password: the invitation is used up, the account is complete.
    const mark = mailMark()
    await page.goto(`/en/admin/instructors/${id}`)
    await page.getByRole("button", { name: t("admin.access.password.trigger"), exact: true }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByLabel(t("admin.access.password.field"), { exact: true }).fill(PASSWORD)
    await dialog.getByRole("button", { name: t("admin.access.password.save") }).click()
    await expect(toast(page, t("admin.access.password.saved", { name: isolate(teacher.displayName.en) }))).toBeVisible()
    await waitMail(teacher.email, mark, /password was changed/)
    await page.reload()
    await expect(page.getByRole("button", { name: /Send invitation/ })).toHaveCount(0)
    expect((await one<{ n: number }>("select count(*)::int as n from email_tokens where subject_id = $1 and purpose = 'invite'", [id])).n).toBe(0)

    // A workshop for them: its contract waits for their signature.
    await createWorkshop(page, {
      title: { fa: `ورکشاپ ${RUN}`, tr: `Imp atölye ${RUN}`, en: `Imp workshop ${RUN}` },
      instructor: teacher.displayName.en,
      date: 30,
      start: "14:00",
      end: "16:00",
      deadline: [28, "12:00"],
      decision: [27, "12:00"],
      venue: { tr: `Imp Stüdyo ${RUN}` },
      min: 2,
      max: 8,
      price: "500",
      fee: "100",
    })
    const contract = await one<{ id: string }>(
      "select c.id from contracts c join courses w on w.id = c.course_id where c.instructor_id = $1 and c.status = 'sent'",
      [id],
    )

    // The instructor logs in with the new password and starts signing: the post is captured (aborted).
    const own = await instructorContext(browser)
    await own.page.goto(`/en/instructor/contracts/${contract.id}`)
    await own.page.getByRole("checkbox", { name: t("instructorPanel.sign.agree") }).click()
    await own.page.getByLabel(t("instructorPanel.sign.name"), { exact: true }).fill(teacher.officialName)
    const signCapture = await captureAction(own.page, () =>
      own.page.getByRole("button", { name: t("instructorPanel.sign.submit"), exact: true }).click(),
    )
    await own.context.close()

    // The admin enters their panel: the bar on every page, no sign form, the server refuses.
    await page.goto(`/en/admin/instructors/${id}`)
    await enter(page, "instructor")
    await expect(page).toHaveURL(/\/en\/instructor$/)
    await expect(bar(page)).toContainText(teacher.displayName.en)
    await expect(bar(page)).toContainText(ADMIN.name)
    await page.goto(`/en/instructor/contracts/${contract.id}`)
    await expect(bar(page)).toBeVisible()
    await expect(page.getByText(t("instructorPanel.contract.impersonating.title"))).toBeVisible()
    await expect(page.getByRole("button", { name: t("instructorPanel.sign.submit"), exact: true })).toHaveCount(0)
    const replay = await replayAction(page.request, signCapture)
    expect(replay.text).toContain(BLOCKED)
    expect((await one<{ status: string }>("select status from contracts where id = $1", [contract.id])).status).toBe("sent")

    await bar(page).getByRole("button", { name: t("common.impersonation.end") }).click()
    await expect(page).toHaveURL(new RegExp(`/en/admin/instructors/${id}$`))
    const { id: ownerId } = await owner()
    const ends = await sql<{ admin_id: string }>(
      "select admin_id from audit_log where action = 'instructor.impersonate_end' and entity_id = $1",
      [id],
    )
    expect(ends).toEqual([{ admin_id: ownerId }])
  })

  test("signing out of the admin panel ends the viewing too", async ({ browser }) => {
    // A fresh browser (the shared admin session of the suite stays signed in).
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { "x-real-ip": randomIp() } })
    const page = await context.newPage()
    await page.goto("/en/admin/login")
    await page.getByLabel("Email").fill(ADMIN.email)
    await page.getByLabel("Password", { exact: true }).fill(ADMIN.password)
    await page.getByRole("button", { name: "Sign in" }).click()
    await expect(page).toHaveURL(/\/en\/admin$/)
    await page.goto(`/en/admin/students/${studentId}`)
    await enter(page, "member")
    await expect(bar(page)).toBeVisible()

    await page.goto("/en/admin")
    await page.getByRole("button", { name: "Your account" }).click()
    await page.getByRole("menuitem", { name: "Sign out" }).click()
    await expect(page).toHaveURL(/\/en\/admin\/login$/)
    await page.goto(at("en", "/account"))
    await expect(page).toHaveURL(/\/en\/account\/login\?next=/)
    const { id: ownerId } = await owner()
    expect((await one<{ n: number }>("select count(*)::int as n from sessions where impersonated_by = $1", [ownerId])).n).toBe(0)
    await context.close()
  })
})
