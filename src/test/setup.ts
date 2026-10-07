import "dotenv/config"
import { vi } from "vitest"

// Tests run against the separate test database (see docs/DEVELOPMENT.md).
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://lart:lart@127.0.0.1:5432/lart_test"
process.env.APP_URL ??= "http://localhost:3000"
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64")

// The main language is a setting, cached per process (src/i18n/main-locale.ts).
// Every test sees "tr", whatever another test file writes into the shared
// database meanwhile; main-locale.test.ts and settings.test.ts unmock it.
vi.mock("@/i18n/main-locale", () => ({
  getMainLocale: vi.fn(async () => "tr"),
  setMainLocale: vi.fn(),
  resetMainLocaleCache: vi.fn(),
  MAIN_LOCALE_TTL_MS: 30_000,
}))
