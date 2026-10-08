import { Link } from "@/i18n/navigation"
import { cn } from "@/lib/utils"
import type { PublicCategory } from "@/themes/types"

const pill =
  "inline-flex min-h-10 items-center rounded-full border px-4 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/60"
const idle = "border-border bg-card text-foreground hover:border-primary/50 hover:text-primary"
const active = "border-primary bg-primary text-primary-foreground"

/**
 * The craft filter above the workshops list: "All" and each category with
 * open workshops (/workshops?category=<slug>); the one shown is marked with
 * aria-current. Plain links, coloured by the design tokens, so every theme
 * gives it its own colours.
 */
export function CategoryFilter({
  categories,
  current,
  label,
  allLabel,
}: {
  categories: PublicCategory[]
  /** The slug of the category shown, or null for all. */
  current: string | null
  label: string
  allLabel: string
}) {
  const items = [{ slug: null, name: allLabel }, ...categories]
  return (
    <nav aria-label={label} className="mb-8 sm:mb-10">
      <ul className="flex flex-wrap gap-2">
        {items.map((c) => (
          <li key={c.slug ?? ""}>
            <Link
              href={c.slug ? { pathname: "/workshops", query: { category: c.slug } } : "/workshops"}
              scroll={false}
              aria-current={c.slug === current ? "page" : undefined}
              className={cn(pill, c.slug === current ? active : idle)}
            >
              {c.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
