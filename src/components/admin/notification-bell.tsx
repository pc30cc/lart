"use client"

import { BanknoteIcon, BellIcon, FileUpIcon, LandmarkIcon, SendIcon, TicketIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { useCallback, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { listNotificationsAction, markNotificationsSeenAction } from "@/features/notifications/actions"
import type { AdminNotification } from "@/features/notifications/queries"
import { Link } from "@/i18n/navigation"
import { formatDateTime, isolate } from "@/lib/format"
import { cn } from "@/lib/utils"

/** How often the bell looks for new ones while the panel is open. */
const POLL_MS = 60_000

/**
 * The panel's bell: a red count of what came since it was last opened (a new
 * registration with how they will pay, a transfer receipt sent, a workshop
 * that went public, to send to the Telegram channel), the latest
 * ones in a list, each opening that workshop's registrations. Opening it
 * marks everything read.
 */
export function NotificationBell() {
  const t = useTranslations("admin.notifications")
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<{ unread: number; items: AdminNotification[] } | null>(null)

  const load = useCallback(
    () =>
      listNotificationsAction({})
        .then((result) => result.ok && setState(result.data))
        .catch(() => {}),
    [],
  )

  useEffect(() => {
    const first = setTimeout(load, 0)
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load()
    }, POLL_MS)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [load])

  async function toggle(next: boolean) {
    setOpen(next)
    if (!next) return
    const result = await listNotificationsAction({}).catch(() => null)
    if (!result?.ok) return
    setState(result.data)
    if (result.data.unread) {
      await markNotificationsSeenAction({}).catch(() => null)
      setState({ ...result.data, unread: 0 })
    }
  }

  const unread = state?.unread ?? 0
  return (
    <Popover open={open} onOpenChange={(next) => void toggle(next)}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="relative" aria-label={unread ? t("labelUnread", { count: unread }) : t("label")}>
          <BellIcon />
          {unread > 0 && (
            <span className="bg-destructive text-destructive-foreground absolute -top-0.5 -end-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold tabular-nums">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <p className="border-b px-4 py-3 text-sm font-semibold">{t("title")}</p>
        {!state?.items.length ? (
          <p className="text-muted-foreground px-4 py-8 text-center text-sm">{t("empty")}</p>
        ) : (
          <ul className="max-h-[60svh] divide-y overflow-y-auto">
            {state.items.map((n) => (
              <li key={n.id}>
                <Link
                  href={n.kind === "workshop" ? `/admin/workshops/${n.courseId}` : `/admin/workshops/${n.courseId}/registrations`}
                  onClick={() => setOpen(false)}
                  className="hover:bg-muted/60 focus-visible:bg-muted/60 flex gap-3 px-4 py-3 text-sm outline-none"
                >
                  <Icon n={n} />
                  <span className="min-w-0 space-y-0.5">
                    <span className="block leading-snug">
                      {n.kind === "workshop"
                        ? t("workshop")
                        : n.kind === "receipt"
                          ? t("receipt", { name: isolate(n.participantName) })
                          : t("registration", { name: isolate(n.participantName), way: n.paymentChoice ?? "none" })}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">{n.workshopTitle}</span>
                    <span className="text-muted-foreground flex flex-wrap gap-x-2 text-xs">
                      {formatDateTime(n.createdAt, locale, "medium")}
                      {n.paid && <span className="text-success">{n.kind === "workshop" ? t("posted") : t("paid")}</span>}
                      {n.cancelled && <span>{t("cancelled")}</span>}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}

function Icon({ n }: { n: AdminNotification }) {
  const Glyph = n.kind === "workshop" ? SendIcon : n.kind === "receipt" ? FileUpIcon : n.paymentChoice === "cash" ? BanknoteIcon : n.paymentChoice === "transfer" ? LandmarkIcon : TicketIcon
  return (
    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", n.kind === "receipt" ? "bg-success/12 text-success" : "bg-primary/10 text-primary")}>
      <Glyph className="size-4" aria-hidden />
    </span>
  )
}
