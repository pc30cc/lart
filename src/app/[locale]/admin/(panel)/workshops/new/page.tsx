import { CheckCircle2Icon, CircleDashedIcon } from "lucide-react"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { PageHeader } from "@/components/admin/page-header"
import { Button } from "@/components/ui/button"
import { getWorkshopFormOptions } from "@/features/workshops/queries"
import { Link } from "@/i18n/navigation"
import { requireAdmin } from "@/lib/auth/admin"
import { getSetting } from "@/lib/settings"
import { WorkshopForm } from "../_components/workshop-form"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("workshops")
  return { title: t("newTitle") }
}

export default async function NewWorkshopPage() {
  await requireAdmin()
  const [t, options, payment] = await Promise.all([
    getTranslations("workshops"),
    getWorkshopFormOptions(),
    getSetting("payment"),
  ])

  // A workshop needs a category, an instructor and the default contract text first.
  const steps = [
    { done: options.categories.length > 0, label: t("prerequisites.category"), href: "/admin/categories/new" },
    { done: options.instructors.length > 0, label: t("prerequisites.instructor"), href: "/admin/instructors" },
    { done: options.hasContractTemplate, label: t("prerequisites.contract"), href: "/admin/templates" },
  ]
  const ready = steps.every((s) => s.done)

  return (
    <>
      <PageHeader
        title={t("newTitle")}
        description={t("newDescription")}
        back={{ href: "/admin/workshops", label: t("backToList") }}
      />
      {ready ? (
        <WorkshopForm options={options} onlinePayment={payment.online.enabled} />
      ) : (
        <section className="bg-card ring-foreground/8 mx-auto max-w-xl space-y-5 rounded-2xl p-6 shadow-xs ring-1 md:p-8">
          <div className="space-y-1.5">
            <h2 className="text-lg font-semibold">{t("prerequisites.title")}</h2>
            <p className="text-muted-foreground text-sm text-pretty">{t("prerequisites.description")}</p>
          </div>
          <ol className="space-y-2">
            {steps.map((step) => (
              <li key={step.href} className="flex items-center gap-3 rounded-xl border px-4 py-3">
                {step.done ? (
                  <CheckCircle2Icon className="text-success size-5 shrink-0" aria-hidden />
                ) : (
                  <CircleDashedIcon className="text-muted-foreground size-5 shrink-0" aria-hidden />
                )}
                <span className={step.done ? "text-muted-foreground flex-1 text-sm line-through" : "flex-1 text-sm font-medium"}>
                  {step.label}
                  <span className="sr-only"> ({step.done ? t("prerequisites.done") : t("prerequisites.todo")})</span>
                </span>
                {!step.done && (
                  <Button asChild size="sm" variant="outline">
                    <Link href={step.href}>{t("prerequisites.go")}</Link>
                  </Button>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  )
}
