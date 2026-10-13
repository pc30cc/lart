"use client"

import { ChevronLeftIcon, ChevronRightIcon, ExternalLinkIcon, FileTextIcon, ImageIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { formatNumber } from "@/lib/format"
import { cn } from "@/lib/utils"

/** A file kept with a transaction: an expense's receipt or photo, or the transfer receipt a participant sent. */
export type LedgerDocument = { url: string; pdf: boolean; kind: "receipt" | "photo" | "transfer" }

/**
 * "Show the document": the transaction's files in a framed viewer on the same
 * page (a photo large, a PDF in place), one after the other with the arrows,
 * the keyboard or the thumbnails, and a link to open the file on its own.
 */
export function DocumentViewer({
  documents,
  title,
  details,
}: {
  documents: LedgerDocument[]
  /** What the transaction is ("Expense · Clay"). */
  title: string
  /** Its amount, date, participant…, under the title. */
  details: React.ReactNode
}) {
  const t = useTranslations("money")
  const locale = useLocale()
  const n = (v: number) => formatNumber(v, locale)
  const [index, setIndex] = useState(0)
  const count = documents.length
  const doc = documents[Math.min(index, count - 1)]
  if (!doc) return null
  const go = (step: number) => setIndex((i) => (i + step + count) % count)

  return (
    // Clicks inside the dialog must not open or close the table row around it (portals bubble through React).
    <span onClick={(e) => e.stopPropagation()} className="contents">
      <Dialog onOpenChange={(open) => open && setIndex(0)}>
        <DialogTrigger asChild>
          <Button variant="outline" size="xs" className="text-primary border-primary/25 hover:bg-primary/5 rounded-full px-2.5">
            <ImageIcon />
            {t("ledger.showDocument")}
            {count > 1 && <span className="bg-primary/10 rounded-full px-1.5 tabular-nums">{n(count)}</span>}
          </Button>
        </DialogTrigger>
        <DialogContent
          className="gap-0 overflow-hidden p-0 sm:max-w-3xl"
          onKeyDown={(e) => {
            if (count < 2) return
            const rtl = getComputedStyle(e.currentTarget).direction === "rtl"
            if (e.key === "ArrowRight") go(rtl ? -1 : 1)
            if (e.key === "ArrowLeft") go(rtl ? 1 : -1)
          }}
        >
          <div className="space-y-1 px-5 pt-5 pb-4 pe-12">
            <p className="text-primary text-xs font-medium">{t(`document.${doc.kind}`)}</p>
            <DialogTitle className="text-base leading-snug font-semibold" dir="auto">
              {title}
            </DialogTitle>
            <DialogDescription asChild>
              <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">{details}</div>
            </DialogDescription>
          </div>

          <div className="bg-muted/45 relative border-y px-4 py-5 sm:px-14">
            <div className="flex min-h-[40vh] items-center justify-center">
              {doc.pdf ? (
                <iframe
                  key={doc.url}
                  src={doc.url}
                  title={t("document.pdf")}
                  className="bg-background ring-foreground/10 h-[62vh] w-full rounded-lg shadow-md ring-1"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- a stored receipt on the CDN, any host
                <img
                  key={doc.url}
                  src={doc.url}
                  alt={t(`document.${doc.kind}`)}
                  className="animate-in fade-in-0 zoom-in-[0.98] ring-foreground/10 max-h-[62vh] w-auto max-w-full rounded-lg bg-white object-contain shadow-[0_18px_40px_-18px_rgb(0_0_0/0.45)] ring-1 duration-200"
                />
              )}
            </div>
            {count > 1 && (
              <>
                <Arrow side="start" label={t("document.previous")} onClick={() => go(-1)} />
                <Arrow side="end" label={t("document.next")} onClick={() => go(1)} />
              </>
            )}
          </div>

          {count > 1 && (
            <div className="flex gap-2 overflow-x-auto px-5 pt-4">
              {documents.map((d, i) => (
                <button
                  key={d.url}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={`${t(`document.${d.kind}`)} · ${t("document.of", { n: n(i + 1), total: n(count) })}`}
                  aria-current={i === index || undefined}
                  className={cn(
                    "bg-muted ring-foreground/10 relative size-14 shrink-0 overflow-hidden rounded-md ring-1 transition",
                    i === index ? "ring-primary ring-2" : "opacity-70 hover:opacity-100",
                  )}
                >
                  {d.pdf ? (
                    <FileTextIcon className="text-muted-foreground absolute inset-0 m-auto size-5" aria-hidden />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element -- a stored receipt on the CDN, any host
                    <img src={d.url} alt="" loading="lazy" className="size-full object-cover" />
                  )}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 px-5 py-3.5">
            <span className="text-muted-foreground text-xs tabular-nums">
              {count > 1 && t("document.of", { n: n(index + 1), total: n(count) })}
            </span>
            <Button asChild variant="ghost" size="sm">
              <a href={doc.url} target="_blank" rel="noopener noreferrer">
                <ExternalLinkIcon />
                {t("document.openNew")}
              </a>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </span>
  )
}

function Arrow({ side, label, onClick }: { side: "start" | "end"; label: string; onClick: () => void }) {
  const Icon = side === "start" ? ChevronLeftIcon : ChevronRightIcon
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "bg-background/90 absolute top-1/2 size-9 -translate-y-1/2 rounded-full shadow-md backdrop-blur-sm",
        side === "start" ? "start-2 sm:start-3" : "end-2 sm:end-3",
      )}
    >
      <Icon className="size-4 rtl:-scale-x-100" />
    </Button>
  )
}
