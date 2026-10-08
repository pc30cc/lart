import { CompassIcon } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/navigation"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.notFound")
  return { title: t("metaTitle"), robots: { index: false, follow: true } }
}

/**
 * The plain not-found page, for what the site's and panels' own do not catch
 * (a not-found from a layout, a sign-in page): the language's texts and the
 * way home, nothing that can fail.
 */
export default async function NotFound() {
  const t = await getTranslations("common.notFound")

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <div className="bg-primary/10 text-primary flex size-14 items-center justify-center rounded-2xl">
          <CompassIcon className="size-7" aria-hidden />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{t("title")}</h1>
        <p className="text-muted-foreground text-pretty">{t("description")}</p>
        <Button asChild size="lg" className="mt-2 px-4">
          <Link href="/">{t("home")}</Link>
        </Button>
      </div>
    </main>
  )
}
