import { getTranslations } from "next-intl/server"

import { ThemeToggle } from "@/components/theme-toggle"
import { formatYear } from "@/lib/format"

/** The classic theme's quiet footer: the brand and the year, and the light / dark switch. */
export async function SiteFooter({ brand, locale }: { brand: string; locale: string }) {
  const t = await getTranslations("site.footer")
  // This year in the language's calendar (۱۴۰۵ in Persian).
  const year = formatYear(new Date(), locale)

  return (
    <footer className="mt-auto border-t">
      <div className="text-muted-foreground mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-6 text-sm">
        <p>{t("rights", { brand, year })}</p>
        <ThemeToggle />
      </div>
    </footer>
  )
}
