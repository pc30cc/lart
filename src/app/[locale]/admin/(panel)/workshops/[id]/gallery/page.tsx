import { BanIcon, CameraIcon, CameraOffIcon, ImagesIcon, ShieldCheckIcon, VideoIcon, VideoOffIcon } from "lucide-react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getLocale, getTranslations } from "next-intl/server"
import { z } from "zod"

import { EmptyState } from "@/components/admin/empty-state"
import { Button } from "@/components/ui/button"
import { getWorkshop, listConsents, listGallery } from "@/features/workshops/queries"
import { Link } from "@/i18n/navigation"
import { requireAdmin } from "@/lib/auth/admin"
import { formatNumber, localized } from "@/lib/format"
import { cn } from "@/lib/utils"
import { GalleryManager } from "../../_components/gallery-manager"
import { WorkshopHeader } from "../../_components/workshop-header"

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/workshops/[id]/gallery">): Promise<Metadata> {
  const { id } = await params
  if (!z.uuid().safeParse(id).success) return {}
  const [workshop, t, locale] = await Promise.all([getWorkshop(id), getTranslations("workshops"), getLocale()])
  return workshop ? { title: t("gallery.metaTitle", { title: localized(workshop.title, locale) }) } : {}
}

/** Photos and videos of a closed workshop, with each participant's consent as a reminder. */
export default async function WorkshopGalleryPage({ params }: PageProps<"/[locale]/admin/workshops/[id]/gallery">) {
  await requireAdmin()
  const { id } = await params
  if (!z.uuid().safeParse(id).success) notFound()
  const [workshop, t, locale] = await Promise.all([getWorkshop(id), getTranslations("workshops"), getLocale()])
  if (!workshop) notFound()

  if (workshop.status !== "closed") {
    const cancelled = workshop.status === "cancelled"
    return (
      <>
        <WorkshopHeader workshop={workshop} active="gallery" />
        <EmptyState
          icon={cancelled ? BanIcon : ImagesIcon}
          title={cancelled ? t("gallery.cancelled.title") : t("gallery.notYet.title")}
          description={cancelled ? t("gallery.cancelled.description") : t("gallery.notYet.description")}
          action={
            cancelled ? undefined : (
              <Button asChild variant="outline">
                <Link href={`/admin/workshops/${id}/finances`}>{t("gallery.notYet.action")}</Link>
              </Button>
            )
          }
        />
      </>
    )
  }

  const [items, people] = await Promise.all([listGallery(id), listConsents(id)])
  const photosOk = people.filter((p) => p.photoConsent).length
  const videosOk = people.filter((p) => p.videoConsent).length
  const n = (v: number) => formatNumber(v, locale)

  return (
    <>
      <WorkshopHeader workshop={workshop} active="gallery" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <section className="bg-card ring-foreground/8 min-w-0 rounded-xl p-5 shadow-xs ring-1 md:p-6">
          <div className="mb-2 space-y-1">
            <h2 className="font-semibold">{t("gallery.title")}</h2>
            <p className="text-muted-foreground text-sm text-pretty">{t("gallery.description")}</p>
          </div>
          <GalleryManager id={id} initial={items} />
        </section>

        <aside className="min-w-0">
          <section className="bg-card ring-foreground/8 rounded-xl p-5 shadow-xs ring-1">
            <div className="mb-3 flex items-start gap-3">
              <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
                <ShieldCheckIcon className="size-4.5" />
              </span>
              <div className="space-y-1">
                <h2 className="font-semibold">{t("gallery.consent.title")}</h2>
                <p className="text-muted-foreground text-xs text-pretty">{t("gallery.consent.description")}</p>
              </div>
            </div>
            {people.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("gallery.consent.nobody")}</p>
            ) : (
              <>
                <p className="mb-3 text-sm">
                  {t("gallery.consent.summary", { photos: n(photosOk), videos: n(videosOk), total: n(people.length) })}
                </p>
                <ul className="divide-y text-sm">
                  {people.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0 truncate">{p.participantName}</span>
                      <span className="flex shrink-0 gap-1.5">
                        <Mark ok={p.photoConsent} on={CameraIcon} off={CameraOffIcon}>
                          {p.photoConsent ? t("gallery.consent.photoYes") : t("gallery.consent.photoNo")}
                        </Mark>
                        <Mark ok={p.videoConsent} on={VideoIcon} off={VideoOffIcon}>
                          {p.videoConsent ? t("gallery.consent.videoYes") : t("gallery.consent.videoNo")}
                        </Mark>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </aside>
      </div>
    </>
  )
}

function Mark({
  ok,
  on: On,
  off: Off,
  children,
}: {
  ok: boolean
  on: React.ComponentType<{ className?: string }>
  off: React.ComponentType<{ className?: string }>
  children: string
}) {
  const Icon = ok ? On : Off
  return (
    <span
      title={children}
      className={cn(
        "flex size-6 items-center justify-center rounded-full",
        ok ? "bg-success/12 text-success" : "bg-destructive/10 text-destructive",
      )}
    >
      <Icon className="size-3.5" />
      <span className="sr-only">{children}</span>
    </span>
  )
}
