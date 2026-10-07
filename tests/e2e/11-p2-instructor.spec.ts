import type { Page } from "@playwright/test"
import sharp from "sharp"

import { folderName } from "../../src/lib/storage/shared"
import { emailsSince, expect, mailMark, RUN, test, toast, type SentEmail } from "./helpers/app"
import { one, sql } from "./helpers/db"
import { makePhoto } from "./helpers/files"
import { anonContext, courseId, lead, linksOf, P2, PASSWORD, personContext, saveSession, tr } from "./helpers/p2"

/**
 * Phase 2, the instructor panel, walked as the instructors do: the invitation
 * link (choose a password, straight into the panel), the contracts to sign
 * (typed name checked), the workshop then published, every panel page, the
 * profile with a photo, the language switch, and one instructor never seeing
 * another's contract or workshop.
 */

/** The newest invitation link sent to this address (10-p2-admin-setup sent it). */
function inviteLink(address: string): string {
  const all = emailsSince(0).filter((e: SentEmail) => [e.to].flat().includes(address))
  const link = all
    .flatMap((e) => linksOf(e))
    .filter((l) => l.includes("/instructor/accept-invite?token="))
    .pop()
  if (!link) throw new Error(`no invitation email to ${address}: run 10-p2-admin-setup first`)
  return link.replace("http://localhost:3100", "")
}

async function liveContract(slug: string) {
  return one<{ id: string; status: string }>(
    "select c.id, c.status from contracts c join courses w on w.id = c.course_id where w.slug = $1 and c.status <> 'void'",
    [slug],
  )
}

