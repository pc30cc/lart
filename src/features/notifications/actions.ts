"use server"

import { getLocale } from "next-intl/server"
import { z } from "zod"

import { adminAction } from "@/lib/action"
import { listAdminNotifications, markNotificationsSeen } from "./queries"

const none = z.object({})

/** The bell's list and unread count (read every minute and when opened). */
export const listNotificationsAction = adminAction(none, async (_, ctx) => listAdminNotifications(ctx.admin.id, await getLocale()))

/** Opened: all read. Nothing to audit (it only moves the admin's own "seen" mark). */
export const markNotificationsSeenAction = adminAction(none, async (_, ctx) => {
  await markNotificationsSeen(ctx.admin.id)
})
