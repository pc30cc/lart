/**
 * Scheduled jobs. Run with: pnpm jobs
 *
 * Meant to run every 15 minutes as a Coolify scheduled task (same image and
 * environment as the app). Every job is idempotent, so a missed or doubled
 * run is harmless. Exit code 1 when a job failed (Coolify shows it).
 *
 * Jobs (each one runs even when another failed):
 * - decision_due: email the super admins when a workshop's go / no-go
 *   decision time has passed (src/features/workshops/decisions.ts).
 * - workshop_reminder: the day-before reminder to everyone registered (paid
 *   or not yet) for a workshop starting within 24 hours, once per member
 *   and workshop; an unpaid registration's email also says how much is
 *   still to pay and shows the ways to pay that are switched on
 *   (src/features/registrations/admin/reminders.ts).
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
  const { sendDayBeforeReminders } = await import("../src/features/registrations/admin/reminders")
  const { db } = await import("../src/db")
  const { errorForLog } = await import("../src/lib/errors")
  let failed = false

  /** Run one job: log what it did; a throw or an unfinished run marks the whole run as failed. */
  async function job(name: string, run: () => Promise<{ done: number; due: number; what: string }>) {
    const started = Date.now()
    try {
      const { done, due, what } = await run()
      console.info(`[jobs] ${name}: ${done} of ${due} ${what} (${Date.now() - started} ms)`)
      if (done < due) failed = true
    } catch (err) {
      console.error(`[jobs] ${name} failed`, errorForLog(err))
      failed = true
    }
  }

  try {
    await job("decision_due", async () => {
      const r = await notifyDueDecisions()
      return { done: r.notified, due: r.due, what: "workshop(s) notified" }
    })
    await job("workshop_reminder", async () => {
      const r = await sendDayBeforeReminders()
      return { done: r.sent, due: r.due, what: "member(s) reminded" }
    })
  } finally {
    await db.$client.end()
  }
  if (failed) process.exitCode = 1
}

void main()
