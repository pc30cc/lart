/**
 * Scheduled jobs. Run with: pnpm jobs
 *
 * Meant to run every 15 minutes as a Coolify scheduled task (same image and
 * environment as the app). Every job is idempotent, so a missed or doubled
 * run is harmless. Exit code 1 when a job failed (Coolify shows it).
 *
 * Jobs:
 * - decision_due: email the super admins when a workshop's go / no-go
 *   decision time has passed (src/features/workshops/decisions.ts).
 */
import "dotenv/config"

import Module, { createRequire } from "node:module"

// The app's server modules import "server-only", which throws outside React
// Server Components. This script is server code too: mark that import as
// already loaded (empty) before the app modules are imported below.
const load = createRequire(__filename)
const marker = load.resolve("server-only")
load.cache[marker] = Object.assign(new Module(marker), { filename: marker, loaded: true, exports: {} })

async function main() {
  const { notifyDueDecisions } = await import("../src/features/workshops/decisions")
  const { db } = await import("../src/db")
  let failed = false
  try {
    const started = Date.now()
    const result = await notifyDueDecisions()
    console.info(
      `[jobs] decision_due: ${result.notified} of ${result.due} workshop(s) notified (${Date.now() - started} ms)`,
    )
    if (result.notified < result.due) failed = true
  } catch (err) {
    console.error("[jobs] decision_due failed", err)
    failed = true
  } finally {
    await db.$client.end()
  }
  if (failed) process.exitCode = 1
}

void main()
