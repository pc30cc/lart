import { CalendarDaysIcon, ClockIcon, MapPinIcon, PaletteIcon, UsersRoundIcon, type LucideIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"

import type { WorkshopCard as Card } from "@/features/registrations/public"
import { Link } from "@/i18n/navigation"
import { formatDate, formatTimeRange } from "@/lib/format"
import { AgeLabel, AvailabilityBadge, Price } from "./labels"

/** One workshop in the list: cover, title, when and where, who it's for, price and places left. */
export function WorkshopCard({ workshop: w, priority }: { workshop: Card; priority?: boolean }) {
  const t = useTranslations("registration")
  const locale = useLocale()

  return (
    <Link
      href={`/workshops/${w.slug}`}
      className="group bg-card ring-foreground/8 focus-visible:ring-ring/60 flex flex-col overflow-hidden rounded-2xl shadow-xs ring-1 transition-shadow outline-none hover:shadow-md focus-visible:ring-3"
    >
      <div className="bg-muted relative aspect-[4/3] overflow-hidden">
        {w.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- CDN URL, any host
          <img
            src={w.coverUrl}
            alt=""
            loading={priority ? "eager" : "lazy"}
            fetchPriority={priority ? "high" : undefined}
            className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="from-primary/15 to-chart-3/20 flex size-full items-center justify-center bg-linear-to-br">
            <PaletteIcon className="text-primary/50 size-12" aria-hidden />
          </div>
        )}
        <AvailabilityBadge window={w.window} seatsLeft={w.seatsLeft} overlay className="absolute start-3 top-3" />
      </div>

      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="space-y-1">
          {w.category && <p className="text-primary text-xs font-medium">{w.category}</p>}
          <h2 className="text-lg leading-snug font-semibold text-balance">{w.title}</h2>
          {w.instructorName && <p className="text-muted-foreground text-sm">{t("list.with", { name: w.instructorName })}</p>}
        </div>
        <ul className="text-muted-foreground space-y-1.5 text-sm">
          <Line icon={CalendarDaysIcon}>{formatDate(w.startsAt, locale, "full")}</Line>
          <Line icon={ClockIcon}>
            <bdi>{formatTimeRange(w.startsAt, w.endsAt, locale)}</bdi>
          </Line>
          <Line icon={MapPinIcon}>{w.venue}</Line>
          <Line icon={UsersRoundIcon}>
            <AgeLabel ageMin={w.ageMin} ageMax={w.ageMax} />
          </Line>
        </ul>
        <div className="mt-auto flex items-baseline justify-between gap-3 border-t pt-3">
          <Price value={w.price} className="text-lg" />
          {w.price > 0 && <span className="text-muted-foreground text-xs">{t("price.perPerson")}</span>}
        </div>
      </div>
    </Link>
  )
}

function Line({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="min-w-0">{children}</span>
    </li>
  )
}
