import type { Page } from "@playwright/test"
import sharp from "sharp"

import { expect, field, fillLocalized, mailMark, serverLog, serverLogSize, test, toast, waitForEmail } from "./helpers/app"
import { INSTRUCTORS } from "./helpers/data"
import { one, sql } from "./helpers/db"
import { makePhoto } from "./helpers/files"

type Person = (typeof INSTRUCTORS)[keyof typeof INSTRUCTORS]

async function fillInstructor(page: Page, p: Person, photo: string | null, languages: RegExp[]) {
  await fillLocalized(page, "Display name", p.displayName)
  await fillLocalized(page, "Teaching field", p.teachingField)
  await field(page, "Official full name").getByRole("textbox").fill(p.officialName)
  await field(page, "ID number").getByRole("textbox").fill(p.idNumber)
  await field(page, "Mobile number").getByRole("textbox").fill(p.mobile)
  await field(page, /^Email/).getByRole("textbox").fill(p.email)
  if (photo) {
    await field(page, "Profile photo").locator('input[type="file"]').setInputFiles(photo)
    await expect(field(page, "Profile photo").getByRole("img", { name: "Uploaded photo" })).toBeVisible({ timeout: 30_000 })
  }
  await fillLocalized(page, "Short introduction", p.bio)
  for (const lang of languages) {
    await field(page, "Teaching languages").getByRole("combobox").click()
    await page.getByRole("option", { name: lang }).click()
    await page.keyboard.press("Escape")
  }
  await field(page, "Instagram or website").getByRole("textbox").fill(p.website)
}

/** The invitation result: sent, or "added but no email" (production without RESEND_API_KEY). */
async function invitationToast(page: Page) {
  const sent = toast(page, "Instructor added. We’ve emailed them their invitation.")
  const notSent = toast(page, "Instructor added, but we couldn’t send the invitation email.")
  await expect(sent.or(notSent)).toBeVisible()
  return (await sent.isVisible()) ? "sent" : "not-sent"
}

