import { ChevronRightIcon, SparklesIcon } from "lucide-react"

import { EmptyState } from "@/components/admin/empty-state"
import { Button } from "@/components/ui/button"
import type { WorkshopCard as Card } from "@/features/registrations/public"
import { Link } from "@/i18n/navigation"
import { WorkshopCard } from "../workshops/_components/workshop-card"

/**
 * The home page's next workshops (a few, soonest first) with the way to all
 * of them, or a calm "coming soon" when none is open. A theme can replace
 * this section with its own (same props).
 */
export function UpcomingWorkshops({
  workshops,
  title,
  allLabel,
  emptyTitle,
  emptyText,
}: {
  workshops: Card[]
  title: string
  allLabel: string
  emptyTitle: string
  emptyText: string
}) {
  return (
    <section aria-labelledby="upcoming-title" className="mx-auto w-full max-w-6xl px-4 py-10 sm:py-14">
      <div className="mb-6 flex items-baseline justify-between gap-4 sm:mb-8">
        <h2 id="upcoming-title" className="font-serif text-3xl font-medium text-balance rtl:font-bold">
          {title}
        </h2>
        {workshops.length > 0 && (
          <Link
            href="/workshops"
            className="text-primary focus-visible:ring-ring/50 hidden shrink-0 items-center gap-1 rounded-md text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3 sm:inline-flex"
          >
            {allLabel}
            <ChevronRightIcon className="size-4 rtl:rotate-180" aria-hidden />
          </Link>
        )}
      </div>

      {workshops.length === 0 ? (
        <EmptyState icon={SparklesIcon} title={emptyTitle} description={emptyText} />
      ) : (
        <>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {workshops.map((w, i) => (
              <WorkshopCard key={w.id} workshop={w} priority={i < 3} headingAs="h3" />
            ))}
          </div>
          <Button asChild variant="outline" className="mt-6 h-12 w-full rounded-xl text-base sm:hidden">
            <Link href="/workshops">{allLabel}</Link>
          </Button>
        </>
      )}
    </section>
  )
}
