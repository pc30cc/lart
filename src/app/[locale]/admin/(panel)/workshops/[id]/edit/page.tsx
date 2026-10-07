import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getLocale, getTranslations } from "next-intl/server"
import { z } from "zod"

import { PageHeader } from "@/components/admin/page-header"
import type { LocalizedText } from "@/db/schema"
import { getWorkshop, getWorkshopFormOptions, type Workshop } from "@/features/workshops/queries"
import { contractLocked, type WorkshopFormValues } from "@/features/workshops/schema"
import { requireAdmin } from "@/lib/auth/admin"
import { localized } from "@/lib/format"
import { getSetting } from "@/lib/settings"
import { WorkshopForm } from "../../_components/workshop-form"

const text = (v: LocalizedText | null) => ({ fa: v?.fa ?? "", tr: v?.tr ?? "", en: v?.en ?? "" })

/** The saved workshop as form values (contract terms from the current contract). */
function formValues(w: Workshop): WorkshopFormValues {
  const advance = w.contract?.advanceAmount ?? 0
  return {
    title: text(w.title),
    slug: w.slug,
    categoryId: w.categoryId,
    instructorId: w.instructorId,
    startsAt: w.startsAt.toISOString(),
    endsAt: w.endsAt.toISOString(),
    registrationDeadline: w.registrationDeadline.toISOString(),
    decisionAt: w.decisionAt.toISOString(),
    venue: text(w.venue),
    ageGroup: w.ageMin !== null || w.ageMax !== null ? "children" : "adults",
    ageMin: w.ageMin,
    ageMax: w.ageMax,
    minCapacity: w.minCapacity,
    maxCapacity: w.maxCapacity,
    price: w.price,
    termsTemplateId: w.termsTemplateId,
    intro: text(w.intro),
    includes: text(w.includes),
    bringNothing: w.bring === null,
    bring: text(w.bring),
    experienceRequired: w.experienceRequired,
    experienceNote: text(w.experienceNote),
    notes: text(w.notes),
    coverPath: w.coverPath,
    samples: w.samples,
    paymentUrl: w.paymentUrl ?? "",
    feeType: w.contract?.feeType ?? "per_participant",
    feeAmount: w.contract?.feeAmount ?? 0,
    hasAdvance: advance > 0,
    advanceAmount: advance > 0 ? advance : null,
  }
}

async function load(id: string) {
  if (!z.uuid().safeParse(id).success) notFound()
  const workshop = await getWorkshop(id)
  if (!workshop) notFound()
  return workshop
}

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/workshops/[id]/edit">): Promise<Metadata> {
  const { id } = await params
  if (!z.uuid().safeParse(id).success) return {}
  const [workshop, t, locale] = await Promise.all([getWorkshop(id), getTranslations("workshops"), getLocale()])
  return workshop ? { title: t("editTitle", { title: localized(workshop.title, locale) }) } : {}
}

export default async function EditWorkshopPage({ params }: PageProps<"/[locale]/admin/workshops/[id]/edit">) {
  await requireAdmin()
  const { id } = await params
  const [workshop, t, locale] = await Promise.all([load(id), getTranslations("workshops"), getLocale()])
  const [options, payment] = await Promise.all([getWorkshopFormOptions(workshop.instructorId), getSetting("payment")])
  const title = localized(workshop.title, locale)

  return (
    <>
      <PageHeader
        title={t("editTitle", { title })}
        description={t("editDescription")}
        back={{ href: `/admin/workshops/${workshop.id}`, label: t("backToWorkshop") }}
      />
      <WorkshopForm
        options={options}
        onlinePayment={payment.online.enabled}
        workshop={{
          id: workshop.id,
          status: workshop.status,
          contractLocked: contractLocked(workshop),
          values: formValues(workshop),
          coverUrl: workshop.coverUrl,
          registered: workshop.registered.pending + workshop.registered.confirmed,
          contract: workshop.contract && { version: workshop.contract.version, status: workshop.contract.status },
          instructorName: localized(workshop.instructor.displayName, locale) || workshop.instructor.officialName,
        }}
      />
    </>
  )
}
