"use client"

import { useTranslations } from "next-intl"
import { createContext, Fragment, useContext, useEffect, useState } from "react"

import { findNav } from "@/components/admin/nav"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Link, usePathname } from "@/i18n/navigation"

// The page title shown as the last breadcrumb on pages below a nav item.
const TitleContext = createContext<{ title: string | null; setTitle: (t: string | null) => void } | null>(null)

export function BreadcrumbTitleProvider({ children }: { children: React.ReactNode }) {
  const [title, setTitle] = useState<string | null>(null)
  return <TitleContext.Provider value={{ title, setTitle }}>{children}</TitleContext.Provider>
}

/** Rendered by PageHeader: publishes the page title to the header breadcrumbs. */
export function BreadcrumbTitle({ title }: { title: string }) {
  const setTitle = useContext(TitleContext)?.setTitle
  useEffect(() => {
    setTitle?.(title)
    return () => setTitle?.(null)
  }, [title, setTitle])
  return null
}

/**
 * Section › Page › Sub-page, derived from the nav registry and the current
 * path. The last crumb on deeper pages (new, edit, details) is the PageHeader
 * title. A page outside the navigation (My profile, from the user menu) shows
 * only its title.
 */
export function AdminBreadcrumbs() {
  const t = useTranslations("admin")
  const pathname = usePathname()
  const pageTitle = useContext(TitleContext)?.title ?? null
  const match = findNav(pathname)
  const crumbs: { label: string; href?: string }[] = []
  if (match) {
    const deeper = pathname !== match.item.href
    const groupLabel = t(`nav.${match.group.label}`)
    const itemLabel = t(`nav.${match.item.label}`)
    // Never "Workshops › Workshops": skip the group when it reads like its item.
    if (groupLabel !== itemLabel) crumbs.push({ label: groupLabel })
    crumbs.push({ label: itemLabel, href: deeper ? match.item.href : undefined })
    if (deeper && pageTitle) crumbs.push({ label: pageTitle })
  } else if (pageTitle) {
    crumbs.push({ label: pageTitle })
  }
  if (!crumbs.length) return null

  return (
    <Breadcrumb aria-label={t("shell.breadcrumb")} className="min-w-0">
      <BreadcrumbList className="flex-nowrap">
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1
          // On phones only the current page is shown.
          const hide = last ? "" : "hidden md:inline-flex"
          return (
            <Fragment key={i}>
              {i > 0 && <BreadcrumbSeparator className="hidden md:block" />}
              <BreadcrumbItem className={`${hide} min-w-0`}>
                {last ? (
                  <BreadcrumbPage className="truncate font-medium">{crumb.label}</BreadcrumbPage>
                ) : crumb.href ? (
                  <BreadcrumbLink asChild>
                    <Link href={crumb.href}>{crumb.label}</Link>
                  </BreadcrumbLink>
                ) : (
                  <span>{crumb.label}</span>
                )}
              </BreadcrumbItem>
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
