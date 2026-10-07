import type { BrowserContext, Page } from "@playwright/test"

import { expect, mailMark, RUN, settle, test, toast } from "./helpers/app"
import { one, sql } from "./helpers/db"
import { anonContext, courseId, lead, linksOf, mailTo, P2, PASSWORD, personContext, saveSession, tr, waitMail, type Member } from "./helpers/p2"

/**
 * Phase 2, the students on the public site: sign up (and the same screen for
 * an address that already has an account), confirm the email from the link,
 * browse the workshops (SEO tags and JSON-LD), register (terms required,
 * photo / video choices), the payment instructions (cash, IBAN with a copy
 * button, the workshop's online payment link) and the email with the same
 * ways, My workshops, the last seat, a full workshop and cancelling.
 */

type Locale = "fa" | "tr" | "en"
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const IBAN_GROUPED = "TR33 0006 1005 1978 6457 8413 26"

/** Sign up on the site and confirm the email from the welcome email; the context keeps the session. */
async function signUpAndVerify(context: BrowserContext, who: Member, locale: Locale) {
  const t = tr(locale)
  const page = await context.newPage()
  const mark = mailMark()
  await page.goto(`/${locale}/account/signup`)
  await page.getByLabel(t("account.signup.name")).fill(who.name)
  await page.getByLabel(t("account.form.email")).fill(who.email)
  await page.getByLabel(t("account.form.password"), { exact: true }).fill(PASSWORD)
  if (who.phone) await page.getByLabel(new RegExp(`^${escape(t("account.signup.phone"))}`)).fill(who.phone)
  await page.getByRole("button", { name: t("account.signup.submit") }).click()
  await expect(page).toHaveURL(new RegExp(`/${locale}/workshops`))
  await expect(toast(page, t("site.notices.checkEmail"))).toBeVisible()
  await expect(page.getByRole("region", { name: t("site.verifyBanner.label") })).toBeVisible()

  // The first email to a new address is the welcome email with the confirmation link.
  const email = await waitMail(who.email, mark, /./)
  const link = linksOf(email).find((l) => l.includes("/account/verify?token="))
  expect(link, linksOf(email).join(" ")).toMatch(new RegExp(`^http://localhost:3100/${locale}/account/verify\\?token=[\\w-]{20,}$`))
  await page.goto(link!.replace("http://localhost:3100", ""))
  await expect(page.locator("main").getByText(t("account.verify.doneTitle"))).toBeVisible()
  await page.getByRole("link", { name: t("account.verify.continue") }).click()
  await expect(page).toHaveURL(new RegExp(`/${locale}/workshops$`))
  await expect(page.getByRole("region", { name: t("site.verifyBanner.label") })).toHaveCount(0)
  const row = await one<{ email_verified_at: Date | null; locale: string }>("select email_verified_at, locale from members where email = $1", [who.email])
  expect(row.email_verified_at).not.toBeNull()
  expect(row.locale).toBe(locale)
  return page
}

/** Register on a workshop's register page; returns the new registration's id. */
async function register(page: Page, locale: Locale, slug: string, participant?: string, consent: { photo?: boolean; video?: boolean } = {}) {
  const t = tr(locale)
  await page.goto(`/${locale}/workshops/${slug}/register`)
  if (participant !== undefined) await page.getByLabel(t("registration.register.participant")).fill(participant)
  await page.getByRole("checkbox", { name: t("registration.register.acceptTerms") }).click()
  if (consent.photo) await page.getByRole("checkbox", { name: t("registration.register.consent.photo") }).click()
  if (consent.video) await page.getByRole("checkbox", { name: t("registration.register.consent.video") }).click()
  await page.getByRole("button", { name: t("registration.register.submit"), exact: true }).click()
  await expect(page).toHaveURL(/\/account\/registrations\/[0-9a-f-]{36}\?welcome=1$/)
  return /registrations\/([0-9a-f-]{36})/.exec(page.url())![1]
}

