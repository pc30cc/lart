import fs from "node:fs"

import { ADMIN, E2E_DIR, expect, test } from "./helpers/app"

// The login is rate limited per client IP (10 per 15 minutes). Without a proxy in
// front, every local run shares one key, so each run signs in as a client of its own.
test.use({ extraHTTPHeaders: { "x-real-ip": `10.98.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` } })

/** Sign in once and keep the session for the other specs (.e2e/auth.json). */
test("sign in as the super admin", async ({ page }) => {
  fs.mkdirSync(E2E_DIR, { recursive: true })
  await page.goto("/en/admin/login")
  await page.getByLabel("Email").fill(ADMIN.email)
  await page.getByLabel("Password", { exact: true }).fill(ADMIN.password)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).toHaveURL(/\/en\/admin$/)
  await page.context().storageState({ path: `${E2E_DIR}/auth.json` })
})
