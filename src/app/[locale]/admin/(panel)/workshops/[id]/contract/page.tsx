import { FileClockIcon, FileXIcon, InfoIcon, LockOpenIcon, ShieldAlertIcon } from "lucide-react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getLocale, getTranslations } from "next-intl/server"
import { z } from "zod"

import { EmptyState } from "@/components/admin/empty-state"
import { StatusBadge, type StatusTone } from "@/components/admin/status-badge"
import type { Locale } from "@/db/schema"
import { getContractText, listContractVersions } from "@/features/contracts/queries"
import { getWorkshop } from "@/features/workshops/queries"
import { Link } from "@/i18n/navigation"
import { requireAdmin } from "@/lib/auth/admin"
import { formatDateTime, formatNumber, localized } from "@/lib/format"
import { cn } from "@/lib/utils"
import { ContractDocument } from "../../_components/contract-document"
import { PrintButton, ResendContractButton } from "../../_components/lifecycle-actions"
import { WorkshopHeader } from "../../_components/workshop-header"

const contractTone: Record<"sent" | "signed" | "void", StatusTone> = { sent: "warning", signed: "success", void: "neutral" }
const LOCALES: Locale[] = ["fa", "tr", "en"]

/** Print only the contract: hide the panel around it. */
const printCss = `@media print {
  @page { size: A4; margin: 18mm 16mm; }
  html, body { background: #fff !important; }
  [data-slot="sidebar"], [data-slot="sidebar-inset"] > header { display: none !important; }
  [data-slot="sidebar-wrapper"], [data-slot="sidebar-inset"] { display: block !important; margin: 0 !important; min-height: 0 !important; background: #fff !important; box-shadow: none !important; }
  #content { max-width: none !important; padding: 0 !important; animation: none !important; }
}`

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/workshops/[id]/contract">): Promise<Metadata> {
  const { id } = await params
  if (!z.uuid().safeParse(id).success) return {}
  const [workshop, t, locale] = await Promise.all([getWorkshop(id), getTranslations("workshops"), getLocale()])
  return workshop ? { title: t("contractPage.metaTitle", { title: localized(workshop.title, locale) }) } : {}
}

