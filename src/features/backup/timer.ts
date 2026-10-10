import "server-only"

import { errorForLog } from "@/lib/errors"
import { runScheduledBackups } from "./backup"

const EVERY = 15 * 60_000

/**
 * The scheduled backups from inside the running site, so they happen even
 * when no `pnpm jobs` task is set up: shortly after the start, then every 15
 * minutes. `runScheduledBackups` is idempotent and takes a database lock, so
 * this, `pnpm jobs` and a second container during a deploy never double up.
 */
export function startBackupTimer() {
  const run = () =>
    runScheduledBackups()
      .then((r) => {
        if (r.due) console.info(`[backup] ${r.made} of ${r.due} scheduled backup(s) made`)
      })
      .catch((err) => console.error("[backup] scheduled backup failed", errorForLog(err)))
  setTimeout(run, 2 * 60_000).unref()
  setInterval(run, EVERY).unref()
}
