/**
 * Runs once when the server starts (production server only): one-time content
 * the owner asked for (features/site/startup-content) and the timer of the
 * scheduled backups.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return
  if (process.env.NEXT_PHASE === "phase-production-build") return
  const { placeStartupContent } = await import("./features/site/startup-content")
  // In the background: the site starts serving meanwhile.
  placeStartupContent()
    .then((placed) => placed && console.info("[content] one-time content placed"))
    .catch((err) => console.error("[content] one-time content failed", err instanceof Error ? err.message : err))
  if (process.env.BACKUP_TIMER === "off") return
  const { startBackupTimer } = await import("./features/backup/timer")
  startBackupTimer()
}
