import type { Page, Route } from "@playwright/test"

import { at, expect, mailMark, RUN, RUN_NAME, test, toast } from "./helpers/app"
import { one, sql } from "./helpers/db"
import { anonContext, captureAction, courseId, linksOf, memberLogin, P2, PASSWORD, personContext, replayAction, tr, waitMail } from "./helpers/p2"

/**
 * Phase 2 security probes, against the data of specs 10–13: one member can't
 * see or cancel another's registration (also with a forged server-action
 * input), the server re-checks a forged registration, private areas redirect
 * when signed out and are never indexed, sessions don't cross areas, no open
 * redirect after logging in, the instructor sees no participant contact
 * details, the instructor upload API refuses strangers, robots.txt and the
 * sitemap, and the password reset flow.
 */

const regOf = async (email: string, slug: string, participant?: string) =>
  (
    await one<{ id: string; status: string }>(
      `select r.id, r.status from registrations r join members m on m.id = r.member_id join courses c on c.id = r.course_id
        where m.email = $1 and c.slug = $2 and ($3::text is null or r.participant_name = $3) order by r.created_at desc limit 1`,
      [email, slug, participant ?? null],
    )
  )

/** Rewrite the input of the next server action posted from this page (replace one value by another). */
async function forgeNextAction(page: Page, from: string, to: string) {
  const seen: string[] = []
  await page.route("**/*", async (route: Route) => {
    const req = route.request()
    if (req.method() === "POST" && req.headers()["next-action"]) {
      const body = req.postData() ?? ""
      seen.push(body)
      return route.continue({ postData: body.split(from).join(to) })
    }
    return route.continue()
  })
  return seen
}

test.describe("phase 2 · security: members", () => {
  test("Ayla can't open Cemre's registration page", async ({ browser }) => {
    const cemre = await regOf(P2.cemre.email, P2.wA.slug)
    const context = await personContext(browser, "ayla")
    const page = await context.newPage()
    const res = await page.goto(`/account/registrations/${cemre.id}`)
    expect(res?.status()).toBe(404)
    await expect(page.locator("body")).not.toContainText(P2.cemre.name)
    const raw = await page.request.get(`/account/registrations/${cemre.id}`)
    expect(raw.status()).toBe(404)
    expect(await raw.text()).not.toContain(P2.cemre.name)
    // A made-up id is simply not found too.
    expect((await page.goto("/account/registrations/not-a-uuid"))?.status()).toBe(404)
    await context.close()
  })

  test("Ayla can't cancel Cemre's registration by forging the cancel action's input", async ({ browser }) => {
    const t = tr("tr")
    const mine = await regOf(P2.ayla.email, P2.wB.slug, `Deniz Kurt ${RUN}`)
    const theirs = await regOf(P2.cemre.email, P2.wA.slug)
    expect(mine.status).toBe("pending")
    expect(theirs.status).toBe("pending")
    const context = await personContext(browser, "ayla")
    const page = await context.newPage()
    await page.goto(`/account/registrations/${mine.id}`)
    const seen = await forgeNextAction(page, mine.id, theirs.id)
    await page.locator("main").getByRole("button", { name: t("registration.cancel.button") }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: t("registration.cancel.confirm") }).click()
    await expect(toast(page, t("registration.errors.notFound"))).toBeVisible()
    expect(seen.join(" "), "the action input carried the registration id").toContain(mine.id)
    expect((await regOf(P2.cemre.email, P2.wA.slug)).status).toBe("pending")
    expect((await regOf(P2.ayla.email, P2.wB.slug, `Deniz Kurt ${RUN}`)).status).toBe("pending")
    await context.close()
  })

  test("a forged registration for the cancelled workshop C is refused by the server", async ({ browser }) => {
    const t = tr("tr")
    const b = await courseId(P2.wB.slug)
    const c = await courseId(P2.wC.slug)
    const context = await personContext(browser, "ayla")
    const page = await context.newPage()
    await page.goto(`/workshops/${P2.wB.slug}/register`)
    await page.getByLabel(t("registration.register.participant")).fill(`Forged ${RUN}`)
    await page.getByRole("checkbox", { name: t("registration.register.acceptTerms") }).click()
    await forgeNextAction(page, b, c)
    await page.getByRole("button", { name: t("registration.register.submit"), exact: true }).click()
    await expect(page.getByRole("alert").filter({ hasText: t("registration.errors.cancelled") })).toBeVisible()
    expect(await sql("select 1 from registrations where participant_name = $1", [`Forged ${RUN}`])).toHaveLength(0)
    await context.close()
  })

  test("sessions don't cross areas: a member can't open the admin or instructor panels, an instructor isn't a member", async ({ browser }) => {
    const member = await personContext(browser, "ayla")
    for (const [url, login] of [
      ["/admin", /^\/admin\/login/],
      ["/fa/admin", /^\/fa\/admin\/login/],
      ["/instructor", /^\/instructor\/login/],
    ] as const) {
      const res = await member.request.get(url, { maxRedirects: 0 })
      expect(res.status(), url).toBe(307)
      expect(res.headers()["location"], url).toMatch(login)
    }
    await member.close()
    const instructor = await personContext(browser, "nur")
    const res = await instructor.request.get("/account", { maxRedirects: 0 })
    expect(res.status()).toBe(307)
    expect(res.headers()["location"]).toMatch(/^\/account\/login\?next=%2Faccount$/)
    await instructor.close()
  })

  test("logging in: one message for every failure, and no open redirect through ?next", async ({ browser }) => {
    const t = tr("tr")
    const context = await anonContext(browser)
    const page = await context.newPage()
    const message = t("account.login.errors.invalid", { minutes: 15 })
    await memberLogin(page, "tr", P2.ayla.email, "wrong-password-123")
    await expect(page.getByRole("alert").filter({ hasText: message })).toBeVisible()
    await memberLogin(page, "tr", `nobody.${RUN}@member.test`, "wrong-password-123")
    await expect(page.getByRole("alert").filter({ hasText: message })).toBeVisible()
    for (const next of ["https://evil.example/", "//evil.example/x", "/\\evil.example"]) {
      await context.clearCookies()
      await memberLogin(page, "tr", P2.ayla.email, PASSWORD, next)
      await expect(page).toHaveURL(/^http:\/\/localhost:3100\/workshops/)
    }
    await context.close()
  })

  test("an instructor without a password (never accepted the invitation) can't log in", async ({ browser }) => {
    const [row] = await sql<{ email: string; locale: string }>("select email, locale from instructors where password_hash is null limit 1")
    test.skip(!row, "no instructor without a password in this database")
    const t = tr("en")
    const context = await anonContext(browser)
    const page = await context.newPage()
    await page.goto("/en/instructor/login")
    await page.getByLabel(t("account.form.email")).fill(row.email)
    await page.getByLabel(t("account.form.password"), { exact: true }).fill("Some-Password-123")
    await page.getByRole("button", { name: t("account.login.submit") }).click()
    await expect(page.getByRole("alert").filter({ hasText: t("auth.instructor.login.errors.invalid", { minutes: 15 }) })).toBeVisible()
    expect((await context.cookies()).find((c) => /instructor_session/.test(c.name))).toBeUndefined()
    await context.close()
  })
})

