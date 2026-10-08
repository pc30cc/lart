"use client"

import {
  DatabaseIcon,
  HouseIcon,
  MailIcon,
  PaletteIcon,
  SlidersHorizontalIcon,
  StampIcon,
  WalletCardsIcon,
} from "lucide-react"
import { useTranslations } from "next-intl"

import { Link, usePathname } from "@/i18n/navigation"
import { cn } from "@/lib/utils"

const tabs = [
  { href: "/admin/settings", label: "general", icon: SlidersHorizontalIcon },
  { href: "/admin/settings/appearance", label: "appearance", icon: PaletteIcon },
  { href: "/admin/settings/home", label: "home", icon: HouseIcon },
  { href: "/admin/settings/payments", label: "payments", icon: WalletCardsIcon },
  { href: "/admin/settings/email", label: "email", icon: MailIcon },
  { href: "/admin/settings/storage", label: "storage", icon: DatabaseIcon },
  { href: "/admin/settings/watermark", label: "watermark", icon: StampIcon },
] as const

/** General · Appearance · Home page · Payments · Email · Storage · Watermark. */
export function SettingsNav() {
  const t = useTranslations("settings.tabs")
  const pathname = usePathname()

  return (
    <nav aria-label={t("label")} className="-mx-4 mb-6 overflow-x-auto px-4 md:mx-0 md:mb-8 md:px-0">
      <ul className="flex min-w-max gap-1 border-b">
        {tabs.map((tab) => {
          const current = pathname === tab.href
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "relative inline-flex h-10 items-center gap-2 px-3 text-sm font-medium transition-colors",
                  "after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:transition-colors",
                  current
                    ? "text-foreground after:bg-primary"
                    : "text-muted-foreground hover:text-foreground after:bg-transparent",
                )}
              >
                <tab.icon className="size-4 opacity-70" />
                {t(tab.label)}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