export default async function WorkshopContractPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/workshops/[id]/contract">) {
  await requireAdmin()
  const [{ id }, sp] = await Promise.all([params, searchParams])
  if (!z.uuid().safeParse(id).success) notFound()
  const [workshop, versions, t, locale] = await Promise.all([
    getWorkshop(id),
    listContractVersions(id),
    getTranslations("workshops"),
    getLocale(),
  ])
  if (!workshop) notFound()

  const current = versions.findLast((v) => v.status !== "void") ?? versions.at(-1)
  const asked = Number(sp.version)
  const selected = versions.find((v) => v.version === asked) ?? current
  const lang = LOCALES.find((l) => l === sp.lang) ?? (locale as Locale)
  const doc = selected && (selected.hasText || selected.status === "sent") ? await getContractText(selected.id, lang) : null
  // The signature line belongs to the document: in its language, not the panel's.
  const tDoc = doc ? await getTranslations({ locale: doc.locale, namespace: "workshops.contractPage" }) : null
  // A signed text that can't be decrypted has nothing to show or print (`checkSignedText`).
  const readable = doc && doc.check !== "unreadable"
  const n = (v: number) => formatNumber(v, locale)
  const href = (query: Record<string, string>) => ({ pathname: `/admin/workshops/${id}/contract`, query })

  return (
    <>
      <style>{printCss}</style>
      <WorkshopHeader
        workshop={workshop}
        active="contract"
        actions={
          <>
            {current?.status === "sent" && <ResendContractButton courseId={id} />}
            {readable && <PrintButton />}
          </>
        }
      />

      {!selected ? (
        <EmptyState icon={FileXIcon} title={t("contractPage.none.title")} description={t("contractPage.none.description")} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
          <div className="min-w-0 space-y-3">
            {doc && !doc.signed && (
              <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
                <p className="text-muted-foreground flex items-center gap-2 text-sm">
                  <FileClockIcon className="size-4 shrink-0" />
                  {t("contractPage.preview")}
                </p>
                <nav aria-label={t("contractPage.language")} className="bg-muted/60 flex gap-0.5 rounded-lg p-0.5">
                  {LOCALES.map((l) => (
                    <Link
                      key={l}
                      href={href({ version: String(selected.version), lang: l })}
                      aria-current={l === lang ? "true" : undefined}
                      lang={l}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                        l === lang ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {t(`contractPage.languages.${l}`)}
                    </Link>
                  ))}
                </nav>
              </div>
            )}
            {doc?.check && doc.check !== "ok" && (
              <CheckNotice tone={doc.check === "unencrypted" ? "warning" : "danger"} title={t(`contractPage.check.${doc.check}.title`)}>
                {t(`contractPage.check.${doc.check}.description`)}
              </CheckNotice>
            )}
            {readable ? (
              <ContractDocument text={doc.text} locale={doc.locale}>
                {selected.signedAt && tDoc && (
                  <footer className="mt-10 space-y-1 border-t pt-4 text-xs print:border-black/30">
                    <p className="font-medium">
                      {tDoc("signedLine", {
                        name: selected.signedName ?? "",
                        date: formatDateTime(selected.signedAt, doc.locale, "long"),
                      })}
                    </p>
                    <p className="text-muted-foreground font-mono break-all print:text-black/70" dir="ltr">
                      SHA-256 {selected.signedTextSha256}
                    </p>
                  </footer>
                )}
              </ContractDocument>
            ) : (
              !doc && (
                <EmptyState
                  icon={FileXIcon}
                  title={t("contractPage.noText.title")}
                  description={t("contractPage.noText.description")}
                />
              )
            )}
          </div>

          <aside className="min-w-0 space-y-6 print:hidden">
            <section className="bg-card ring-foreground/8 space-y-4 rounded-xl p-5 shadow-xs ring-1">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold">{t("contractPage.version", { version: n(selected.version) })}</h2>
                <StatusBadge tone={contractTone[selected.status]}>{t(`contractStatus.${selected.status}`)}</StatusBadge>
              </div>
              <dl className="space-y-3 text-sm">
                <Row label={t("contractPage.sentAt")}>{formatDateTime(selected.sentAt, locale, "medium")}</Row>
                {selected.signedAt && (
                  <>
                    <Row label={t("contractPage.signedAt")}>{formatDateTime(selected.signedAt, locale, "medium")}</Row>
                    <Row label={t("contractPage.signedName")}>{selected.signedName}</Row>
                    {selected.signedLocale && (
                      <Row label={t("contractPage.signedLanguage")}>
                        {t(`contractPage.languages.${selected.signedLocale as Locale}`)}
                      </Row>
                    )}
                    {selected.signedIp && (
                      <Row label={t("contractPage.signedIp")}>
                        <bdi dir="ltr" className="font-mono text-xs">
                          {selected.signedIp}
                        </bdi>
                      </Row>
                    )}
                    {selected.signedUserAgent && (
                      <Row label={t("contractPage.signedDevice")}>
                        <span dir="ltr" className="text-muted-foreground block text-xs break-words">
                          {selected.signedUserAgent}
                        </span>
                      </Row>
                    )}
                  </>
                )}
                {selected.voidedAt && (
                  <Row label={t("contractPage.voidedAt")}>{formatDateTime(selected.voidedAt, locale, "medium")}</Row>
                )}
              </dl>
              {selected.signedTextSha256 && (
                <div className="space-y-1">
                  <p className="text-muted-foreground text-xs">{t("contractPage.fingerprint")}</p>
                  <p dir="ltr" className="bg-muted rounded-md px-2 py-1.5 font-mono text-[0.7rem] break-all">
                    {selected.signedTextSha256}
                  </p>
                </div>
              )}
            </section>

            {versions.length > 1 && (
              <section className="bg-card ring-foreground/8 rounded-xl p-5 shadow-xs ring-1">
                <h2 className="mb-3 font-semibold">{t("contractPage.history")}</h2>
                <ol className="space-y-1">
                  {[...versions].reverse().map((v) => (
                    <li key={v.id}>
                      <Link
                        href={href({ version: String(v.version) })}
                        aria-current={v.id === selected.id ? "true" : undefined}
                        className={cn(
                          "flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors",
                          v.id === selected.id ? "bg-muted" : "hover:bg-muted/60",
                        )}
                      >
                        <span className="min-w-0">
                          <span className="block font-medium">{t("contractPage.version", { version: n(v.version) })}</span>
                          <span className="text-muted-foreground block text-xs">
                            {formatDateTime(v.signedAt ?? v.sentAt, locale, "medium")}
                          </span>
                        </span>
                        <StatusBadge tone={contractTone[v.status]}>{t(`contractStatus.${v.status}`)}</StatusBadge>
                      </Link>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            <p className="text-muted-foreground flex gap-2 px-1 text-xs text-pretty">
              <InfoIcon className="mt-px size-3.5 shrink-0" />
              {t("contractPage.howToChange")}
            </p>
          </aside>
        </div>
      )}
    </>
  )
}

/** Why a signed text can't be shown as proven (danger, also printed) or is not encrypted yet (warning, screen only). */
function CheckNotice({ tone, title, children }: { tone: "danger" | "warning"; title: string; children: React.ReactNode }) {
  const Icon = tone === "danger" ? ShieldAlertIcon : LockOpenIcon
  return (
    <div
      role="alert"
      className={cn(
        "flex gap-3 rounded-xl border p-4 text-sm",
        tone === "danger" ? "border-destructive/30 bg-destructive/8" : "border-warning/30 bg-warning/8 print:hidden",
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", tone === "danger" ? "text-destructive" : "text-warning")} />
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        <p className="text-muted-foreground text-pretty">{children}</p>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="min-w-0 text-end">{children}</dd>
    </div>
  )
}
