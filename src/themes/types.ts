import type { ReactNode } from "react"

import type { WorkshopCard } from "@/features/registrations/public"
import type { SiteFonts } from "./fonts"
import type { ThemeId } from "./ids"

/**
 * The contract between the site and its themes.
 *
 * Pages and layouts fetch the data (src/features/site, registrations/public)
 * and hand a theme plain props; a theme only decides how things look. A new
 * theme is a folder src/themes/<id>/ exporting a `Theme`, registered in
 * src/themes/registry.ts and src/themes/ids.ts. Nothing else changes.
 *
 * Accessibility contract every theme keeps (tests rely on it):
 * - the home page has exactly one h1, equal to the brand;
 * - the first link in the first <header> is the brand, to the home page; the
 *   header is at most 80px tall on a phone;
 * - `top` (the "viewing as" bar) is shown at the top of the header, `banner`
 *   (the "Please confirm your email" banner) right under it;
 * - the page renders inside one <main> the frame provides.
 */

export type { WorkshopCard }

/** The signed-in member, for the header's account button. */
export type HeaderMember = { name: string; email: string }

/** A link in the site's menus. `href` is a site path without the language ("/workshops"). */
export type NavItem = { href: string; label: string }

/** The footer's editable content (Settings → Home page); empty strings are left out by themes. */
export type FooterContent = {
  /** A few sentences about the brand (bundled text when not set). */
  about: string
  /** An Instagram address (https://instagram.com/…) or "" */
  instagram: string
  email: string
  phone: string
}

export type SiteFrameProps = {
  locale: string
  brand: string
  member: HeaderMember | null
  /** The "viewing as" bar while a super admin views as the member, else null. */
  top: ReactNode
  /** The "Please confirm your email" banner, else null. */
  banner: ReactNode
  /** The main menu (Workshops, …), in order. */
  nav: NavItem[]
  footer: FooterContent
  children: ReactNode
}

/** A category with open workshops (the "explore by craft" links → /workshops?category=<slug>). */
export type PublicCategory = { slug: string; name: string; count: number }

/** A finished workshop with its photos (the "past workshops" gallery). */
export type PastWorkshop = {
  slug: string
  title: string
  startsAt: Date
  coverUrl: string | null
  photos: { url: string; width: number | null; height: number | null }[]
}

/** The hero's background: photos in turn, a video, or the theme's own photos (`theme`). */
export type HeroMedia =
  | { kind: "theme" }
  | { kind: "images"; images: string[] }
  | { kind: "video"; url: string; posterUrl: string | null }

/**
 * Everything the home page shows, in the page's language, with the bundled
 * texts filled in where the admin left a field empty. A section is null when
 * the admin hid it or it has nothing to show (`crafts` without categories,
 * `past` without finished workshops); image URLs are null when none was
 * uploaded (the theme then uses its own photos). Themes show what they have a
 * place for and ignore the rest.
 */
export type HomeData = {
  locale: string
  brand: string
  /** One sentence about the site: the SEO description setting, else the bundled tagline. */
  tagline: string
  hero: { media: HeroMedia; title: string; subtitle: string; button: string }
  /** The next open workshops, soonest first (at most 8). */
  upcoming: WorkshopCard[]
  /** Categories that have open workshops, in the admin's order. */
  categories: PublicCategory[]
  story: { title: string; text: string; button: string; imageUrl: string | null } | null
  crafts: { title: string; imageUrl: string | null } | null
  past: { title: string; workshops: PastWorkshop[] } | null
  steps: { title: string; items: { title: string; text: string }[]; imageUrl: string | null } | null
  /** Texts the sections share ("All workshops", the empty state). */
  labels: {
    upcomingTitle: string
    allWorkshops: string
    seeAllWorkshops: string
    emptyTitle: string
    emptyText: string
  }
}

export type WorkshopCardProps = {
  workshop: WorkshopCard
  /** Load the cover image first (the first cards on screen). */
  priority?: boolean
  /** The title's heading level: h2 on the workshops page, h3 under a section title. */
  headingAs?: "h2" | "h3"
}

export type Theme = {
  id: ThemeId
  /** The site's frame: header, the page in <main>, footer. */
  Frame: (props: SiteFrameProps) => ReactNode | Promise<ReactNode>
  /** The home page's sections. */
  Home: (props: { data: HomeData }) => ReactNode | Promise<ReactNode>
  /** One workshop in a list (home page and /workshops). */
  WorkshopCard: (props: WorkshopCardProps) => ReactNode | Promise<ReactNode>
  /** The browser's theme colour (mobile address bar) for light and dark. */
  themeColor: { light: string; dark: string }
  /** The theme's own fonts (also in ids.ts, for the settings form). */
  fonts: SiteFonts
}
