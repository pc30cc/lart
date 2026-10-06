import { ArrowLeftIcon } from "lucide-react"

import { BreadcrumbTitle } from "@/components/admin/breadcrumbs"
import { Link } from "@/i18n/navigation"
import { cn } from "@/lib/utils"

/**
 * The top of every admin page: title, one-line description and the page's
 * main actions (buttons). `back` adds a small link above the title on sub-pages.
 * The title also becomes the last breadcrumb on pages below a nav item.
 */
export function PageHeader({
  title,
  description,
  actions,
  back,
  className,
}: {
  title: string
  description?: React.ReactNode
  actions?: React.ReactNode
  back?: { href: string; label: string }
  className?: string
}) {
  return (
    <header className={cn("mb-6 flex flex-col gap-4 md:mb-8 md:flex-row md:items-end md:justify-between", className)}>
      <BreadcrumbTitle title={title} />
      <div className="min-w-0 space-y-1.5">
        {back && (
          <Link
            href={back.href}
            className="text-muted-foreground hover:text-foreground mb-2 inline-flex items-center gap-1.5 text-sm transition-colors"
          >
            <ArrowLeftIcon className="size-4 rtl:rotate-180" />
            {back.label}
          </Link>
        )}
        <h1 className="text-2xl font-semibold tracking-tight text-balance md:text-[1.75rem]">{title}</h1>
        {description && <p className="text-muted-foreground max-w-2xl text-sm text-pretty md:text-base">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}
