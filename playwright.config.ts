import { defineConfig, devices } from "@playwright/test"

/**
 * End-to-end tests of the super-admin panel against a running production build.
 *
 *   pnpm build && DATABASE_URL=postgres://lart:lart@127.0.0.1:5432/lart_e2e PORT=3100 APP_URL=http://localhost:3100 pnpm start
 *   E2E_SERVER_LOG=<file with the server output> pnpm exec playwright test
 *
 * The specs run in order (01 → 09) and build on each other's data, so they use
 * one worker. Every run uses a fresh suffix (E2E_RUN) for names, emails and
 * slugs, so the suite can run again on the same database.
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
