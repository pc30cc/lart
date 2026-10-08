import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { NotFoundView } from "@/components/site/not-found-view"

/** "Page not found · brand", never indexed (its links are followed); no canonical or language links: a 404 is no page of its own. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("site.notFound")
  return { title: t("metaTitle"), robots: { index: false, follow: true } }
}

/**
 * The public site's not-found page (an unknown address, a workshop that is not
 * published): inside the active theme's frame, so the header, the menu and
 * the footer stay. Next renders it with every page of the site (as a ready
 * boundary), so it stays cheap: no reads of its own.
 */
export default function SiteNotFound() {
  return <NotFoundView />
}
