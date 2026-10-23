import { Link } from "@/i18n/navigation"
import { formatDate } from "@/lib/format"
import type { PastWorkshop } from "@/themes/types"

/**
 * The workshops already held, newest first: each with its cover (or first
 * gallery photo), title and date, linking to its page (its gallery; no
 * registration). Coloured by the design tokens, so every theme gives it its own.
 */
export function PastGrid({ workshops, locale }: { workshops: PastWorkshop[]; locale: string }) {
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-6 lg:grid-cols-3 lg:gap-x-8 lg:gap-y-12">
      {workshops.map((w, i) => {
        const url = w.coverUrl ?? w.photos[0]?.url
        return (
          <li key={w.slug}>
            <Link
              href={`/workshops/${w.slug}`}
              className="group focus-visible:ring-ring/50 focus-visible:ring-offset-background flex flex-col rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-offset-4"
            >
              <div className="bg-muted aspect-[4/5] overflow-hidden rounded-2xl shadow-xs">
                {url && (
                  // eslint-disable-next-line @next/next/no-img-element -- CDN URL, any host
                  <img
                    src={url}
                    alt=""
                    width={800}
                    height={1000}
                    loading={i < 3 ? "eager" : "lazy"}
                    decoding="async"
                    className="size-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]"
                  />
                )}
              </div>
              <h2 className="group-hover:text-primary mt-4 text-base leading-snug font-semibold text-balance transition-colors sm:text-lg">{w.title}</h2>
              <p className="text-muted-foreground mt-1 text-sm">{formatDate(w.startsAt, locale, "long")}</p>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
