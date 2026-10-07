import { CircleCheckBigIcon, FileClockIcon, FileXIcon, PartyPopperIcon, ShieldAlertIcon } from "lucide-react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"

import { StatusBadge } from "@/components/admin/status-badge"
import { Button } from "@/components/ui/button"
import type { Locale } from "@/db/schema"
import { getMyContract } from "@/features/instructor-panel/queries"
import { panelStatus } from "@/features/instructor-panel/schema"
import { Link } from "@/i18n/navigation"
import { formatDate, formatDateTime, formatNumber, formatTimeRange, localized } from "@/lib/format"
import { getBrand } from "@/lib/settings"
import { cn } from "@/lib/utils"
// The same calm, printable document the admins see.
import { ContractDocument } from "../../../../admin/(panel)/workshops/_components/contract-document"
import { BackLink, contractTone, WorkshopStatus } from "../../_components/parts"
import { PrintButton } from "../../_components/print-button"
import { SignForm } from "../../_components/sign-form"

/** Print only the contract: A4, no panel around it. */
const printCss = `@media print {
  @page { size: A4; margin: 18mm 16mm; }
  html, body { background: #fff !important; }
}`

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("instructorPanel.contract")
  return { title: t("metaTitle") }
}

/**
 * One of my contracts: the full text in my language (the exact signed text
 * once signed), and, while it waits for me, the sign form under it. Another
 * instructor's contract (or a wrong id) is "not found".
 */
export default async function MyContractPage({ params, searchParams }: PageProps<"/[locale]/instructor/contracts/[id]">) {
  const [{ locale, id }, query] = await Promise.all([params, searchParams])
  const contract = await getMyContract(id, locale as Locale)
  if (!contract) notFound()
  const [t, tList, brand] = await Promise.all([
    getTranslations("instructorPanel.contract"),
    getTranslations("instructorPanel.contracts"),
    getBrand(locale),
  ])
  const { course, doc } = contract
  const title = localized(course.title, locale)
  const workshopStatus = panelStatus(course)
  const justSigned = query.signed === "1" && contract.state === "signed"
  // The signature line belongs to the document: in its language, not the panel's.
  const tDoc = doc ? await getTranslations({ locale: doc.locale, namespace: "instructorPanel.contract" }) : null

  return (
    <div className="space-y-6">
      <style>{printCss}</style>
      <BackLink href="/instructor/contracts" label={t("back")} />

      {justSigned && (
        <section
          role="status"
          className="bg-success/10 ring-success/25 animate-in fade-in-0 zoom-in-95 space-y-4 rounded-2xl p-6 text-center ring-1 duration-500 sm:p-8 print:hidden"
        >
          <span className="bg-success/15 text-success mx-auto flex size-14 items-center justify-center rounded-full">
            <PartyPopperIcon className="size-7" aria-hidden />
          </span>
          <div className="space-y-1.5">
            <h2 className="text-xl font-semibold text-balance">{t("signed.title")}</h2>
            <p className="text-muted-foreground mx-auto max-w-prose text-pretty">
              {t(`signed.workshop.${workshopStatus === "confirmed" ? "confirmed" : "open"}`, { title })}
            </p>
          </div>
          <div className="flex flex-col justify-center gap-2 sm:flex-row">
            <Button asChild className="h-12 rounded-xl px-5 text-base">
              <Link href={`/instructor/workshops/${course.id}`}>{t("signed.toWorkshop")}</Link>
            </Button>
            <PrintButton className="h-12" />
          </div>
        </section>
      )}

      <header className="space-y-3 print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={contractTone[contract.state]}>{tList(`state.${contract.state}`)}</StatusBadge>
          {contract.state === "signed" && <WorkshopStatus status={workshopStatus} />}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl rtl:tracking-normal">{title}</h1>
        <p className="text-muted-foreground">
          {tList("version", { version: formatNumber(contract.version, locale) })}
          <span aria-hidden> · </span>
          {formatDate(course.startsAt, locale, "full")}
          <span aria-hidden> · </span>
          <bdi>{formatTimeRange(course.startsAt, course.endsAt, locale)}</bdi>
        </p>
      </header>

      {contract.state === "toSign" && (
        <Notice icon={FileClockIcon} tone="info" title={t("toSign.title")}>
          {t("toSign.text")}
        </Notice>
      )}
      {contract.state === "signed" && contract.signedAt && !justSigned && (
        <Notice icon={CircleCheckBigIcon} tone="success" title={t("signedNotice.title")} action={doc?.text ? <PrintButton /> : null}>
          {t("signedNotice.text", { date: formatDateTime(contract.signedAt, locale, "long") })}
        </Notice>
      )}
      {contract.state === "replaced" && (
        <Notice
          icon={FileXIcon}
          tone="neutral"
          title={t("replaced.title")}
          action={
            contract.newerId && (
              <Button asChild className="h-11 rounded-xl px-4">
                <Link href={`/instructor/contracts/${contract.newerId}`}>{t("replaced.open")}</Link>
              </Button>
            )
          }
        >
          {t("replaced.text")}
        </Notice>
      )}
      {contract.state === "closed" && (
        <Notice icon={FileXIcon} tone="neutral" title={t("closed.title")}>
          {t("closed.text", { brand })}
        </Notice>
      )}
      {doc?.check && doc.check !== "ok" && doc.check !== "unencrypted" && (
        <Notice icon={ShieldAlertIcon} tone="danger" title={t("check.title")}>
          {t("check.text", { brand })}
        </Notice>
      )}

      {doc?.text && (
        <ContractDocument text={doc.text} locale={doc.locale}>
          {contract.state !== "toSign" && contract.signedAt && tDoc && (
            <footer className="mt-10 space-y-1 border-t pt-4 text-xs print:border-black/30">
              <p className="font-medium">
                {tDoc("signedLine", {
                  name: contract.signedName ?? "",
                  date: formatDateTime(contract.signedAt, doc.locale, "long"),
                })}
              </p>
            </footer>
          )}
        </ContractDocument>
      )}

      {contract.sign && doc && (
        <SignForm
          contractId={contract.id}
          locale={doc.locale}
          textSha256={contract.sign.textSha256}
          officialName={contract.sign.officialName}
        />
      )}
    </div>
  )
}

const noticeTone = {
  info: ["border-info/25 bg-info/8", "text-info"],
  success: ["border-success/25 bg-success/8", "text-success"],
  neutral: ["bg-muted/60", "text-muted-foreground"],
  danger: ["border-destructive/30 bg-destructive/8", "text-destructive"],
} as const

/** A short state message above the contract (not printed). */
function Notice({
  icon: Icon,
  tone,
  title,
  action,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  tone: keyof typeof noticeTone
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      className={cn("flex flex-col gap-4 rounded-2xl border p-4 sm:flex-row sm:items-center sm:p-5 print:hidden", noticeTone[tone][0])}
    >
      <div className="flex flex-1 gap-3">
        <Icon className={cn("mt-0.5 size-5 shrink-0", noticeTone[tone][1])} />
        <div className="space-y-1">
          <p className="font-medium">{title}</p>
          <p className="text-muted-foreground text-sm text-pretty">{children}</p>
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
