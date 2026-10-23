import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { getGeneralSettings } from "@/features/settings/queries"
import { translationModels } from "@/features/translate/schema"
import { requireAdmin } from "@/lib/auth/admin"
import { getSetting } from "@/lib/settings"
import { GeneralSettingsForm } from "./_components/general-form"
import { TranslationSettingsForm } from "./_components/translation-form"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings")
  return { title: t("title") }
}

export default async function GeneralSettingsPage() {
  await requireAdmin()
  const [saved, translation] = await Promise.all([getGeneralSettings(), getSetting("translation")])
  // The model saved, if still offered; the key never leaves the server, only whether there is one.
  const model = translationModels.find((m) => m === translation.model) ?? translationModels[0]
  return (
    <>
      <GeneralSettingsForm saved={saved} />
      <TranslationSettingsForm saved={{ keySaved: Boolean(translation.openaiKeyEnc), model }} />
    </>
  )
}
