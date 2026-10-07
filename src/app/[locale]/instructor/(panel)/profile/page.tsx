import { LockIcon } from "lucide-react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"

import { getMyProfile } from "@/features/instructor-panel/queries"
import { getBrand } from "@/lib/settings"
import { cn } from "@/lib/utils"
import { LanguageChoice } from "../_components/language-choice"
import { LogoutButton } from "../_components/logout-button"
import { card, PageTitle } from "../_components/parts"
import { ProfileForm } from "../_components/profile-form"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("instructorPanel.profile")
  return { title: t("metaTitle") }
}

/**
 * My profile: the public part to edit (names, teaching field, introduction,
 * languages, website, photo), my language, and the private details used for
 * contracts, read-only (ID number masked): the team changes those.
 */
export default async function MyProfilePage({ params }: PageProps<"/[locale]/instructor/profile">) {
  const { locale } = await params
  const [profile, t, brand] = await Promise.all([getMyProfile(), getTranslations("instructorPanel.profile"), getBrand(locale)])
  if (!profile) notFound()

  return (
    <div className="space-y-12">
      <PageTitle title={t("title")} subtitle={t("subtitle")} />

      <ProfileForm
        profile={{
          displayName: profile.displayName,
          teachingField: profile.teachingField,
          bio: profile.bio,
          teachingLanguages: profile.teachingLanguages,
          website: profile.website,
          photoPath: profile.photoPath,
          photoUrl: profile.photoUrl,
        }}
      />

      <Block title={t("language.title")} description={t("language.description")} id="language-title">
        <LanguageChoice labelledBy="language-title" />
      </Block>

      <Block
        title={t("private.title")}
        description={
          <span className="flex gap-2">
            <LockIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {t("private.description", { brand })}
          </span>
        }
      >
        <dl className="divide-y">
          <Detail label={t("private.officialName")}>{profile.officialName}</Detail>
          <Detail label={t("private.idNumber")}>
            {profile.idNumberMasked ? (
              <bdi dir="ltr" className="font-mono tracking-wide">
                {profile.idNumberMasked}
              </bdi>
            ) : (
              "—"
            )}
          </Detail>
          <Detail label={t("private.mobile")}>
            <bdi dir="ltr">{profile.mobile}</bdi>
          </Detail>
          <Detail label={t("private.email")}>
            <bdi dir="ltr" className="break-all">
              {profile.email}
            </bdi>
            {!profile.emailVerified && (
              <span className="text-warning block text-xs">{t("private.emailUnverified")}</span>
            )}
          </Detail>
        </dl>
        <p className="text-muted-foreground text-sm text-pretty">{t("private.change", { brand })}</p>
      </Block>

      <div className="flex justify-center md:hidden">
        <LogoutButton />
      </div>
    </div>
  )
}

/** A titled group, laid out like the form's sections. */
function Block({
  title,
  description,
  id,
  children,
}: {
  title: string
  description: React.ReactNode
  id?: string
  children: React.ReactNode
}) {
  return (
    <section className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-8">
      <div className="space-y-1">
        <h2 id={id} className="text-base font-semibold">
          {title}
        </h2>
        <p className="text-muted-foreground text-sm text-pretty">{description}</p>
      </div>
      <div className={cn(card, "space-y-4 p-5 md:p-6")}>{children}</div>
    </section>
  )
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-3 first:pt-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="min-w-0 font-medium sm:text-end">{children}</dd>
    </div>
  )
}
