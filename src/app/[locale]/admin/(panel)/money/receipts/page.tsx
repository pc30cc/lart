import { ArmchairIcon, ChevronLeftIcon, ChevronRightIcon, FileTextIcon, ImageIcon, ReceiptTextIcon } from "lucide-react"
import type { Metadata } from "next"
import { getLocale, getTranslations } from "next-intl/server"

import { EmptyState } from "@/components/admin/empty-state"
import { Money } from "@/components/admin/money"
import { PageHeader } from "@/components/admin/page-header"
import { StatusBadge } from "@/components/admin/status-badge"
import {
  editTargetsOf,
  listReceipts,
  receiptGroups,
  RECEIPTS_PER_PAGE,
  type EditTarget,
  type ReceiptFile,
  type ReceiptGroup,
  type ReceiptRow,
} from "@/features/money/queries"
import { Link } from "@/i18n/navigation"
import { isRtl } from "@/i18n/routing"
import { requireAdmin } from "@/lib/auth/admin"
import { formatDate, formatNumber, localized } from "@/lib/format"
import { cn } from "@/lib/utils"
import { EditEntry } from "../_components/edit-entry"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("money.receipts")
  return { title: t("title") }
}

type T = Awaited<ReturnType<typeof getTranslations<"money.receipts">>>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Money → Receipts: a gallery of the expenses that kept files (receipts and
 * invoices, photos or PDFs, and photos of furnishing), newest first: one card
 * per expense with all its files and what the expense was, and the total of
 * the tab's expenses above. Tabs: all, workshops, general, furnishing.
 */
export default async function ReceiptsPage({ searchParams }: PageProps<"/[locale]/admin/money/receipts">) {
  await requireAdmin()
  const query = await searchParams
  const group: ReceiptGroup = receiptGroups.find((g) => g === query.group) ?? "all"
  const page = Math.max(1, Math.min(10_000, Number.parseInt(String(query.page ?? "1"), 10) || 1))
  const workshopId = group === "workshops" && typeof query.workshop === "string" && UUID.test(query.workshop) ? query.workshop : undefined
  const [{ rows, total, counted, sum, counts, workshops }, t, locale] = await Promise.all([
    listReceipts(group, page, workshopId),
    getTranslations("money.receipts"),
    getLocale(),
  ])
  const edits = await editTargetsOf(rows.map((r) => r.transactionId))
  const pages = Math.max(1, Math.ceil(total / RECEIPTS_PER_PAGE))
  const href = (g: ReceiptGroup, p = 1, w = g === group ? workshopId : undefined) => {
    const sp = new URLSearchParams()
    if (g !== "all") sp.set("group", g)
    if (w) sp.set("workshop", w)
    if (p > 1) sp.set("page", String(p))
    const s = sp.toString()
    return `/admin/money/receipts${s ? `?${s}` : ""}`
  }
  const rtl = isRtl(locale)
  const Prev = rtl ? ChevronRightIcon : ChevronLeftIcon
  const Next = rtl ? ChevronLeftIcon : ChevronRightIcon

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />

      <nav aria-label={t("title")} className="bg-muted mb-6 inline-flex flex-wrap gap-1 rounded-xl p-1">
        {receiptGroups.map((g) => (
          <Link
            key={g}
            href={href(g)}
            aria-current={g === group ? "page" : undefined}
            className={cn(
              "text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm font-medium outline-none focus-visible:ring-3",
              g === group && "bg-background text-foreground shadow-xs",
            )}
          >
            {t(`tabs.${g}`)}
            <span className="text-muted-foreground text-xs tabular-nums">{formatNumber(counts[g], locale)}</span>
          </Link>
        ))}
      </nav>

      {group === "workshops" && workshops.length > 0 && (
        <nav aria-label={t("tabs.workshops")} className="-mt-2 mb-6 flex flex-wrap gap-2">
          {[{ id: undefined, label: t("allWorkshops"), n: counts.workshops }, ...workshops.map((w) => ({ id: w.id, label: localized(w.title, locale), n: w.n }))].map((w) => (
            <Link
              key={w.id ?? "all"}
              href={href("workshops", 1, w.id)}
              aria-current={w.id === workshopId ? "page" : undefined}
              className={cn(
                "hover:border-foreground/30 focus-visible:ring-ring/50 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs outline-none focus-visible:ring-3",
                w.id === workshopId && "bg-foreground text-background border-transparent hover:border-transparent",
              )}
            >
              {w.label}
              <span className="tabular-nums opacity-70">{formatNumber(w.n, locale)}</span>
            </Link>
          ))}
        </nav>
      )}

      {total > 0 && (
        // The tab's expenses added up (every page; reversed ones left out).
        <p className="mb-6 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-muted-foreground text-sm">{t("sum", { count: counted })}</span>
          <Money value={sum} className="text-xl font-semibold" />
          {counted < total && <span className="text-muted-foreground text-xs">{t("sumReversed", { count: total - counted })}</span>}
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState icon={ReceiptTextIcon} title={t("empty.title")} description={t("empty.description")} />
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {rows.map((r) => (
            <ReceiptCard key={r.transactionId} receipt={r} edit={edits.get(r.transactionId) ?? null} locale={locale} t={t} />
          ))}
        </ul>
      )}

      {pages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-3 text-sm">
          {page > 1 ? (
            <Link href={href(group, page - 1)} className="hover:bg-muted inline-flex size-9 items-center justify-center rounded-lg border">
              <Prev className="size-4" />
            </Link>
          ) : (
            <span className="size-9" />
          )}
          <span className="text-muted-foreground tabular-nums">
            {formatNumber(page, locale)} / {formatNumber(pages, locale)}
          </span>
          {page < pages ? (
            <Link href={href(group, page + 1)} className="hover:bg-muted inline-flex size-9 items-center justify-center rounded-lg border">
              <Next className="size-4" />
            </Link>
          ) : (
            <span className="size-9" />
          )}
        </div>
      )}
    </>
  )
}