test.describe.serial("phase 2 · students", () => {
  test("Ayla signs up in Turkish: straight back to the site, the banner, then the link confirms her email", async ({ browser }) => {
    const t = tr("tr")
    const context = await anonContext(browser)
    const page = await context.newPage()
    // The header offers "Log in / Sign up", coming back to this page.
    await page.goto("/tr/workshops")
    const login = page.getByRole("link", { name: t("site.header.logInOrSignUp") })
    await expect(login).toHaveAttribute("href", /\/tr\/account\/login\?next=%2Ftr%2Fworkshops$/)
    await login.click()
    await expect(page).toHaveURL(/\/tr\/account\/login\?next=/)
    // The first click can be lost (see the standalone test below); a second one goes through.
    await page.getByRole("link", { name: t("account.login.signUp") }).click()
    await page.waitForURL(/\/tr\/account\/signup/, { timeout: 3_000 }).catch(() => page.getByRole("link", { name: t("account.login.signUp") }).click())
    await expect(page).toHaveURL(/\/tr\/account\/signup/)
    // Empty form: the friendly messages, nothing sent.
    await page.getByRole("button", { name: t("account.signup.submit") }).click()
    await expect(page.getByRole("alert").first()).toBeVisible()
    await page.close()

    const verified = await signUpAndVerify(context, P2.ayla, "tr")
    // The account menu shows her first name.
    await expect(verified.getByRole("button", { name: t("site.header.account") })).toContainText(P2.ayla.name.split(" ")[0])
    const cookie = (await context.cookies()).find((c) => /member_session/.test(c.name))
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax" })
    expect(cookie!.name).toMatch(/^__Host-/)
    expect((await one<{ phone: string | null }>("select phone from members where email = $1", [P2.ayla.email])).phone).toBe("+905320001122")
    await saveSession(context, "ayla")
    await context.close()
  })

  test("signing up again with Ayla's address: the same screen, nothing changes, she gets member_exists", async ({ browser }) => {
    const t = tr("tr")
    const before = await one<{ password_hash: string }>("select password_hash from members where email = $1", [P2.ayla.email])
    const context = await anonContext(browser)
    const page = await context.newPage()
    const mark = mailMark()
    await page.goto("/tr/account/signup")
    await page.getByLabel(t("account.signup.name")).fill("Someone Else")
    await page.getByLabel(t("account.form.email")).fill(P2.ayla.email.toUpperCase())
    await page.getByLabel(t("account.form.password"), { exact: true }).fill("Another-Password-123")
    await page.getByRole("button", { name: t("account.signup.submit") }).click()
    await expect(page).toHaveURL(/\/tr\/workshops/)
    await expect(toast(page, t("site.notices.checkEmail"))).toBeVisible()
    // Not signed in: no banner, the header still offers to log in.
    await expect(page.getByRole("region", { name: t("site.verifyBanner.label") })).toHaveCount(0)
    await expect(page.getByRole("link", { name: t("site.header.logInOrSignUp") })).toBeVisible()
    expect((await context.cookies()).find((c) => /member_session/.test(c.name))).toBeUndefined()

    const email = await waitMail(P2.ayla.email, mark, /./)
    // "Zaten bir {brand} hesabınız var": the member_exists email, not a second welcome.
    expect(email.subject).toContain(lead("tr", "emails.member_exists.subject"))
    expect(linksOf(email).some((l) => l.includes("/account/verify?token="))).toBe(false)
    const after = await one<{ password_hash: string; name: string }>("select password_hash, name from members where email = $1", [P2.ayla.email])
    expect(after.password_hash).toBe(before.password_hash)
    expect(after.name).toBe(P2.ayla.name)
    expect(await sql("select 1 from members where lower(email) = lower($1)", [P2.ayla.email])).toHaveLength(1)
    await context.close()
  })

  test("the workshops list and a workshop page: open workshops, places left, SEO tags and JSON-LD, no private data", async ({ browser }) => {
    const t = tr("tr")
    const context = await anonContext(browser)
    const page = await context.newPage()
    const res = await page.goto("/tr/workshops")
    expect(res?.status()).toBe(200)
    expect(res?.headers()["x-robots-tag"] ?? "").not.toContain("noindex")
    await expect(page.getByRole("heading", { level: 1, name: t("registration.list.title") })).toBeVisible()
    for (const w of [P2.wA, P2.wB, P2.wC, P2.wD]) await expect(page.getByRole("link", { name: new RegExp(escape(w.title.tr)) }).first()).toBeVisible()
    const card = page.locator("a, article, li").filter({ hasText: P2.wA.title.tr }).last()
    await expect(page.locator("main")).toContainText(t("registration.seats.left", { count: 2 }))
    await expect(page).toHaveTitle(new RegExp(escape(t("registration.list.metaTitle"))))
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "http://localhost:3100/tr/workshops")
    void card

    await page.getByRole("link", { name: new RegExp(escape(P2.wA.title.tr)) }).first().click()
    await expect(page).toHaveURL(new RegExp(`/tr/workshops/${P2.wA.slug}$`))
    await expect(page.getByRole("heading", { level: 1, name: P2.wA.title.tr })).toBeVisible()
    await expect(page.locator("main")).toContainText(P2.wA.venue.tr)
    await expect(page.locator("main")).toContainText(P2.nur.displayName.tr)
    await expect(page.locator("main")).toContainText("Seramik tabak boyuyoruz.")
    await expect(page.getByRole("link", { name: t("registration.workshop.register") })).toBeVisible()

    // SEO: title, description, canonical, hreflang, Open Graph.
    await expect(page).toHaveTitle(new RegExp(escape(P2.wA.title.tr)))
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /Seramik tabak boyuyoruz/)
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `http://localhost:3100/tr/workshops/${P2.wA.slug}`)
    for (const l of ["fa", "tr", "en"]) {
      await expect(page.locator(`link[rel="alternate"][hreflang="${l}"]`)).toHaveAttribute("href", `http://localhost:3100/${l}/workshops/${P2.wA.slug}`)
    }
    await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute("href", new RegExp(`/workshops/${P2.wA.slug}$`))
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", P2.wA.title.tr)
    await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute("content", "tr_TR")
    for (const robots of await page.locator('meta[name="robots"]').all()) expect(await robots.getAttribute("content")).not.toContain("noindex")

    // Structured data: an Event with the offer in lira and the instructor as performer.
    const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').first().textContent()) ?? "{}")
    test.info().annotations.push({ type: "json-ld", description: JSON.stringify(ld).slice(0, 1500) })
    expect(ld).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Event",
      name: P2.wA.title.tr,
      eventStatus: "https://schema.org/EventScheduled",
      location: { "@type": "Place", name: P2.wA.venue.tr },
      performer: { "@type": "Person", name: P2.nur.displayName.tr },
      offers: { "@type": "Offer", price: "1000.00", priceCurrency: "TRY", availability: "https://schema.org/InStock" },
    })
    expect(Date.parse(ld.startDate)).toBeGreaterThan(Date.now())

    // Nothing private of the instructor reaches the public page (HTML and the RSC payload in it).
    const body = await (await page.request.get(`/tr/workshops/${P2.wA.slug}`)).text()
    for (const secret of [P2.nur.officialName, P2.nur.idNumber, P2.nur.email, "+905331112233", P2.nur.mobile]) {
      expect(body.includes(secret), `public page contains ${secret}`).toBe(false)
    }
    // Neither the payment link (only for registered students).
    expect(body.includes(P2.wA.paymentUrl), "the online payment link is on the public page").toBe(false)

    // Persian page: right to left, the Persian title.
    await page.goto(`/fa/workshops/${P2.wA.slug}`)
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl")
    await expect(page.getByRole("heading", { level: 1, name: P2.wA.title.fa })).toBeVisible()
    await context.close()
  })

  test("signed out, Register asks to log in or sign up and comes back", async ({ browser }) => {
    const t = tr("tr")
    const context = await anonContext(browser)
    const page = await context.newPage()
    await page.goto(`/tr/workshops/${P2.wA.slug}`)
    await page.getByRole("link", { name: t("registration.workshop.register") }).click()
    await expect(page.locator("main").getByText(t("registration.register.signIn.title"))).toBeVisible()
    await expect(page.getByRole("link", { name: t("registration.register.signIn.logIn") })).toHaveAttribute(
      "href",
      `/tr/account/login?next=${encodeURIComponent(`/tr/workshops/${P2.wA.slug}/register`)}`,
    )
    await context.close()
  })

  test("Ayla registers for workshop A: the terms box is required, then the payment instructions and the email", async ({ browser }) => {
    const t = tr("tr")
    const context = await personContext(browser, "ayla", { permissions: ["clipboard-read", "clipboard-write"] })
    const page = await context.newPage()
    const mark = mailMark()
    await page.goto(`/tr/workshops/${P2.wA.slug}`)
    await page.getByRole("link", { name: t("registration.workshop.register") }).click()
    await expect(page).toHaveURL(new RegExp(`/tr/workshops/${P2.wA.slug}/register$`))
    await expect(page.getByRole("heading", { level: 1, name: t("registration.register.title") })).toBeVisible()
    // The terms in full, the member's name to start with, and the ways to pay that are on.
    await expect(page.getByLabel(t("registration.register.participant"))).toHaveValue(P2.ayla.name)
    await expect(page.locator("main")).toContainText("72")
    for (const way of ["cash", "transfer", "online"]) await expect(page.locator("main").getByText(t(`registration.register.pay.${way}`), { exact: true })).toBeVisible()

    // Without the terms box: refused on the box.
    const submit = page.getByRole("button", { name: t("registration.register.submit"), exact: true })
    await submit.click()
    await expect(page.locator("main").getByText(t("registration.register.errors.acceptTerms"))).toBeVisible()
    await expect(page).toHaveURL(/\/register$/)
    expect(await sql("select 1 from registrations r join members m on m.id = r.member_id where m.email = $1", [P2.ayla.email])).toHaveLength(0)

    await page.getByRole("checkbox", { name: t("registration.register.acceptTerms") }).click()
    await page.getByRole("checkbox", { name: t("registration.register.consent.photo") }).click()
    await submit.click()
    await expect(page).toHaveURL(/\/tr\/account\/registrations\/[0-9a-f-]{36}\?welcome=1$/)
    const id = /registrations\/([0-9a-f-]{36})/.exec(page.url())![1]
    await expect(page.locator("main").getByText(t("registration.detail.welcomeTitle"))).toBeVisible()

    // Stored: not paid yet, the price from the workshop, the terms proof, the choices.
    const reg = await one<{ status: string; amount: string; photo_consent: boolean; video_consent: boolean; terms_sha256: string; participant_name: string }>(
      "select status, amount, photo_consent, video_consent, terms_sha256, participant_name from registrations where id = $1",
      [id],
    )
    expect(reg).toMatchObject({ status: "pending", photo_consent: true, video_consent: false, participant_name: P2.ayla.name })
    expect(Number(reg.amount)).toBe(100_000)
    expect(reg.terms_sha256).toMatch(/^[0-9a-f]{64}$/)

    // How to pay: cash, bank transfer (IBAN in groups of four, copy), online (the workshop's link, new tab).
    const how = page.getByRole("region").or(page.locator("section")).filter({ hasText: t("registration.payment.title") }).first()
    await expect(how).toContainText(t("registration.payment.cash.title"))
    await expect(how).toContainText(t("registration.payment.transfer.title"))
    await expect(how).toContainText(IBAN_GROUPED)
    await expect(how).toContainText(`Lart Sanat ${RUN}`)
    await expect(how).toContainText("Ziraat Bankası")
    await expect(how).toContainText("Lütfen kayıttan sonraki iki gün içinde gönderin.")
    await expect(how).toContainText(t("registration.payment.transfer.reference", { name: P2.ayla.name }))
    await page.getByRole("button", { name: t("registration.payment.transfer.copyLabel") }).click()
    await expect(toast(page, t("registration.payment.transfer.copied"))).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(P2.iban.valid)
    const pay = page.getByRole("link", { name: new RegExp(escape(t("registration.payment.online.button"))) })
    await expect(pay).toHaveAttribute("href", P2.wA.paymentUrl)
    await expect(pay).toHaveAttribute("target", "_blank")
    await expect(pay).toHaveAttribute("rel", /noopener/)
    await expect(how).toContainText("iyzico size e-postayla makbuz gönderir.")
    // Status: not paid yet.
    await expect(page.locator("main")).toContainText(t("registration.status.unpaid"))

    // The email: "your place is reserved", with the same ways to pay.
    const email = await waitMail(P2.ayla.email, mark, P2.wA.title.tr)
    expect(email.subject).toContain(lead("tr", "emails.registration_received.subject") || P2.wA.title.tr)
    test.info().annotations.push({ type: "registration_received", description: `${email.subject}\n${email.text}`.slice(0, 2000) })
    const text = `${email.text ?? ""} ${email.html}`
    expect(text).toContain(IBAN_GROUPED)
    expect(text).toContain(`Lart Sanat ${RUN}`)
    expect(linksOf(email)).toContain(P2.wA.paymentUrl)
    expect(text).toMatch(/₺\s?1\.000/)
    expect(email.html).not.toMatch(/\{[a-zA-Z]+\}/)

    // My workshops: the card, not paid yet, "How to pay" folded away.
    await page.goto("/tr/account")
    const cardA = page.locator("article").filter({ hasText: P2.wA.title.tr })
    await expect(cardA).toContainText(t("registration.status.unpaid"))
    await cardA.getByRole("button", { name: t("registration.item.howToPay") }).click()
    await expect(cardA).toContainText(IBAN_GROUPED)
    // The workshop page now says "You are registered".
    await page.goto(`/tr/workshops/${P2.wA.slug}`)
    await expect(page.locator("main").getByText(t("registration.workshop.registered.title"))).toBeVisible()
    await expect(page.locator("aside")).toContainText(t("registration.status.unpaid"))
    await context.close()
  })

  test("Bahar (Persian) takes the last place of workshop A", async ({ browser }) => {
    const t = tr("fa")
    const context = await anonContext(browser)
    const page = await signUpAndVerify(context, P2.bahar, "fa")
    await saveSession(context, "bahar")
    const mark = mailMark()
    const id = await register(page, "fa", P2.wA.slug, undefined, { video: true })
    await expect(page.locator("main").getByText(t("registration.detail.welcomeTitle"))).toBeVisible()
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl")
    // Amounts in Persian digits.
    await expect(page.locator("main")).toContainText(/[۰-۹]/)
    const email = await waitMail(P2.bahar.email, mark, P2.wA.title.fa)
    expect(email.subject).toContain(P2.wA.title.fa)
    expect((await one<{ status: string }>("select status from registrations where id = $1", [id])).status).toBe("pending")
    // 2 of 2: the workshop is full now.
    await page.goto(`/fa/workshops/${P2.wA.slug}`)
    await expect(page.locator("main").getByText(t("registration.workshop.registered.title"))).toBeVisible()
    await context.close()
  })

  test("Cemre (English) finds workshop A full: the page and the register page say so", async ({ browser }) => {
    const t = tr("en")
    const context = await anonContext(browser)
    const page = await signUpAndVerify(context, P2.cemre, "en")
    await saveSession(context, "cemre")
    await page.goto("/en/workshops")
    await expect(page.locator("main")).toContainText(t("registration.seats.full"))
    await page.goto(`/en/workshops/${P2.wA.slug}`)
    await expect(page.locator("main").getByText(t("registration.workshop.state.fullTitle"))).toBeVisible()
    await expect(page.getByRole("link", { name: t("registration.workshop.register") })).toHaveCount(0)
    await page.goto(`/en/workshops/${P2.wA.slug}/register`)
    await expect(page.locator("main").getByText(t("registration.workshop.state.fullTitle"))).toBeVisible()
    await expect(page.getByRole("button", { name: t("registration.register.submit"), exact: true })).toHaveCount(0)
    // JSON-LD says sold out.
    await page.goto(`/en/workshops/${P2.wA.slug}`)
    const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').first().textContent()) ?? "{}")
    expect(ld.offers?.availability).toBe("https://schema.org/SoldOut")
    await context.close()
  })

  test("Bahar cancels her unpaid place from My workshops: freed for Cemre", async ({ browser }) => {
    const t = tr("fa")
    const context = await personContext(browser, "bahar")
    const page = await context.newPage()
    const mark = mailMark()
    await page.goto("/fa/account")
    const card = page.locator("article").filter({ hasText: P2.wA.title.fa })
    await expect(card).toContainText(t("registration.status.unpaid"))
    await card.getByRole("button", { name: t("registration.cancel.button") }).click()
    const dialog = page.getByRole("alertdialog")
    await expect(dialog).toContainText(lead("fa", "registration.cancel.unpaid"))
    await dialog.getByRole("button", { name: t("registration.cancel.confirm") }).click()
    await expect(toast(page, t("registration.cancel.done"))).toBeVisible()
    await expect(page.locator("article").filter({ hasText: P2.wA.title.fa })).toContainText(t("registration.status.cancelled"))
    const reg = await one<{ status: string; refund_amount: string | null }>(
      "select r.status, r.refund_amount from registrations r join members m on m.id = r.member_id join courses c on c.id = r.course_id where m.email = $1 and c.slug = $2",
      [P2.bahar.email, P2.wA.slug],
    )
    expect(reg.status).toBe("cancelled")
    expect(Number(reg.refund_amount ?? 0)).toBe(0)
    const email = await waitMail(P2.bahar.email, mark, P2.wA.title.fa)
    test.info().annotations.push({ type: "registration_cancelled (unpaid)", description: `${email.subject}\n${email.text}`.slice(0, 1200) })
    expect(email.text ?? email.html).not.toMatch(/۶۰۰|۱٬۰۰۰|1\.000|1,000/)
    // Nobody else is told (no refund to pay back).
    expect(mailTo("owner@lart.test", mark).filter((e) => /Refund|iade|بازپرداخت/.test(e.subject))).toHaveLength(0)
    await context.close()

    // The place is free again: Cemre registers.
    const cemre = await personContext(browser, "cemre")
    const p = await cemre.newPage()
    await p.goto(`/en/workshops/${P2.wA.slug}`)
    await expect(p.getByRole("link", { name: tr("en")("registration.workshop.register") })).toBeVisible()
    await register(p, "en", P2.wA.slug)
    await cemre.close()
  })

  test("more registrations: Ayla for herself and her child in B (a duplicate name refused), Cemre in B and C, Bahar in C, Ayla in D", async ({ browser }) => {
    const ayla = await personContext(browser, "ayla")
    const a = await ayla.newPage()
    await register(a, "tr", P2.wB.slug, undefined, { photo: true, video: true })
    // "Register someone else": the same person twice is refused, with her name.
    await a.goto(`/tr/workshops/${P2.wB.slug}`)
    await expect(a.locator("main").getByText(tr("tr")("registration.workshop.registered.title"))).toBeVisible()
    await a.getByRole("link", { name: tr("tr")("registration.workshop.registered.another") }).click()
    await expect(a.getByLabel(tr("tr")("registration.register.participant"))).toHaveValue("")
    await a.getByLabel(tr("tr")("registration.register.participant")).fill(`  ${P2.ayla.name.toUpperCase()} `)
    await a.getByRole("checkbox", { name: tr("tr")("registration.register.acceptTerms") }).click()
    await a.getByRole("button", { name: tr("tr")("registration.register.submit"), exact: true }).click()
    await expect(a.locator("main").getByText(tr("tr")("registration.errors.duplicate", { name: P2.ayla.name.toUpperCase() }))).toBeVisible()
    await expect(a).toHaveURL(/\/register$/)
    await register(a, "tr", P2.wB.slug, `Deniz Kurt ${RUN}`)
    await register(a, "tr", P2.wD.slug)
    await ayla.close()

    const cemre = await personContext(browser, "cemre")
    const c = await cemre.newPage()
    await register(c, "en", P2.wB.slug)
    await register(c, "en", P2.wC.slug)
    await cemre.close()

    const bahar = await personContext(browser, "bahar")
    const b = await bahar.newPage()
    await register(b, "fa", P2.wC.slug, undefined, { photo: true })
    await bahar.close()

    const count = async (slug: string) =>
      Number((await one<{ n: string }>("select count(*) as n from registrations r join courses c on c.id = r.course_id where c.slug = $1 and r.status <> 'cancelled'", [slug])).n)
    expect(await count(P2.wA.slug)).toBe(2)
    expect(await count(P2.wB.slug)).toBe(3)
    expect(await count(P2.wC.slug)).toBe(2)
    expect(await count(P2.wD.slug)).toBe(1)
  })

  test("My workshops lists every registration with its status; the details page of one", async ({ browser }) => {
    const t = tr("tr")
    const context = await personContext(browser, "ayla")
    const page = await context.newPage()
    await page.goto("/tr/account")
    await settle(page)
    await expect(page.getByRole("heading", { level: 1, name: t("registration.account.title") })).toBeVisible()
    for (const w of [P2.wA, P2.wB, P2.wD]) await expect(page.locator("article").filter({ hasText: w.title.tr }).first()).toBeVisible()
    await expect(page.locator("article")).toHaveCount(4)
    await expect(page.locator("article").filter({ hasText: `Deniz Kurt ${RUN}` })).toContainText(t("registration.status.unpaid"))
    // My details: email shown, name and phone editable.
    await expect(page.locator("main")).toContainText(P2.ayla.email)
    const a = await courseId(P2.wA.slug)
    const { id } = await one<{ id: string }>(
      "select r.id from registrations r join members m on m.id = r.member_id where m.email = $1 and r.course_id = $2",
      [P2.ayla.email, a],
    )
    await page.locator("article").filter({ hasText: P2.wA.title.tr }).getByRole("link", { name: t("registration.item.details") }).click()
    await expect(page).toHaveURL(new RegExp(`/tr/account/registrations/${id}$`))
    await expect(page.locator("main")).toContainText(t("registration.detail.photoYes"))
    await expect(page.locator("main")).toContainText(t("registration.detail.videoNo"))
    await expect(page.locator("main")).toContainText(lead("tr", "registration.detail.termsAccepted"))
    await context.close()
  })
})

// Not part of the serial flow, so a failure here does not stop the rest.
test("sign-in pages: the first click on a link under the form is not lost", async ({ browser }) => {
  // The first field is focused on arrival. Were it checked when it loses focus ("Please fill this in"),
  // that message would push the links below it down by a line between mouse down and mouse up.
  const [t, en] = [tr("tr"), tr("en")]
  const context = await anonContext(browser)
  const page = await context.newPage()
  for (const [from, link, target] of [
    ["/tr/account/login", t("account.login.signUp"), /\/tr\/account\/signup/],
    ["/tr/account/login", t("account.login.forgot"), /\/tr\/account\/forgot/],
    ["/en/account/signup", en("account.signup.logIn"), /\/en\/account\/login/],
    ["/tr/account/forgot", t("account.forgot.back"), /\/tr\/account\/login/],
    ["/tr/instructor/login", t("account.login.forgot"), /\/tr\/instructor\/forgot/],
  ] as const) {
    await page.goto(from)
    await page.locator("main").getByRole("link", { name: link, exact: true }).click()
    await expect(page, `one click on “${link}” (${from})`).toHaveURL(target, { timeout: 3_000 })
  }
  await context.close()
})
