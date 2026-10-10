/** Runs once when the server starts: the timer of the scheduled backups (production server only). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return
  if (process.env.NEXT_PHASE === "phase-production-build" || process.env.BACKUP_TIMER === "off") return
  const { startBackupTimer } = await import("./features/backup/timer")
  startBackupTimer()
}
