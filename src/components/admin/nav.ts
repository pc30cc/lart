import {
  ActivityIcon,
  ArrowLeftRightIcon,
  BarChart3Icon,
  CalendarRangeIcon,
  FileTextIcon,
  GraduationCapIcon,
  HandCoinsIcon,
  HandshakeIcon,
  LayoutDashboardIcon,
  SettingsIcon,
  TagsIcon,
  TicketIcon,
  UsersRoundIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react"

/**
 * The super-admin navigation. Paths are without the locale prefix (the
 * next-intl `Link` adds it). Labels are keys under `admin.nav`.
 * Add a module here once; the sidebar and breadcrumbs pick it up.
 */
export type NavItem = {
  href: string
  label: string
  icon: LucideIcon
  /** Active only on this exact path (for items whose children are separate items). */
  exact?: boolean
}

export type NavGroup = { label: string; items: NavItem[] }

export const adminNav: NavGroup[] = [
  {
    label: "groups.overview",
    items: [{ href: "/admin", label: "dashboard", icon: LayoutDashboardIcon, exact: true }],
  },
  {
    label: "groups.workshops",
    items: [
      { href: "/admin/workshops", label: "workshops", icon: CalendarRangeIcon },
      { href: "/admin/registrations", label: "registrations", icon: TicketIcon },
      { href: "/admin/instructors", label: "instructors", icon: UsersRoundIcon },
      { href: "/admin/students", label: "students", icon: GraduationCapIcon },
      { href: "/admin/categories", label: "categories", icon: TagsIcon },
    ],
  },
  {
    label: "groups.money",
    items: [
      { href: "/admin/money", label: "wallet", icon: WalletIcon, exact: true },
      { href: "/admin/money/partners", label: "partners", icon: HandshakeIcon },
      { href: "/admin/money/transactions", label: "transactions", icon: ArrowLeftRightIcon },
      { href: "/admin/money/refunds", label: "refunds", icon: HandCoinsIcon },
      { href: "/admin/money/reports", label: "reports", icon: BarChart3Icon },
    ],
  },
  {
    label: "groups.system",
    items: [
      { href: "/admin/templates", label: "templates", icon: FileTextIcon },
      { href: "/admin/settings", label: "settings", icon: SettingsIcon },
      { href: "/admin/audit", label: "audit", icon: ActivityIcon },
    ],
  },
]

/** Is `item` the current page (or an ancestor of it)? `pathname` is without the locale. */
export function isNavActive(item: NavItem, pathname: string): boolean {
  if (item.exact) return pathname === item.href
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}

/**
 * The group and item for a path: the longest matching href wins. An `exact`
 * item is no parent (so "/admin/profile" belongs to no item, not to Dashboard).
 */
export function findNav(pathname: string): { group: NavGroup; item: NavItem } | null {
  let best: { group: NavGroup; item: NavItem } | null = null
  for (const group of adminNav) {
    for (const item of group.items) {
      const matches = isNavActive(item, pathname)
      if (matches && (!best || item.href.length > best.item.href.length)) best = { group, item }
    }
  }
  return best
}