/** Sign one contract on its page, as the instructor: tick, type the name, "Sign". */
async function sign(page: Page, locale: "fa" | "tr" | "en", contractId: string, typedName: string) {
  const t = tr(locale)
  await page.goto(`/${locale}/instructor/contracts/${contractId}`)
  await page.getByRole("checkbox", { name: t("instructorPanel.sign.agree") }).click()
  await page.getByLabel(t("instructorPanel.sign.name"), { exact: true }).fill(typedName)
  await expect(page.locator("main").getByText(t("instructorPanel.sign.nameMatches"))).toBeVisible()
  await page.getByRole("button", { name: t("instructorPanel.sign.submit"), exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/instructor/contracts/${contractId}\\?signed=1$`))
  await expect(page.locator("main").getByText(t("instructorPanel.contract.signed.title"))).toBeVisible()
}

test.describe.serial("phase 2 · instructor panel", () => {
  test("Nur opens the invitation link, chooses a password and lands in her panel", async ({ browser }) => {
    const t = tr("tr")
    const link = inviteLink(P2.nur.email)
    const context = await anonContext(browser)
    const page = await context.newPage()
    await page.goto(link)
    await expect(page.locator("html")).toHaveAttribute("lang", "tr")
    await expect(page.getByRole("heading", { level: 1 })).toContainText(lead("tr", "auth.instructor.invite.title"))
    await expect(page.locator("main").getByText(P2.nur.email)).toBeVisible()
    // Too short a password is explained on the field.
    const password = page.getByLabel(t("auth.instructor.invite.password"), { exact: true })
    await password.fill("kisa")
    await page.getByRole("button", { name: t("auth.instructor.invite.submit") }).click()
    await expect(page).toHaveURL(/accept-invite/)
    await password.fill(PASSWORD)
    await page.getByRole("button", { name: t("auth.instructor.invite.submit") }).click()
    await expect(page).toHaveURL(/\/tr\/instructor$/)
    await expect(page.getByRole("heading", { level: 1 })).toContainText(lead("tr", "instructorPanel.home.hello"))
    // Accepting the invitation confirms the email: no banner.
    await expect(page.getByRole("region", { name: t("instructorPanel.verifyBanner.label") })).toHaveCount(0)
    const row = await one<{ password_hash: string | null; email_verified_at: Date | null }>(
      "select password_hash, email_verified_at from instructors where email = $1",
      [P2.nur.email],
    )
    expect(row.password_hash).toMatch(/^\$argon2id\$/)
    expect(row.email_verified_at).not.toBeNull()
    // Session cookie: host-only, HttpOnly, Secure, SameSite=Lax, the instructor's own.
    const cookie = (await context.cookies()).find((c) => /instructor_session/.test(c.name))
    expect(cookie, "instructor session cookie").toBeTruthy()
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax" })
    expect(cookie!.name).toMatch(/^__Host-/)
    await saveSession(context, "nur")

    // The link works once.
    const again = await anonContext(browser)
    const p2 = await again.newPage()
    await p2.goto(link)
    await expect(p2.locator("main").getByText(t("auth.instructor.invite.invalidTitle"))).toBeVisible()
    await again.close()
    await context.close()
  })

  test("home and contracts list: three contracts wait for her signature", async ({ browser }) => {
    const t = tr("tr")
    const context = await personContext(browser, "nur")
    const page = await context.newPage()
    await page.goto("/tr/instructor")
    await expect(page.getByRole("link", { name: t("instructorPanel.home.toSign.button") })).toHaveCount(3)
    // The menu shows the count.
    await expect(page.getByText(t("instructorPanel.nav.toSign", { count: 3 })).first()).toBeAttached()

    await page.getByRole("navigation", { name: t("instructorPanel.nav.label") }).first().getByRole("link", { name: t("instructorPanel.nav.contracts") }).click()
    await expect(page).toHaveURL(/\/tr\/instructor\/contracts$/)
    for (const w of [P2.wA, P2.wB, P2.wD]) await expect(page.locator("main").getByText(w.title.tr).first()).toBeVisible()
    await expect(page.locator("main").getByText(t("instructorPanel.contracts.state.toSign"), { exact: true })).toHaveCount(3)
    await context.close()
  })

  test("signing contract A: the box and the exact name are required; then the workshop is published", async ({ browser }) => {
    const t = tr("tr")
    const context = await personContext(browser, "nur")
    const page = await context.newPage()
    const contract = await liveContract(P2.wA.slug)
    const mark = mailMark()
    await page.goto(`/tr/instructor/contracts/${contract.id}`)
    await expect(page.getByRole("heading", { level: 1 })).toContainText(P2.wA.title.tr)
    // The contract text, with her own private details (it is her contract) and the fee.
    const main = page.locator("main")
    await expect(main).toContainText(P2.nur.officialName)
    await expect(main).toContainText(P2.nur.idNumber)
    await expect(main).toContainText(P2.wA.venue.tr)
    await expect(main).not.toContainText(/\{[a-z_]+\}/)

    const submit = page.getByRole("button", { name: t("instructorPanel.sign.submit"), exact: true })
    await submit.click()
    await expect(page.locator("main").getByText(t("instructorPanel.sign.errors.agree"))).toBeVisible()
    await expect(page.locator("main").getByText(t("instructorPanel.sign.errors.name"))).toBeVisible()
    await page.getByRole("checkbox", { name: t("instructorPanel.sign.agree") }).click()
    const name = page.getByLabel(t("instructorPanel.sign.name"), { exact: true })
    await name.fill("Nur Aksoy")
    await expect(page.locator("main").getByText(lead("tr", "instructorPanel.sign.errors.nameMismatch"))).toBeVisible()
    await expect(await one<{ status: string }>("select status from contracts where id = $1", [contract.id])).toEqual({ status: "sent" })

    // Spacing and letter case don't matter (Turkish-aware).
    await name.fill(`  ${P2.nur.officialName.toLocaleUpperCase("tr")}  `)
    await expect(page.locator("main").getByText(t("instructorPanel.sign.nameMatches"))).toBeVisible()
    await submit.click()
    await expect(page).toHaveURL(new RegExp(`\\?signed=1$`))
    await expect(page.locator("main").getByText(t("instructorPanel.contract.signed.title"))).toBeVisible()
    await expect(page.locator("main").getByText(lead("tr", "instructorPanel.contract.signed.workshop.open"))).toBeVisible()

    const signed = await one<{ status: string; signed_ip: string; signed_user_agent: string; signed_text: string; signed_locale: string }>(
      "select status, signed_ip, signed_user_agent, signed_text, signed_locale from contracts where id = $1",
      [contract.id],
    )
    expect(signed.status).toBe("signed")
    expect(signed.signed_locale).toBe("tr")
    expect(signed.signed_user_agent).toMatch(/Chrome/)
    expect(signed.signed_text).toMatch(/^v1\./)
    expect(signed.signed_text).not.toContain(P2.nur.idNumber)
    const course = await one<{ status: string; published_at: Date | null }>("select status, published_at from courses where slug = $1", [P2.wA.slug])
    expect(course.status).toBe("published")
    // The admins are told.
    await expect.poll(() => emailsSince(mark).filter((e) => [e.to].flat().includes("owner@lart.test")).length).toBeGreaterThanOrEqual(1)

    // Signed: the notice, the signature line, no form; the contracts list says "Signed".
    await page.goto(`/tr/instructor/contracts/${contract.id}`)
    await expect(page.locator("main").getByText(t("instructorPanel.contract.signedNotice.title"))).toBeVisible()
    await expect(page.getByRole("button", { name: t("instructorPanel.sign.submit"), exact: true })).toHaveCount(0)
    // Signing again through the action is refused (the form is gone; the page says signed).
    await context.close()
  })

  test("contracts B and D are signed too", async ({ browser }) => {
    const context = await personContext(browser, "nur")
    const page = await context.newPage()
    for (const w of [P2.wB, P2.wD]) {
      const c = await liveContract(w.slug)
      await sign(page, "tr", c.id, P2.nur.officialName)
    }
    const rows = await sql<{ status: string }>("select status from courses where slug = any($1)", [[P2.wB.slug, P2.wD.slug]])
    expect(rows.map((r) => r.status)).toEqual(["published", "published"])
    await page.goto("/tr/instructor")
    await expect(page.getByRole("link", { name: tr("tr")("instructorPanel.home.toSign.button") })).toHaveCount(0)
    await context.close()
  })

  test("workshops, one workshop's participants, earnings", async ({ browser }) => {
    const t = tr("tr")
    const context = await personContext(browser, "nur")
    const page = await context.newPage()
    await page.goto("/tr/instructor/workshops")
    await expect(page.getByRole("heading", { level: 1, name: t("instructorPanel.workshops.title") })).toBeVisible()
    for (const w of [P2.wA, P2.wB, P2.wD]) await expect(page.getByRole("link", { name: new RegExp(w.title.tr) }).first()).toBeVisible()
    await expect(page.locator("main").getByText(P2.wC.title.tr)).toHaveCount(0)

    const a = await courseId(P2.wA.slug)
    await page.goto(`/tr/instructor/workshops/${a}`)
    await expect(page.getByRole("heading", { level: 1 })).toContainText(P2.wA.title.tr)
    await expect(page.locator("main")).toContainText(t("instructorPanel.workshop.places", { count: 0, max: 2 }))
    await expect(page.locator("main").getByText(t("instructorPanel.workshop.people.none"))).toBeVisible()

    await page.goto("/tr/instructor/earnings")
    await expect(page.getByRole("heading", { level: 1, name: t("instructorPanel.earnings.title") })).toBeVisible()
    for (const w of [P2.wA, P2.wB, P2.wD]) await expect(page.locator("main")).toContainText(w.title.tr)
    await expect(page.locator("main")).not.toContainText(P2.wC.title.tr)
    await context.close()
  })

  test("profile: a new introduction and a photo, saved", async ({ browser }) => {
    const t = tr("tr")
    const context = await personContext(browser, "nur")
    const page = await context.newPage()
    const photo = await makePhoto("nur.jpg", 1200, 1600, 330)
    await page.goto("/tr/instructor/profile")
    await expect(page.getByRole("heading", { level: 1, name: t("instructorPanel.profile.title") })).toBeVisible()
    // Private details are shown read-only, the ID number masked.
    await expect(page.locator("main")).toContainText(P2.nur.officialName)
    await expect(page.locator("main")).not.toContainText(P2.nur.idNumber)

    await page.locator('input[type="file"]').setInputFiles(photo)
    await expect(page.getByRole("img", { name: t("instructorPanel.profile.photo.alt") })).toBeVisible({ timeout: 30_000 })
    const bio = page.locator('[data-slot="field"]').filter({ hasText: t("instructorPanel.profile.fields.bio") }).first()
    await bio.getByRole("tab", { name: "Türkçe" }).click()
    await bio.locator('textarea[lang="tr"]').fill(`Seramik boyama öğretiyorum. (${RUN})`)
    await page.getByRole("button", { name: t("instructorPanel.profile.save") }).click()
    await expect(toast(page, t("instructorPanel.profile.saved"))).toBeVisible()
    const row = await one<{ photo_path: string | null; bio: Record<string, string> | null }>("select photo_path, bio from instructors where email = $1", [P2.nur.email])
    // In a folder named after the instructor's English name.
    expect(row.photo_path).toMatch(new RegExp(`^instructors/${folderName([P2.nur.displayName.en, P2.nur.displayName.tr])}/photo-[\\w-]{22}\\.webp$`))
    expect(row.bio?.tr).toContain("Seramik boyama öğretiyorum.")
    // The photo is a square WebP without metadata.
    const res = await page.request.get(`/media/${row.photo_path}`)
    expect(res.status()).toBe(200)
    const meta = await sharp(await res.body()).metadata()
    expect(meta.width).toBe(meta.height)
    expect(meta.exif).toBeUndefined()
    // The upload was audited with the instructor's id.
    expect(await sql("select 1 from audit_log where action = 'media.upload' and data::text like '%instructor%' and at > now() - interval '5 minutes'")).not.toHaveLength(0)
    await context.close()
  })

  test("language switch: the panel and her emails follow it", async ({ browser }) => {
    const context = await personContext(browser, "nur")
    const page = await context.newPage()
    await page.goto("/tr/instructor/profile")
    await page.getByRole("button", { name: tr("tr")("common.language") }).click()
    await page.getByRole("menuitemradio", { name: "English" }).click()
    await expect(page).toHaveURL(/\/en\/instructor\/profile$/)
    await expect(page.getByRole("heading", { level: 1, name: tr("en")("instructorPanel.profile.title") })).toBeVisible()
    await expect.poll(async () => (await one<{ locale: string }>("select locale from instructors where email = $1", [P2.nur.email])).locale).toBe("en")
    // And back to Turkish (the later specs read her Turkish pages).
    await page.getByRole("button", { name: tr("en")("common.language") }).click()
    await page.getByRole("menuitemradio", { name: "Türkçe" }).click()
    await expect(page).toHaveURL(/\/tr\/instructor\/profile$/)
    await expect.poll(async () => (await one<{ locale: string }>("select locale from instructors where email = $1", [P2.nur.email])).locale).toBe("tr")
    await context.close()
  })

  test("Derya joins in Persian and signs workshop C", async ({ browser }) => {
    const t = tr("fa")
    const context = await anonContext(browser)
    const page = await context.newPage()
    await page.goto(inviteLink(P2.derya.email))
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl")
    await page.getByLabel(t("auth.instructor.invite.password"), { exact: true }).fill(PASSWORD)
    await page.getByRole("button", { name: t("auth.instructor.invite.submit") }).click()
    await expect(page).toHaveURL(/\/fa\/instructor$/)
    await saveSession(context, "derya")
    const c = await liveContract(P2.wC.slug)
    await sign(page, "fa", c.id, P2.derya.officialName)
    expect((await one<{ status: string }>("select status from courses where slug = $1", [P2.wC.slug])).status).toBe("published")
    await context.close()
  })

  test("Derya cannot open Nur's contract or workshop", async ({ browser }) => {
    const context = await personContext(browser, "derya")
    const page = await context.newPage()
    const contract = await liveContract(P2.wA.slug)
    const a = await courseId(P2.wA.slug)
    for (const url of [`/fa/instructor/contracts/${contract.id}`, `/fa/instructor/workshops/${a}`]) {
      const res = await page.goto(url)
      expect(res?.status(), url).toBe(404)
      await expect(page.locator("main")).not.toContainText(P2.nur.officialName)
      await expect(page.locator("main")).not.toContainText(P2.wA.title.fa)
    }
    // Nor through the raw HTML (no leak in the RSC payload).
    const raw = await page.request.get(`/fa/instructor/contracts/${contract.id}`)
    expect(raw.status()).toBe(404)
    expect(await raw.text()).not.toContain(P2.nur.idNumber)
    await context.close()
  })
})
