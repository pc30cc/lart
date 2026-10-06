import { defineConfig, devices } from "@playwright/test"

/**
 * End-to-end tests of the super-admin panel against a running production build.
 *
 *   pnpm build
 *   node tests/e2e/helpers/mail-sink.mjs .e2e/mail.jsonl 3199 &      # fake Resend API: emails land in .e2e/mail.jsonl
 *   DATABASE_URL=postgres://lart:lart@127.0.0.1:5432/lart_e2e PORT=3100 APP_URL=http://localhost:3100 \
 *     RESEND_API_KEY=re_e2e_fake RESEND_BASE_URL=http://127.0.0.1:3199 EMAIL_FROM="Lart <noreply@lart.test>" pnpm start
 *   pnpm exec playwright test                                         # E2E_BASE_URL, E2E_DATABASE_URL to point elsewhere
 *
 * `next start` runs with NODE_ENV=production, where the app does not print
 * emails without RESEND_API_KEY, hence the mail sink. The database needs the
 * migrations, the seed (default templates) and the super admin
 * owner@lart.test / Correct-Horse-Battery-9 (share 100 %).
 *
 * The specs run in order (01 → 09) and build on each other's data, so they use
 * one worker. Every run uses a fresh suffix (E2E_RUN) for names, emails and
 * slugs, so the suite can run again on the same database. Screenshots go to
 * .e2e/screens/<page>-<locale>-<theme>-<size>.png, browser errors of every
 * page to .e2e/problems.jsonl.
 */
process.env.E2E_RUN ||= Date.now().toString(36).slice(-5)

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    locale: "en-GB",
    timezoneId: "Europe/Istanbul",
    viewport: { width: 1440, height: 900 },
    colorScheme: "light",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"], launchOptions: { executablePath: "/opt/pw-browsers/chromium" } },
    },
    {
      name: "admin",
      testMatch: /\d\d-.*\.spec\.ts/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        launchOptions: { executablePath: "/opt/pw-browsers/chromium" },
        storageState: ".e2e/auth.json",
      },
    },
  ],
})