/** One expense: its first file large, the others (the receipt beside the item's photo…) small below it. */
function ReceiptCard({ receipt: r, edit, locale, t }: { receipt: ReceiptRow; edit: EditTarget | null; locale: string; t: T }) {
  const kind = r.furnishing ? "furnishing" : r.courseId ? "workshop" : "general"
  const [first, ...others] = r.files
  const roles = [...new Set(r.files.map((f) => f.role))]
  // Receipts and an item photo together: each file says which it is.
  const marked = roles.length > 1

  return (
    <li className="bg-card ring-foreground/8 group flex flex-col overflow-hidden rounded-xl shadow-xs ring-1">
      {first && <FileTile file={first} subject={r.subject} t={t} className="aspect-[3/4]" large marked={marked} />}
      {others.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 px-3 pt-3">
          {others.map((f) => (
            <li key={f.id}>
              <FileTile file={f} subject={r.subject} t={t} className="ring-foreground/10 aspect-square rounded-md ring-1" marked={marked} />
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-1 flex-col gap-1.5 p-3 text-sm">
        <div className="flex flex-wrap gap-1">
          {roles.map((role) => (
            <StatusBadge key={role} tone={role === "photo" ? "info" : "neutral"}>
              {t(`role.${role}`)}
            </StatusBadge>
          ))}
          {r.reversed && <StatusBadge tone="danger">{t("reversed")}</StatusBadge>}
        </div>
        <p className={cn("line-clamp-2 font-medium text-pretty", r.reversed && "line-through opacity-70")} dir="auto">
          {r.subject}
        </p>
        <div className="flex items-baseline justify-between gap-2">
          <Money value={r.amount} className="font-semibold" />
          <span className="text-muted-foreground text-xs">{formatDate(`${r.occurredOn}T09:00:00Z`, locale, "medium")}</span>
        </div>
        <p className="text-muted-foreground flex items-center gap-1 text-xs">
          {kind === "furnishing" && <ArmchairIcon className="size-3.5" aria-hidden />}
          {r.courseId && r.courseTitle ? (
            <Link href={`/admin/workshops/${r.courseId}/finances`} className="hover:text-primary truncate transition-colors">
              {localized(r.courseTitle, locale)}
            </Link>
          ) : (
            t(`kind.${kind}`)
          )}
        </p>
        <div className="mt-auto flex items-center justify-between gap-2">
          {r.recordedBy ? <p className="text-muted-foreground truncate text-xs">{t("by", { name: r.recordedBy })}</p> : <span />}
          {edit && <EditEntry target={edit} iconOnly />}
        </div>
      </div>
    </li>
  )
}

/** A file of an expense, opening it in a new tab: the picture, or a PDF sign. */
function FileTile({
  file: f,
  subject,
  t,
  className,
  large,
  marked,
}: {
  file: ReceiptFile
  subject: string
  t: T
  className?: string
  large?: boolean
  /** Show on the picture whether it is the receipt or the item's photo. */
  marked?: boolean
}) {
  const RoleIcon = f.role === "photo" ? ImageIcon : ReceiptTextIcon
  const picture = f.pdf ? (
    <span className="text-muted-foreground flex size-full flex-col items-center justify-center gap-1">
      <FileTextIcon className={large ? "size-10" : "size-5"} aria-hidden />
      <span className={cn("font-semibold tracking-wide", large ? "text-xs" : "text-[0.6rem]")}>{t("pdf")}</span>
    </span>
  ) : f.url ? (
    // eslint-disable-next-line @next/next/no-img-element -- a stored receipt on the CDN, already resized
    <img src={f.url} alt={`${t(`role.${f.role}`)}: ${subject}`} loading="lazy" className="size-full object-cover transition-transform duration-300 hover:scale-[1.03]" />
  ) : (
    <span className={cn("text-muted-foreground flex size-full items-center justify-center text-center", large ? "p-3 text-xs" : "p-1 text-[0.6rem]")}>
      {large ? t("unavailable") : <RoleIcon className="size-4" role="img" aria-label={`${t(`role.${f.role}`)}: ${t("unavailable")}`} />}
    </span>
  )
  const box = cn("bg-muted/50 relative block overflow-hidden", className)
  if (!f.url) return <div className={box}>{picture}</div>
  return (
    <a
      href={f.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${t("open")}: ${t(`role.${f.role}`)}, ${subject}`}
      title={t(`role.${f.role}`)}
      className={cn(box, "focus-visible:ring-ring/50 outline-none focus-visible:ring-3")}
    >
      {picture}
      {marked && (
        <span
          aria-hidden
          className={cn(
            "bg-background/85 text-foreground absolute start-1.5 top-1.5 flex items-center justify-center rounded-full shadow-xs backdrop-blur-sm",
            large ? "size-6" : "size-4.5",
          )}
        >
          <RoleIcon className={large ? "size-3.5" : "size-2.5"} />
        </span>
      )}
    </a>
  )
}