test.describe.serial("instructors", () => {
  test("create Elif with every field and a profile photo", async ({ page }) => {
    const photo = await makePhoto("elif.jpg", 1600, 1200, 15)
    const logStart = serverLogSize()
    const mark = mailMark()
    await page.goto("/en/admin/instructors/new")
    await expect(page.getByRole("heading", { level: 1, name: "New instructor" })).toBeVisible()
    await fillInstructor(page, INSTRUCTORS.elif, photo, [/^Persian/, /^Turkish/, /^English/])
    await expect(field(page, "Teaching languages").getByRole("listitem")).toHaveCount(3)
    await field(page, "Email language").getByRole("radio", { name: "English" }).click()
    await page.getByRole("button", { name: "Add and send invitation" }).click()
    const result = await invitationToast(page)
    test.info().annotations.push({ type: "invite", description: result })
    await expect(page).toHaveURL(/\/en\/admin\/instructors\/[0-9a-f-]{36}$/)

    // Stored as typed, normalised, the ID number encrypted.
    const row = await one<{
      mobile: string
      website: string
      teaching_languages: string[]
      id_number_enc: string
      photo_path: string
      display_name: Record<string, string>
    }>("select * from instructors where email = $1", [INSTRUCTORS.elif.email])
    expect(row.mobile).toBe("+905321234567")
    expect(row.website).toBe(`https://www.instagram.com/${INSTRUCTORS.elif.website.slice(1)}`)
    expect(row.teaching_languages).toEqual(["fa", "tr", "en"])
    expect(row.id_number_enc).not.toContain(INSTRUCTORS.elif.idNumber)
    expect(row.photo_path).toMatch(/^instructors\/\d{4}-\d{2}\/[\w-]+\.webp$/)
    expect(row.display_name.en).toBe(INSTRUCTORS.elif.displayName.en)

    // The photo is a square WebP of at most 800 px, without metadata.
    const img = page.locator("img[src*='instructors/']").first()
    await expect(img).toBeVisible()
    const src = (await img.getAttribute("src"))!
    const res = await page.request.get(src)
    expect(res.status()).toBe(200)
    expect(res.headers()["content-type"]).toBe("image/webp")
    const meta = await sharp(await res.body()).metadata()
    expect(meta.format).toBe("webp")
    expect(meta.width).toBe(meta.height)
    expect(meta.width).toBeLessThanOrEqual(800)
    expect(meta.exif).toBeUndefined()

    // The invitation email, in English, with a one-time link.
    const email = await waitForEmail(INSTRUCTORS.elif.email, mark, logStart)
    test.info().annotations.push({ type: "server-log", description: serverLog(logStart).slice(0, 2000) })
    expect(result, "the invitation toast says the email was not sent").toBe("sent")
    expect(email, "no invitation email was sent or logged").not.toBeNull()
    expect(email!.links.join(" ")).toMatch(/http:\/\/localhost:3100\/en\/instructor\/accept-invite\?token=[\w-]{20,}/)
    expect(email!.subject).not.toMatch(/\{|\}|\w+\.\w+\.\w+/)
    test.info().annotations.push({ type: "email", description: `${email!.subject}\n${email!.text}` })
  })

  test("detail page: masked ID number, reveal and hide", async ({ page }) => {
    const { id } = await one<{ id: string }>("select id from instructors where email = $1", [INSTRUCTORS.elif.email])
    await page.goto(`/en/admin/instructors/${id}`)
    await expect(page.getByRole("heading", { level: 1 })).toContainText(INSTRUCTORS.elif.displayName.en)
    await expect(page.getByText("••••••901")).toBeVisible()
    await expect(page.getByText(INSTRUCTORS.elif.idNumber)).toHaveCount(0)
    // Private details are on the page for admins.
    await expect(page.getByText(INSTRUCTORS.elif.officialName).first()).toBeVisible()
    await expect(page.getByText(INSTRUCTORS.elif.email).first()).toBeVisible()

    await page.getByRole("button", { name: "Show the full ID number" }).click()
    await expect(page.getByText(INSTRUCTORS.elif.idNumber)).toBeVisible()
    await page.getByRole("button", { name: "Hide", exact: true }).click()
    await expect(page.getByText("••••••901")).toBeVisible()

    // Each reveal is audited, without the number itself.
    const audit = await sql<{ data: unknown }>("select data from audit_log where action = 'instructor.reveal_id' and entity_id = $1", [id])
    expect(audit).toHaveLength(1)
    expect(JSON.stringify(audit[0].data ?? null)).not.toContain(INSTRUCTORS.elif.idNumber)
  })

  test("create Sara (per-participant instructor), then a duplicate email is refused", async ({ page }) => {
    const photo = await makePhoto("sara.jpg", 900, 1400, 200)
    await page.goto("/en/admin/instructors/new")
    await fillInstructor(page, INSTRUCTORS.sara, photo, [/^Turkish/, /^German/])
    await field(page, "Email language").getByRole("radio", { name: "Türkçe" }).click()
    await page.getByRole("button", { name: "Add and send invitation" }).click()
    await invitationToast(page)
    await expect(page).toHaveURL(/\/en\/admin\/instructors\/[0-9a-f-]{36}$/)

    await page.goto("/en/admin/instructors/new")
    await fillInstructor(page, { ...INSTRUCTORS.sara, email: INSTRUCTORS.elif.email.toUpperCase() }, null, [])
    await page.getByRole("button", { name: "Add and send invitation" }).click()
    await expect(field(page, /^Email\*?(Required)?$/)).toContainText("Another instructor already uses this email address.")
    await expect(page).toHaveURL(/\/instructors\/new$/)
  })

  test("validation messages: bad mobile, bad ID number", async ({ page }) => {
    await page.goto("/en/admin/instructors/new")
    await fillInstructor(page, { ...INSTRUCTORS.sara, email: "x-valid@lart.test", mobile: "0532", idNumber: "12 3" }, null, [])
    await page.getByRole("button", { name: "Add and send invitation" }).click()
    await expect(field(page, "Mobile number")).toContainText("country code")
    await expect(field(page, "ID number")).toContainText("5 to 20 letters and numbers")
  })

  test("resend the invitation in Turkish", async ({ page }) => {
    const { id } = await one<{ id: string }>("select id from instructors where email = $1", [INSTRUCTORS.elif.email])
    const logStart = serverLogSize()
    const mark = mailMark()
    await page.goto(`/en/admin/instructors/${id}`)
    await page.getByRole("button", { name: /Send invitation/ }).click()
    await page.getByRole("menuitem", { name: "Türkçe" }).click()
    const ok = toast(page, "Invitation sent.")
    const failed = toast(page, "We couldn’t send the invitation email.")
    await expect(ok.or(failed)).toBeVisible()
    const email = await waitForEmail(INSTRUCTORS.elif.email, mark, logStart)
    expect(await ok.isVisible(), `resend failed; server log:\n${serverLog(logStart).slice(0, 1500)}`).toBe(true)
    expect(email).not.toBeNull()
    expect(email!.links.join(" ")).toMatch(/\/tr\/instructor\/accept-invite\?token=/)
    // The new link replaces the old one: only one open invitation token.
    const tokens = await sql("select 1 from email_tokens where subject_id = $1 and purpose = 'invite' and used_at is null", [id])
    expect(tokens).toHaveLength(1)
  })

  test("edit Elif: new mobile, ID number kept when empty", async ({ page }) => {
    const { id } = await one<{ id: string }>("select id from instructors where email = $1", [INSTRUCTORS.elif.email])
    const before = await one<{ id_number_enc: string }>("select id_number_enc from instructors where id = $1", [id])
    await page.goto(`/en/admin/instructors/${id}`)
    await page.getByRole("link", { name: "Edit profile" }).click()
    await expect(page).toHaveURL(/\/edit$/)
    await expect(field(page, "ID number")).toContainText("Leave empty to keep the current one (••••••901)")
    await field(page, "Mobile number").getByRole("textbox").fill("+90 533 765 43 21")
    await page.getByRole("button", { name: "Save changes" }).click()
    await expect(toast(page, "Changes saved.")).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/instructors/${id}$`))
    const after = await one<{ id_number_enc: string; mobile: string }>("select id_number_enc, mobile from instructors where id = $1", [id])
    expect(after.mobile).toBe("+905337654321")
    expect(after.id_number_enc).toBe(before.id_number_enc)
  })

  test("the list shows both, with search", async ({ page }) => {
    await page.goto("/en/admin/instructors")
    await expect(page.getByRole("link", { name: new RegExp(INSTRUCTORS.elif.displayName.en) }).first()).toBeVisible()
    await expect(page.getByRole("link", { name: new RegExp(INSTRUCTORS.sara.displayName.en) }).first()).toBeVisible()
    await page.getByPlaceholder("Search by name or email…").fill(INSTRUCTORS.sara.email)
    await expect(page).toHaveURL(/q=/)
    await expect(page.getByRole("link", { name: new RegExp(INSTRUCTORS.elif.displayName.en) })).toHaveCount(0)
  })
})
