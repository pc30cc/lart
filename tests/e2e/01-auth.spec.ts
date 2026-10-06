import { ADMIN, expect, test } from "./helpers/app"
import { one } from "./helpers/db"

// These tests start signed out.
test.use({
  storageState: { cookies: [], origins: [] },
  // A per-run client IP, so repeated runs stay under the login rate limit (10 per 15 minutes per IP).
  extraHTTPHeaders: { "x-real-ip": `10.99.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
})

test.describe("sign in and out", () => {
  test("the panel redirects to the login when signed out", async ({ page, request }) => {
    // The proxy answers with a redirect before any page renders.
    const bare = await request.get("/tr/admin", { maxRedirects: 0 })
    expect(bare.status()).toBe(307)
    expect(bare.headers()["location"]).toMatch(/\/tr\/admin\/login$/)
    expect(bare.headers()["x-robots-tag"]).toContain("noindex")

    const deep = await request.get("/tr/admin/workshops", { maxRedirects: 0 })
    expect(deep.headers()["location"]).toMatch(/\/tr\/admin\/login\?next=%2Ftr%2Fadmin%2Fworkshops$/)

    await page.goto("/tr/admin")
    await expect(page).toHaveURL(/\/tr\/admin\/login$/)
    await expect(page.getByRole("button", { name: "Giriş yap" })).toBeVisible()
  })

  test("wrong password, right password, cookie flags, sign out, sign in again", async ({ page, context }) => {
    await page.goto("/en/admin/login")
    await expect(page.locator("html")).toHaveAttribute("lang", "en")

    // 1. Wrong password: one friendly message, the email stays filled in.
    await page.getByLabel("Email").fill(ADMIN.email)
    await page.getByLabel("Password", { exact: true }).fill("not-the-password")
    await page.getByRole("button", { name: "Sign in" }).click()
    const alert = page.getByRole("alert").filter({ hasText: "That email and password don’t match" })
    await expect(alert).toBeVisible()
    await expect(page.getByLabel("Email")).toHaveValue(ADMIN.email)
    await expect(page).toHaveURL(/\/en\/admin\/login$/)

    // Show / hide password toggle.
    await page.getByLabel("Password", { exact: true }).fill(ADMIN.password)
    await page.getByRole("button", { name: "Show password" }).click()
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text")
    await page.getByRole("button", { name: "Hide password" }).click()

    // 2. Right password: the server action sets the session cookie.
    const loginResponse = page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().includes("/en/admin/login"),
    )
    await page.getByRole("button", { name: "Sign in" }).click()
    const res = await loginResponse
    const setCookie = (await res.headersArray()).filter((h) => h.name.toLowerCase() === "set-cookie").map((h) => h.value)
    const sessionCookie = setCookie.find((c) => /admin_session=/.test(c))
    expect(sessionCookie, `Set-Cookie headers: ${setCookie.join(" | ")}`).toBeTruthy()
    test.info().annotations.push({ type: "set-cookie", description: sessionCookie ?? "" })
    expect(sessionCookie).toMatch(/^__Host-admin_session=/)
    expect(sessionCookie).toMatch(/;\s*HttpOnly/i)
    expect(sessionCookie).toMatch(/;\s*Secure/i)
    expect(sessionCookie).toMatch(/;\s*SameSite=Lax/i)
    expect(sessionCookie).toMatch(/;\s*Path=\/(;|$)/i)
    expect(sessionCookie).not.toMatch(/;\s*Domain=/i)
    expect(sessionCookie).toMatch(/;\s*(Expires|Max-Age)=/i)

    await expect(page).toHaveURL(/\/en\/admin$/)
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    const cookies = await context.cookies()
    const cookie = cookies.find((c) => c.name === "__Host-admin_session")
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.secure).toBe(true)
    expect(cookie?.sameSite).toBe("Lax")
    // Not readable from scripts.
    expect(await page.evaluate(() => document.cookie)).not.toContain("admin_session")

    // Security headers on a panel page.
    const panel = await page.request.get("/en/admin")
    const headers = panel.headers()
    expect(headers["x-robots-tag"]).toContain("noindex")
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'")
    expect(headers["x-content-type-options"]).toBe("nosniff")

    // 3. Sign out from the user menu.
    await page.getByRole("button", { name: "Your account" }).click()
    await expect(page.getByRole("menu")).toContainText(ADMIN.email)
    await page.getByRole("menuitem", { name: "Sign out" }).click()
    await expect(page).toHaveURL(/\/en\/admin\/login$/)
    expect((await context.cookies()).find((c) => c.name === "__Host-admin_session")).toBeUndefined()
    // The old session no longer opens the panel.
    await page.goto("/en/admin/workshops")
    await expect(page).toHaveURL(/\/en\/admin\/login\?next=/)

    // 4. Sign in again: back to the page that was asked for.
    await page.getByLabel("Email").fill(ADMIN.email.toUpperCase())
    await page.getByLabel("Password", { exact: true }).fill(ADMIN.password)
    await page.getByRole("button", { name: "Sign in" }).click()
    await expect(page).toHaveURL(/\/en\/admin\/workshops$/)

    const audit = await one<{ n: string }>(
      "select count(*) as n from audit_log where action in ('auth.login','auth.logout') and at > now() - interval '5 minutes'",
    )
    expect(Number(audit.n)).toBeGreaterThanOrEqual(3)
  })

  test("an open redirect through ?next is refused", async ({ page }) => {
    await page.goto("/en/admin/login?next=https://evil.example/")
    await page.getByLabel("Email").fill(ADMIN.email)
    await page.getByLabel("Password", { exact: true }).fill(ADMIN.password)
    await page.getByRole("button", { name: "Sign in" }).click()
    await expect(page).toHaveURL(/localhost:\d+\/en\/admin$/)
  })
})
