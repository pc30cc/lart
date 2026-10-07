"use client"

import { PanelLeftIcon, PanelRightIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"

import { AdminBreadcrumbs, BreadcrumbTitleProvider } from "@/components/admin/breadcrumbs"
import { adminNav, isNavActive } from "@/components/admin/nav"
import { UserMenu } from "@/components/admin/user-menu"
import { LocaleSwitcher } from "@/components/locale-switcher"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar"
import { Link, usePathname } from "@/i18n/navigation"
import { isRtl } from "@/i18n/routing"
import { cn } from "@/lib/utils"

/** The signed-in partner in the header: `photoUrl` from `adminPhotoUrl()`, null for initials. */
export type ShellAdmin = { name: string; email: string; photoUrl: string | null }

// In RTL the sidebar sits on the right, so the inset's margins mirror.
const insetRtl =
  "md:peer-data-[variant=inset]:ml-2 md:peer-data-[variant=inset]:mr-0 md:peer-data-[variant=inset]:peer-data-[state=collapsed]:mr-2"

/** The super-admin frame: collapsible sidebar (right side in Persian), header, content. */
export function AppShell({
  brand,
  admin,
  defaultOpen,
  children,
}: {
  brand: string
  admin: ShellAdmin
  defaultOpen: boolean
  children: React.ReactNode
}) {
  const t = useTranslations("admin.shell")
  const rtl = isRtl(useLocale())
  const pathname = usePathname()

  return (
    <BreadcrumbTitleProvider>
      <SidebarProvider defaultOpen={defaultOpen}>
        <a
          href="#content"
          className="bg-background focus:ring-ring sr-only z-50 rounded-md px-3 py-2 text-sm focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:ring-2"
        >
          {t("skipToContent")}
        </a>
        <AdminSidebar brand={brand} side={rtl ? "right" : "left"} />
        <SidebarInset className={cn("min-w-0", rtl && insetRtl)}>
          <header className="bg-background/85 supports-backdrop-filter:backdrop-blur-md sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b px-3 md:rounded-t-xl md:px-5">
            <SidebarToggle rtl={rtl} label={t("toggleSidebar")} />
            <Separator orientation="vertical" className="me-1 data-vertical:h-4 data-vertical:self-center" />
            <AdminBreadcrumbs />
            <div className="ms-auto flex items-center gap-0.5">
              <LocaleSwitcher />
              <ThemeToggle />
              <UserMenu admin={admin} />
            </div>
          </header>
          <div
            id="content"
            key={pathname}
            className="animate-in fade-in-0 slide-in-from-bottom-1 mx-auto w-full max-w-6xl flex-1 px-4 py-6 duration-300 md:px-8 md:py-8"
          >
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </BreadcrumbTitleProvider>
  )
}

function SidebarToggle({ rtl, label }: { rtl: boolean; label: string }) {
  const { toggleSidebar } = useSidebar()
  const Icon = rtl ? PanelRightIcon : PanelLeftIcon
  return (
    <Button variant="ghost" size="icon-sm" onClick={toggleSidebar} aria-label={label} className="-ms-1">
      <Icon />
    </Button>
  )
}

function AdminSidebar({ brand, side }: { brand: string; side: "left" | "right" }) {
  const t = useTranslations("admin")
  const pathname = usePathname()
  const { isMobile, setOpenMobile } = useSidebar()
  const close = () => isMobile && setOpenMobile(false)

  return (
    <Sidebar side={side} variant="inset" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild className="text-start">
              <Link href="/admin" onClick={close}>
                <span className="from-primary to-chart-5 text-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg bg-linear-to-br text-sm font-bold shadow-sm">
                  {brand.trim().charAt(0).toUpperCase()}
                </span>
                <span className="grid flex-1 leading-tight">
                  <span className="truncate font-semibold">{brand}</span>
                  <span className="text-muted-foreground truncate text-xs">{t("brandSubtitle")}</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {adminNav.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{t(`nav.${group.label}`)}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {group.items.map((item) => {
                  const label = t(`nav.${item.label}`)
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={isNavActive(item, pathname)}
                        tooltip={{ children: label, side: side === "left" ? "right" : "left" }}
                        className="data-active:[&>svg]:text-sidebar-primary text-start"
                      >
                        <Link href={item.href} onClick={close}>
                          <item.icon />
                          <span>{label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  )
}
