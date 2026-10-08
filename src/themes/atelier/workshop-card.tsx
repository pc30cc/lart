import { useLocale } from "next-intl"

import { AvailabilityBadge, Price } from "@/components/site/workshop-labels"
import { Link } from "@/i18n/navigation"
import { formatDate, formatTimeRange } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { WorkshopCardProps } from "../types"
import { atelierPhotos } from "./photos"

/**
 * One workshop in a list, like a framed print in a gallery: the cover in a
 * thin beige frame (with the places left on it), then centred under it the
 * craft, the title, when, and the price. The whole card is one link. The
 * title is an `h2` (the workshops page) or an `h3` (under a section title).
 */
export function WorkshopCard({ workshop: w, priority, headingAs: Heading = "h2" }: WorkshopCardProps) {
  const locale = useLocale()
  const fallback = atelierPhotos.card

  return (
    <Link
      href={`/workshops/${w.slug}`}
      className="group focus-visible:ring-ring/50 flex flex-col rounded-[20px] pb-6 text-center outline-none focus-visible:ring-3 focus-visible:ring-offset-4 focus-visible:ring-offset-background"
    >
      <div className="relative">
        <div className="bg-at-frame aspect-square p-1.5 shadow-[0_18px_36px_-22px_rgb(91_49_30/0.55)] transition-[translate,box-shadow] duration-500 ease-out group-hover:-translate-y-1 group-hover:shadow-[0_26px_44px_-24px_rgb(91_49_30/0.6)] sm:p-2">
          <div className="bg-muted relative size-full overflow-hidden">
            {w.coverUrl || fallback ? (
              // eslint-disable-next-line @next/next/no-img-element -- CDN URL, any host
              <img
                src={w.coverUrl ?? fallback?.src}
                alt=""
                width={fallback && !w.coverUrl ? fallback.width : 800}
                height={fallback && !w.coverUrl ? fallback.height : 800}
                decoding="async"
                loading={priority ? "eager" : "lazy"}
                fetchPriority={priority ? "high" : undefined}
                style={w.coverUrl ? undefined : { objectPosition: fallback?.focus }}
                className="size-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
              />
            ) : (
              <Monogram title={w.title} />
            )}
          </div>
        </div>
        <AvailabilityBadge
          window={w.window}
          seatsLeft={w.seatsLeft}
          overlay
          className="absolute start-3 top-3 h-6 px-2.5 text-[11px] sm:start-4 sm:top-4 sm:h-7 sm:px-3 sm:text-xs"
        />
      </div>

      <div className="mt-5 flex flex-col items-center gap-1.5 px-1 sm:mt-6">
        {w.category && <p className="at-caps text-muted-foreground text-[11px] leading-snug font-medium sm:text-xs">{w.category}</p>}
        <Heading className="text-foreground text-lg leading-snug text-balance sm:text-[22px] sm:leading-tight">{w.title}</Heading>
        {/* Date and time on one line when there is room, else one under the other (never split). */}
        <p className="text-muted-foreground flex flex-wrap justify-center gap-x-3 text-[13px] leading-relaxed sm:text-sm">
          <span className="whitespace-nowrap">{formatDate(w.startsAt, locale, "medium")}</span>
          <bdi className="whitespace-nowrap">{formatTimeRange(w.startsAt, w.endsAt, locale)}</bdi>
        </p>
        <Price value={w.price} className="text-primary text-[15px] sm:text-base" />
      </div>
    </Link>
  )
}

/**
 * A card without a cover: the title's first letter, large and quiet, on warm
 * paper with a thin inner line, like a print's mount.
 */
function Monogram({ title }: { title: string }) {
  const letter = Array.from(title.trim())[0] ?? ""
  return (
    <div
      aria-hidden
      className={cn(
        "flex size-full items-center justify-center",
        "bg-[radial-gradient(120%_90%_at_30%_15%,var(--at-paper),color-mix(in_oklab,var(--at-beige)_38%,var(--at-paper))_70%)]",
        "dark:bg-[radial-gradient(120%_90%_at_30%_15%,#3a281d,#2a1a12_75%)]",
      )}
    >
      <span className="border-at-beige/60 absolute inset-3 border sm:inset-4" />
      <span className="at-heading text-primary/45 text-[clamp(3.5rem,9vw,6.5rem)] leading-none">{letter}</span>
    </div>
  )
}
