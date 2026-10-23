import { Link } from "@/i18n/navigation"
import { cn } from "@/lib/utils"

/**
 * Upcoming workshops (/workshops) or the ones already held
 * (/workshops?view=past), above the list. Plain links; the one shown is
 * marked with aria-current, coloured by the design tokens.
 */
export function ViewTabs({ past, label, upcomingLabel, pastLabel }: { past: boolean; label: string; upcomingLabel: string; pastLabel: string }) {
  const tab = (active: boolean) =>
    cn(
      "inline-flex min-h-10 items-center rounded-full px-4 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/60",
      active ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
    )
  return (
    <nav aria-label={label} className="mb-6 sm:mb-8">
      <ul className="bg-muted inline-flex gap-1 rounded-full p-1">
        <li>
          <Link href="/workshops" scroll={false} aria-current={past ? undefined : "page"} className={tab(!past)}>
            {upcomingLabel}
          </Link>
        </li>
        <li>
          <Link href={{ pathname: "/workshops", query: { view: "past" } }} scroll={false} aria-current={past ? "page" : undefined} className={tab(past)}>
            {pastLabel}
          </Link>
        </li>
      </ul>
    </nav>
  )
}
