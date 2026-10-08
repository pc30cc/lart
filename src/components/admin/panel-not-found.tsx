import { CompassIcon } from "lucide-react"
import { getTranslations } from "next-intl/server"

import { EmptyState } from "@/components/admin/empty-state"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/navigation"

/**
 * A panel's not-found page (an unknown address, a record that is not there),
 * inside the panel: the sidebar stays, and the way back is the panel's start
 * (`home`), never the public site.
 */
export async function PanelNotFound({ home, label }: { home: "/admin" | "/instructor"; label: "dashboard" | "instructorHome" }) {
  const t = await getTranslations("common.panelNotFound")
  return (
    <div className="mx-auto w-full max-w-xl py-10 sm:py-16">
      <EmptyState
        icon={CompassIcon}
        title={t("title")}
        description={t("description")}
        action={
          <Button asChild size="lg" className="px-4">
            <Link href={home}>{t(label)}</Link>
          </Button>
        }
      />
    </div>
  )
}
