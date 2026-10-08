import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { PanelNotFound } from "@/components/admin/panel-not-found"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.panelNotFound")
  return { title: t("metaTitle") }
}

/** Not found in the instructor panel: inside its shell, with the way back to its start. */
export default function InstructorNotFound() {
  return <PanelNotFound home="/instructor" label="instructorHome" />
}
