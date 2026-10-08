import path from "node:path"
import { defineConfig } from "vitest/config"

const shared = {
  resolve: { alias: { "@": path.resolve(__dirname, "src"), "server-only": path.resolve(__dirname, "src/test/empty.ts") } },
}
const test = {
  environment: "node" as const,
  setupFiles: ["src/test/setup.ts"],
  server: { deps: { inline: ["next-intl"] } },
}
const db = (name: string) => `postgres://lart:lart@127.0.0.1:5432/${name}`

export default defineConfig({
  ...shared,
  test: {
    projects: [
      {
        ...shared,
        test: {
          ...test,
          name: "main",
          include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
          exclude: ["src/features/dashboard/**", "src/features/settings/reset.test.ts", "**/node_modules/**"],
        },
      },
      {
        // The dashboard compares whole lists, so it gets a database of its own.
        ...shared,
        test: {
          ...test,
          name: "dashboard",
          include: ["src/features/dashboard/**/*.test.{ts,tsx}"],
          env: { TEST_DATABASE_URL: process.env.TEST_DASHBOARD_DATABASE_URL ?? db("lart_test_dashboard") },
        },
      },
      {
        // The factory reset empties the whole ledger: a database of its own, or it would pull other tests' rows away.
        ...shared,
        test: {
          ...test,
          name: "reset",
          include: ["src/features/settings/reset.test.ts"],
          env: { TEST_DATABASE_URL: process.env.TEST_RESET_DATABASE_URL ?? db("lart_test_reset") },
        },
      },
    ],
  },
})
