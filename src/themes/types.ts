import type { ReactNode } from "react"

import type { WorkshopCard } from "@/features/registrations/public"
import type { LogoData, LogoSize } from "@/lib/logo"
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
 * - where a theme shows the brand's name as a wordmark, it shows the `logo`
 *   instead when there is one (`BrandLogo`, src/themes/logo.tsx), the name then
 *   being the link's or heading's accessible text;
 * - `top` (the "viewing as" bar) is shown at the top of the header, `banner`
 *   (the "Please confirm your email" banner) right under it;
 * - the page renders inside one <main> the frame provides.
 */

export type { WorkshopCard, LogoData, LogoSize }

/** The signed-in member, for the header's account button. */
export type HeaderMember = { name: string; email: string }

/** A link in the site's menus. `href` is a site path without the language ("/workshops"). */
export type NavItem = { href: string; label: string }

/** The footer's editable content (Settings → Home page); empty strings are left out by themes. */
export type FooterContent = {
  /** The footer's links (Workshops, About us, Our story), in order. */
  links: NavItem[]
  /** A few sentences about the brand (bundled text when not set). */
  about: string
  /** An Instagram address (https://instagram.com/…) or "" */
  instagram: string
  /**
   * The email address and phone number, concealed (lib/conceal) so spam
   * harvesters never read them in the page: a theme shows them with
   * `ProtectedContact` (components/site/protected-contact), never as text.
   * "" when not set.
   */
  emailCode: string
  phoneCode: string
}

export type SiteFrameProps = {
  locale: string
  brand: string
  /** The site's logo (Settings → Appearance), else null: the brand's name shows. */
  logo: LogoSize | null
  member: HeaderMember | null
  /** The "viewing as" bar while a super admin views as the member, else null. */
  top: ReactNode
  /** The "Please confirm your email" banner, else null. */
  banner: ReactNode
  /** The main menu (Workshops, …), in order (the footer's links are `footer.links`). */
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
  /**
   * The site's logo with its shapes, else null. A page draws it with
   * `LogoPicture`, never `BrandLogo`: after a logo change, a visitor moving
   * around the site gets new pages inside the layout (and its `#site-logo`)
   * rendered before the change.
   */
  logo: LogoData | null
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

/** A partner on the Our story page, in the page's language: only partners who chose to be shown. */
export type AboutPartner = {
  /** Stable key for lists. */
  key: string
  name: string
  /** "" when they wrote none in this language (never another language's). */
  role: string
  /** Their own words in this language, "" when none (a theme leaves the paragraph out). */
  bio: string
  portraitUrl: string | null
}

/**
 * The About page (/about) or the Our story page (/story), in the page's
 * language. About: the brand's few sentences (the footer's "About us" text,
 * Settings → Home page, else the bundled one) and no partners. Our story: a
 * short intro and the partners who chose to be shown (My profile; none: the
 * page keeps its intro and call to action). Both: the story band's photo (Settings → Home page
 * → Story, else null: the theme's own). Its only h1 is `title`; each partner's
 * name is an h3 under the `partnersTitle` h2.
 */
export type AboutData = {
  locale: string
  brand: string
  kicker: string
  title: string
  intro: string
  partners: AboutPartner[]
  storyImageUrl: string | null
  labels: {
    partnersTitle: string
    portraitAlt: (name: string) => string
    ctaTitle: string
    ctaText: string
    ctaButton: string
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
  /** The About page (/about, the brand's words) and the Our story page (/story, the partners). */
  About: (props: { data: AboutData }) => ReactNode | Promise<ReactNode>
  /** One workshop in a list (home page and /workshops). */
  WorkshopCard: (props: WorkshopCardProps) => ReactNode | Promise<ReactNode>
  /** The browser's theme colour (mobile address bar) for light and dark. */
  themeColor: { light: string; dark: string }
  /** The theme's own fonts (also in ids.ts, for the settings form). */
  fonts: SiteFonts
}
