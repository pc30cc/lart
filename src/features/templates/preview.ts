import "server-only"
import { getTranslations } from "next-intl/server"

import type { Locale } from "@/db/schema"
import { contractValues, renderContract, type ContractData } from "@/features/contracts/render"
import { zonedParts, zonedToIso } from "@/lib/format"
import { getBrand } from "@/lib/settings"

/** What the editor's preview needs per language: placeholder values and the contract's generated header. */
export type TemplatePreview = Record<
  Locale,
  { terms: Record<string, string>; contract: Record<string, string>; contractHeader: string }
>

const LOCALES: Locale[] = ["fa", "tr", "en"]
const DAY = 86_400_000

/**
 * Sample data for the template preview, formatted exactly like a real
 * contract (same code): a workshop two weeks from now, 14:00–17:00 Istanbul
 * time, a fee per participant and an advance. The brand is the real one.
 */
export async function templatePreview(): Promise<TemplatePreview> {
  const day = zonedParts(Date.now() + 14 * DAY).date
  const startsAt = new Date(zonedToIso(day, "14:00")!)
  const endsAt = new Date(zonedToIso(day, "17:00")!)

  const [fa, tr, en] = await Promise.all(
    LOCALES.map(async (locale) => {
      const [brand, t] = await Promise.all([
        getBrand(locale),
        getTranslations({ locale, namespace: "templates.preview.sample" }),
      ])
      const data: ContractData = {
        version: 1,
        templateBody: {},
        instructor: { officialName: t("instructorName"), idNumber: t("idNumber") },
        course: {
          title: { [locale]: t("workshopTitle") },
          startsAt,
          endsAt,
          venue: t("venue"),
          minCapacity: 4,
          maxCapacity: 12,
          decisionAt: new Date(startsAt.getTime() - 3 * DAY),
        },
        fee: { feeType: "per_participant", feeAmount: 75_000, advanceAmount: 100_000 },
      }
      const contractHeader = (await renderContract(data, locale, { brand })).trim()
      return { terms: { brand }, contract: contractValues(data, locale, brand), contractHeader }
    }),
  )
  return { fa, tr, en }
}