test.describe("phase 2 · security: server actions replayed with someone else's session", () => {
  test("an unverified member is asked to confirm the email first; the register action replayed with her session is refused", async ({ browser }) => {
    const t = tr("tr")
    const who = { name: `Eda Onay ${RUN_NAME}`, email: `eda.${RUN}@member.test` }
    // Eda signs up and doesn't open the link yet.
    const eda = await anonContext(browser)
    const page = await eda.newPage()
    await page.goto("/account/signup")
    await page.getByLabel(t("account.signup.name")).fill(who.name)
    await page.getByLabel(t("account.form.email")).fill(who.email)
    await page.getByLabel(t("account.form.password"), { exact: true }).fill(PASSWORD)
    await page.getByRole("button", { name: t("account.signup.submit") }).click()
    await expect(page).toHaveURL(/localhost:3100\/workshops/)
    await expect(page.getByRole("region", { name: t("site.verifyBanner.label") })).toBeVisible()
    // The register page asks, in plain words, with "send it again".
    await page.goto(`/workshops/${P2.wB.slug}/register`)
    await expect(page.locator("main").getByText(t("registration.register.verify.title"))).toBeVisible()
    await expect(page.getByRole("button", { name: t("registration.register.submit"), exact: true })).toHaveCount(0)
    const mark = mailMark()
    await page.locator("main").getByRole("button", { name: t("registration.register.verify.resend") }).click()
    await expect(page.locator("main").getByText(t("registration.register.verify.sent"))).toBeVisible()
    const again = await waitMail(who.email, mark, /./)
    expect(linksOf(again).some((l) => l.includes("/account/verify?token="))).toBe(true)

    // Ayla (confirmed) fills in the form; her click is caught before it reaches the server.
    const ayla = await personContext(browser, "ayla")
    const form = await ayla.newPage()
    await form.goto(`/workshops/${P2.wB.slug}/register`)
    await form.getByLabel(t("registration.register.participant")).fill(`Captured ${RUN}`)
    await form.getByRole("checkbox", { name: t("registration.register.acceptTerms") }).click()
    const action = await captureAction(form, () => form.getByRole("button", { name: t("registration.register.submit"), exact: true }).click())
    expect(action.body).toContain(`Captured ${RUN}`)

    // Replayed with Eda's session: refused, nothing stored.
    const refused = await replayAction(eda.request, action, action.body.split(`Captured ${RUN}`).join(`Unverified ${RUN}`))
    test.info().annotations.push({ type: "replay as unverified", description: `${refused.status} ${refused.text.slice(0, 400)}` })
    expect(await sql("select 1 from registrations where participant_name = $1", [`Unverified ${RUN}`])).toHaveLength(0)
    // Replayed by a visitor: refused too.
    const visitor = await anonContext(browser)
    await replayAction(visitor.request, action, action.body.split(`Captured ${RUN}`).join(`Visitor ${RUN}`))
    expect(await sql("select 1 from registrations where participant_name = $1", [`Visitor ${RUN}`])).toHaveLength(0)
    // Control: the same replay with Ayla's own session does register (so the refusals above are the server's checks).
    const control = await replayAction(ayla.request, action, action.body.split(`Captured ${RUN}`).join(`Replay ${RUN}`))
    test.info().annotations.push({ type: "replay as Ayla (control)", description: `${control.status} ${control.text.slice(0, 300)}` })
    await expect.poll(async () => (await sql("select 1 from registrations where participant_name = $1", [`Replay ${RUN}`])).length).toBe(1)
    // Clean up the control registration (not paid, nothing in the ledger).
    await sql("delete from registrations where participant_name = $1 and status = 'pending'", [`Replay ${RUN}`])
    await visitor.close()
    await ayla.close()
    await eda.close()
  })

  test("a member or a visitor can't run the admin's Record payment action", async ({ page, browser }) => {
    const deniz = await regOf(P2.ayla.email, P2.wB.slug, `Deniz Kurt ${RUN}`)
    expect(deniz.status).toBe("pending")
    await page.goto(`/en/admin/workshops/${await courseId(P2.wB.slug)}/registrations`)
    const row = page.getByRole("row").filter({ has: page.getByRole("button", { name: `Actions for Deniz Kurt ${RUN}`, exact: true }) })
    await row.getByRole("button", { name: "Record payment" }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByRole("radio", { name: /^Cash/ }).click()
    const action = await captureAction(page, () => dialog.getByRole("button", { name: "Yes, it’s paid" }).click())
    expect(action.body).toContain(deniz.id)
    await page.keyboard.press("Escape")

    const member = await personContext(browser, "ayla")
    const asMember = await replayAction(member.request, action)
    test.info().annotations.push({ type: "admin action as member", description: `${asMember.status} ${asMember.text.slice(0, 400)}` })
    const visitor = await anonContext(browser)
    const asVisitor = await replayAction(visitor.request, action)
    test.info().annotations.push({ type: "admin action as visitor", description: `${asVisitor.status} ${asVisitor.text.slice(0, 400)}` })
    const instructor = await personContext(browser, "nur")
    await replayAction(instructor.request, action)
    expect((await regOf(P2.ayla.email, P2.wB.slug, `Deniz Kurt ${RUN}`)).status).toBe("pending")
    expect(await sql("select 1 from ledger_transactions where registration_id = $1", [deniz.id])).toHaveLength(0)
    await Promise.all([member.close(), visitor.close(), instructor.close()])
  })
})

test.describe("phase 2 · security: private areas and indexing", () => {
  test("signed out, the instructor panel and the account pages redirect to their login, with noindex", async ({ browser }) => {
    const context = await anonContext(browser)
    const contract = await one<{ id: string }>(
      "select c.id from contracts c join courses w on w.id = c.course_id where w.slug = $1 and c.status <> 'void'",
      [P2.wA.slug],
    )
    const cases: [string, RegExp][] = [
      ["/fa/instructor", /\/fa\/instructor\/login(\?|$)/],
      ["/fa/instructor/contracts", /\/fa\/instructor\/login\?next=%2Ffa%2Finstructor%2Fcontracts$/],
      [`/fa/instructor/contracts/${contract.id}`, /\/fa\/instructor\/login\?next=/],
      ["/fa/instructor/workshops", /\/fa\/instructor\/login\?next=/],
      ["/fa/instructor/earnings", /\/fa\/instructor\/login\?next=/],
      ["/fa/instructor/profile", /\/fa\/instructor\/login\?next=/],
      ["/account", /^\/account\/login\?next=%2Faccount$/],
      [`/account/registrations/${(await regOf(P2.ayla.email, P2.wA.slug)).id}`, /^\/account\/login\?next=/],
    ]
    for (const [url, location] of cases) {
      const res = await context.request.get(url, { maxRedirects: 0 })
      expect(res.status(), url).toBe(307)
      expect(res.headers()["location"], url).toMatch(location)
      expect(res.headers()["x-robots-tag"] ?? "", `${url}: X-Robots-Tag`).toContain("noindex")
    }
    // The sign-in pages themselves open, never indexed.
    for (const url of ["/fa/instructor/login", "/fa/instructor/forgot", "/account/login", "/account/signup", "/account/forgot"]) {
      const res = await context.request.get(url, { maxRedirects: 0 })
      expect(res.status(), url).toBe(200)
      expect(res.headers()["x-robots-tag"] ?? "", `${url}: X-Robots-Tag`).toContain("noindex")
    }
    // The page itself in the browser, too.
    const page = await context.newPage()
    await page.goto("/fa/instructor/workshops")
    await expect(page).toHaveURL(/\/fa\/instructor\/login\?next=%2Ffa%2Finstructor%2Fworkshops$/)
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl")
    await context.close()
  })

  test("public pages are indexable, with the security headers; the register page is not indexed", async ({ browser, problems }) => {
    const context = await anonContext(browser)
    for (const url of ["/workshops", `/workshops/${P2.wB.slug}`]) {
      const res = await context.request.get(url)
      expect(res.status(), url).toBe(200)
      const h = res.headers()
      expect(h["x-robots-tag"] ?? "", url).not.toContain("noindex")
      expect(h["content-security-policy"], url).toMatch(/script-src[^;]*'nonce-/)
      expect(h["content-security-policy"], url).toContain("frame-ancestors 'none'")
      expect(h["x-content-type-options"]).toBe("nosniff")
    }
    const page = await context.newPage()
    await page.goto(`/workshops/${P2.wB.slug}`)
    // The JSON-LD can't close its <script> tag.
    const ld = (await page.locator('script[type="application/ld+json"]').first().innerHTML()) ?? ""
    expect(ld).not.toContain("<")
    await page.goto(`/workshops/${P2.wB.slug}/register`)
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/)
    expect(problems.filter((p) => p.type === "console" && /Content Security Policy/i.test(p.text))).toEqual([])
    await context.close()
  })

  test("robots.txt and sitemap.xml: open workshops in three languages, nothing private, nothing cancelled", async ({ request }) => {
    const robots = await request.get("/robots.txt")
    expect(robots.status()).toBe(200)
    const txt = await robots.text()
    test.info().annotations.push({ type: "robots.txt", description: txt })
    // Only the admin panel and the API are disallowed. The instructor panel and the account pages rely on their
    // noindex (a disallowed page can still be indexed as a bare URL), and robots.txt must not publish the panel's address.
    expect(txt).toMatch(/^Disallow: \/admin$/m)
    for (const l of ["fa", "tr", "en"]) expect(txt).toContain(`Disallow: /${l}/admin`)
    expect(txt).not.toContain("/instructor")
    expect(txt).not.toContain("/account")
    expect(txt).toContain("Disallow: /api")
    expect(txt).toContain("Sitemap: http://localhost:3100/sitemap.xml")

    const sitemap = await request.get("/sitemap.xml")
    expect(sitemap.status()).toBe(200)
    const xml = await sitemap.text()
    // The main language (tr) without a prefix, the others with theirs.
    for (const l of ["fa", "tr", "en"]) {
      expect(xml).toContain(`<loc>http://localhost:3100${at(l, `/workshops/${P2.wB.slug}`)}</loc>`)
      expect(xml).toContain(`<loc>http://localhost:3100${at(l, "/workshops")}</loc>`)
      expect(xml).toContain(`<loc>http://localhost:3100${at(l, "/")}</loc>`)
    }
    expect(xml).toContain("<loc>http://localhost:3100/</loc>")
    expect(xml).not.toMatch(/localhost:3100\/tr(\/|<)/)
    expect(xml).toContain(`hreflang="x-default" href="http://localhost:3100/workshops/${P2.wB.slug}"`)
    expect(xml).toMatch(new RegExp(`hreflang="fa"[^>]*href="http://localhost:3100/fa/workshops/${P2.wB.slug}"`))
    expect(xml).toContain('hreflang="x-default"')
    expect(xml).not.toContain(P2.wC.slug)
    expect(xml).not.toMatch(/\/(admin|instructor|account)(\/|<)/)
  })

  test("the instructor sees who is coming, but no contact details or payment status", async ({ browser }) => {
    const t = tr("tr")
    const context = await personContext(browser, "nur")
    const page = await context.newPage()
    await page.goto(`/instructor/workshops/${await courseId(P2.wA.slug)}`)
    const main = page.locator("main")
    await expect(main).toContainText(P2.ayla.name)
    await expect(main).toContainText(P2.cemre.name)
    await expect(main).toContainText(t("instructorPanel.workshop.places", { count: 2, max: 2 }))
    const html = await (await page.request.get(`/instructor/workshops/${await courseId(P2.wA.slug)}`)).text()
    for (const secret of [P2.ayla.email, P2.cemre.email, "+905320001122", "+905350003344"]) expect(html.includes(secret), secret).toBe(false)
    for (const word of [t("registration.status.paid"), t("registration.status.unpaid")]) await expect(main).not.toContainText(word)
    await context.close()
  })

  test("the instructor upload API refuses strangers and other sites", async ({ browser, request }) => {
    const anon = await request.post("/api/instructor/uploads", { multipart: { purpose: "instructor_photo" } })
    expect(anon.status()).toBe(401)
    const context = await personContext(browser, "nur")
    const cross = await context.request.post("/api/instructor/uploads", {
      headers: { origin: "https://evil.example" },
      multipart: { purpose: "instructor_photo" },
    })
    expect(cross.status()).toBe(401)
    // A member's session is not an instructor's.
    const member = await personContext(browser, "ayla")
    expect((await member.request.post("/api/instructor/uploads", { multipart: { purpose: "instructor_photo" } })).status()).toBe(401)
    await member.close()
    await context.close()
  })
})

test.describe("URL rules: old addresses, the main language, encoded paths", () => {
  test("every old address answers with one permanent redirect, the query kept", async ({ request }) => {
    for (const [from, to] of [
      ["/tr/workshops?x=1", "/workshops?x=1"],
      ["/tr", "/"],
      ["/TR/workshops", "/workshops"],
      ["/Fa/workshops", "/fa/workshops"],
      ["/admin/login/forgot", "/admin/forgot"],
      ["/en/admin/login/reset?token=abc", "/en/admin/reset?token=abc"],
      ["/tr/admin/accept-invite?token=abc", "/admin/invite?token=abc"],
      ["/fa/admin/accept-invite?token=abc", "/fa/admin/invite?token=abc"],
      ["/instructor/accept-invite?token=abc", "/instructor/invite?token=abc"],
      ["/tr/instructor/accept-invite?token=abc", "/instructor/invite?token=abc"],
    ]) {
      const res = await request.get(from, { maxRedirects: 0 })
      expect(res.status(), from).toBe(308)
      expect(res.headers()["location"], from).toBe(to)
      expect(res.headers()["cache-control"], from).toBe("no-store")
      expect(res.headers()["set-cookie"], from).toBeUndefined()
    }
  })

  test("an encoded private path still goes through the sign-in gate", async ({ browser }) => {
    const context = await anonContext(browser)
    const res = await context.request.get("/%61dmin/categories", { maxRedirects: 0 })
    expect(res.status()).toBe(307)
    expect(res.headers()["location"]).toBe("/admin/login?next=%2Fadmin%2Fcategories")
    expect(res.headers()["x-robots-tag"]).toContain("noindex")
    await context.close()
  })

  test("/ is the home page in the main language, whatever the browser prefers", async ({ request }) => {
    const res = await request.get("/", { maxRedirects: 0, headers: { "accept-language": "fa", cookie: "NEXT_LOCALE=en" } })
    expect(res.status()).toBe(200)
    expect(res.headers()["set-cookie"]).toBeUndefined()
    const html = await res.text()
    expect(html).toMatch(/<html[^>]*lang="tr"/)
    expect(html).toContain('<link rel="canonical" href="http://localhost:3100/"')
    expect(html).toContain('hrefLang="fa" href="http://localhost:3100/fa"')
    for (const path of ["/fa", "/en"]) {
      const other = await request.get(path, { maxRedirects: 0 })
      expect(other.status(), path).toBe(200)
      expect(await other.text(), path).toMatch(new RegExp(`<html[^>]*lang="${path.slice(1)}"`))
    }
  })
})

test.describe("phase 2 · password reset (member)", () => {
  test("a new member forgets the password: one-time link, new password, signed in and the email confirmed", async ({ browser }) => {
    const t = tr("en")
    const who = { name: `Dila Reset ${RUN_NAME}`, email: `dila.${RUN}@member.test` }
    const context = await anonContext(browser)
    const page = await context.newPage()
    await page.goto("/en/account/signup")
    await page.getByLabel(t("account.signup.name")).fill(who.name)
    await page.getByLabel(t("account.form.email")).fill(who.email)
    await page.getByLabel(t("account.form.password"), { exact: true }).fill(PASSWORD)
    await page.getByRole("button", { name: t("account.signup.submit") }).click()
    await expect(page).toHaveURL(/\/en\/workshops/)
    await context.clearCookies()

    const mark = mailMark()
    await page.goto("/en/account/forgot")
    await page.getByLabel(t("account.form.email")).fill(who.email.toUpperCase())
    await page.getByRole("button", { name: t("account.forgot.submit") }).click()
    await expect(page.locator("main").getByText(t("account.forgot.sentTitle"))).toBeVisible()
    // An unknown address gets the same answer.
    await page.goto("/en/account/forgot")
    await page.getByLabel(t("account.form.email")).fill(`nobody.${RUN}@member.test`)
    await page.getByRole("button", { name: t("account.forgot.submit") }).click()
    await expect(page.locator("main").getByText(t("account.forgot.sentTitle"))).toBeVisible()

    const email = await waitMail(who.email, mark, /./)
    const link = linksOf(email).find((l) => l.includes("/account/reset?token="))
    expect(link, linksOf(email).join(" ")).toBeTruthy()
    await page.goto(link!.replace("http://localhost:3100", ""))
    await page.getByLabel(t("account.reset.password"), { exact: true }).fill("A-New-Password-2026")
    await page.getByRole("button", { name: t("account.reset.submit") }).click()
    await expect(page).toHaveURL(/\/en\/workshops/)
    await expect(toast(page, t("site.notices.passwordSaved"))).toBeVisible()
    // The link proves the address: no "confirm your email" banner.
    await expect(page.getByRole("region", { name: t("site.verifyBanner.label") })).toHaveCount(0)
    const row = await one<{ email_verified_at: Date | null }>("select email_verified_at from members where email = $1", [who.email])
    expect(row.email_verified_at).not.toBeNull()
    // Used once.
    await page.goto(link!.replace("http://localhost:3100", ""))
    await expect(page.locator("main").getByText(t("account.reset.invalidTitle"))).toBeVisible()
    await context.close()
  })
})

test.describe("phase 2 · member: language and my details", () => {
  test("the header's language switch and My details change the language of Cemre's emails; her phone is saved", async ({ browser }) => {
    const en = tr("en")
    const context = await personContext(browser, "cemre")
    const page = await context.newPage()
    const locale = async () => (await one<{ locale: string }>("select locale from members where email = $1", [P2.cemre.email])).locale
    expect(await locale()).toBe("en")
    await page.goto("/en/account")
    // The header's switch: the same page in Turkish, and her emails follow.
    await page.getByRole("button", { name: en("common.language") }).click()
    await page.getByRole("menuitemradio", { name: "Türkçe" }).click()
    await expect(page).toHaveURL(/localhost:3100\/account$/)
    await expect.poll(locale).toBe("tr")

    // My details (now in Turkish): a new phone number and English again.
    const t = tr("tr")
    const details = page.locator("section").filter({ has: page.getByRole("heading", { name: t("registration.account.details") }) })
    await details.getByLabel(new RegExp(`^${t("registration.account.phone")}`)).fill("+90 535 000 99 88")
    await details.getByRole("radio", { name: "English" }).click()
    await details.getByRole("button", { name: t("registration.account.save") }).click()
    await expect(page).toHaveURL(/\/en\/account$/)
    await expect.poll(locale).toBe("en")
    const row = await one<{ phone: string | null; name: string }>("select phone, name from members where email = $1", [P2.cemre.email])
    expect(row.name).toBe(P2.cemre.name)
    expect(row.phone?.replace(/\s/g, "")).toBe("+905350009988")
    await context.close()
  })
})
