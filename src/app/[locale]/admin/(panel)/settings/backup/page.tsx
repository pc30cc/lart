import { ArchiveIcon, CalendarRangeIcon, DatabaseIcon, FolderArchiveIcon, LandmarkIcon, ReceiptTextIcon } from "lucide-react"
import type { Metadata } from "next"
import { getLocale, getTranslations } from "next-intl/server"

import { BreadcrumbTitle } from "@/components/admin/breadcrumbs"
import { StatusBadge } from "@/components/admin/status-badge"
import { exportChoices, listBackups, monthFileName } from "@/features/backup/backup"
import { requireAdmin } from "@/lib/auth/admin"
import { formatDate, formatNumber, formatTime } from "@/lib/format"
import { getSetting } from "@/lib/settings"
import { BackupSettingsForm, DownloadButton, ManualBackupButton, PickAndDownload } from "./backup-panel"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings")
  return { title: `${t("tabs.backup")} · ${t("title")}` }
}

/** "12.4 megabytes", "۱۲٫۴ مگابایت" (spelled out: a Latin "MB" reads backwards in Persian). */
function size(bytes: number, locale: string) {
  const mb = bytes / (1024 * 1024)
  return mb >= 1
    ? new Intl.NumberFormat(locale, { style: "unit", unit: "megabyte", unitDisplay: "long", maximumFractionDigits: 1 }).format(mb)
    : new Intl.NumberFormat(locale, { style: "unit", unit: "kilobyte", unitDisplay: "long", maximumFractionDigits: 0 }).format(Math.max(1, bytes / 1024))
}

/**
 * Settings → Backup: the automatic
 * daily backup of the whole database and one by hand, the Persian Excel
 * reports (expenses, all the books, a workshop, a month) and every receipt as
 * one ZIP, and the backups kept (backup/<day>/ in the storage), by day.
 */
export default async function BackupSettingsPage() {
  await requireAdmin()
  const locale = await getLocale()
  const [t, ts, setting, backups, choices, cdn] = await Promise.all([
    getTranslations("settings.backup"),
    getTranslations("settings"),
    getSetting("backup"),
    listBackups(),
    exportChoices(locale),
    getSetting("cdn"),
  ])
  const days = Map.groupBy(backups, (b) => b.day)

  return (
    <>
      <BreadcrumbTitle title={ts("tabs.backup")} />
      <div className="space-y-10">
        <BackupSettingsForm auto={setting.auto} />

        <section className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-8">
          <div className="space-y-1">
            <h2 className="text-base font-semibold">{t("manual.title")}</h2>
            <p className="text-muted-foreground text-sm text-pretty">{t("manual.description")}</p>
          </div>
          <div className="bg-card ring-foreground/8 space-y-4 rounded-xl p-5 shadow-xs ring-1 md:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-muted-foreground text-sm text-pretty">
                {t("manual.where", { folder: "backup/" })}
              </p>
              <ManualBackupButton />
            </div>
            {cdn.provider === "local" && <p className="bg-warning/10 rounded-lg p-3 text-sm text-pretty">{t("manual.localStorage")}</p>}
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-8">
          <div className="space-y-1">
            <h2 className="text-base font-semibold">{t("downloads.title")}</h2>
            <p className="text-muted-foreground text-sm text-pretty">{t("downloads.description")}</p>
          </div>
          <div className="bg-card ring-foreground/8 divide-y rounded-xl shadow-xs ring-1">
            <Row icon={ReceiptTextIcon} title={t("downloads.expenses.title")} hint={t("downloads.expenses.hint")}>
              <DownloadButton href="/api/admin/exports/expenses" label={t("downloads.excel")} />
            </Row>
            <Row icon={LandmarkIcon} title={t("downloads.finance.title")} hint={t("downloads.finance.hint")}>
              <DownloadButton href="/api/admin/exports/finance" label={t("downloads.excel")} />
            </Row>
            <Row icon={ArchiveIcon} title={t("downloads.workshop.title")} hint={t("downloads.workshop.hint")} wide>
              <PickAndDownload
                kind="workshop"
                param="id"
                options={choices.workshops.map((w) => ({ value: w.id, label: w.label }))}
                label={t("downloads.excel")}
                placeholder={t("downloads.workshop.none")}
              />
            </Row>
            <Row icon={CalendarRangeIcon} title={t("downloads.month.title")} hint={t("downloads.month.hint")} wide>
              <PickAndDownload
                kind="month"
                param="m"
                options={choices.months.map((m) => ({ value: m.value, label: m.current ? t("downloads.month.current", { month: m.label }) : m.label }))}
                label={t("downloads.excel")}
                placeholder={t("downloads.month.none")}
              />
            </Row>
            <Row icon={FolderArchiveIcon} title={t("downloads.invoices.title")} hint={t("downloads.invoices.hint")}>
              <DownloadButton href="/api/admin/exports/invoices" label={t("downloads.zip")} icon="zip" />
            </Row>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-8">
          <div className="space-y-1">
            <h2 className="text-base font-semibold">{t("list.title")}</h2>
            <p className="text-muted-foreground text-sm text-pretty">{t("list.description")}</p>
          </div>
          <div className="bg-card ring-foreground/8 rounded-xl shadow-xs ring-1">
            {backups.length === 0 ? (
              <div className="text-muted-foreground flex flex-col items-center gap-2 p-10 text-center text-sm">
                <DatabaseIcon className="size-8 opacity-50" aria-hidden />
                {t("list.empty")}
              </div>
            ) : (
              <ol className="divide-y">
                {[...days].map(([day, items]) => (
                  <li key={day} className="p-4 md:p-5">
                    <h3 className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm font-semibold">
                      {formatDate(`${day}T09:00:00Z`, locale, "full")}
                      <span className="text-muted-foreground font-mono text-xs font-normal" dir="ltr">
                        backup/{day}/
                      </span>
                    </h3>
                    <ul className="space-y-2">
                      {items.map((b) => (
                        <li key={b.id} className="bg-muted/30 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2 text-sm">
                          <StatusBadge tone={b.kind === "manual" ? "info" : b.kind === "monthly" ? "success" : "neutral"}>{t(`kind.${b.kind}`)}</StatusBadge>
                          <span className="min-w-36 flex-1 truncate">
                            {b.kind === "monthly" && b.month
                              ? t("list.monthReport", { name: monthFileName(b.month) })
                              : b.by
                                ? t("list.by", { name: b.by })
                                : t("list.byItself")}
                          </span>
                          <span className="text-muted-foreground tabular-nums">{formatTime(b.createdAt, locale)}</span>
                          <span className="text-muted-foreground tabular-nums">{size(b.size, locale)}</span>
                          <a
                            href={`/api/admin/backups/${b.id}`}
                            className="hover:bg-background focus-visible:ring-ring/50 inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium outline-none focus-visible:ring-3"
                          >
                            {t("list.download")}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            )}
            {backups.length > 0 && (
              <p className="text-muted-foreground border-t px-4 py-3 text-xs md:px-5">
                {t("list.count", { n: formatNumber(backups.length, locale) })}
              </p>
            )}
          </div>
        </section>
      </div>
    </>
  )
}

function Row({
  icon: Icon,
  title,
  hint,
  wide,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  hint: string
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={wide ? "space-y-3 p-4 md:p-5" : "flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between md:p-5"}>
      <div className="flex gap-3">
        <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
          <Icon className="size-4.5" />
        </span>
        <div className="space-y-0.5">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-muted-foreground text-sm text-pretty">{hint}</p>
        </div>
      </div>
      {children}
    </div>
  )
}
