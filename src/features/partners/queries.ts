import "server-only"
import { asc, eq } from "drizzle-orm"

import { db } from "@/db"
import { adminInvites, admins } from "@/db/schema"
import type { AppLocale } from "@/i18n/routing"
import { requireAdmin } from "@/lib/auth/admin"
import { publicUrls } from "@/lib/storage"
import { partnerSlots } from "./invites"

/**
 * The partners page: invitations not accepted yet (oldest first, expired ones
 * too: "Send again" renews them) and the places left. `canInvite` is false
 * when active partners and working invitations already make `max`.
 */
export async function listPartnerInvites(now = new Date()) {
  await requireAdmin()
  const [rows, slots] = await Promise.all([
    db
      .select({
        id: adminInvites.id,
        name: adminInvites.name,
        email: adminInvites.email,
        locale: adminInvites.locale,
        invitedByName: admins.name,
        createdAt: adminInvites.createdAt,
        expiresAt: adminInvites.expiresAt,
      })
      .from(adminInvites)
      .innerJoin(admins, eq(admins.id, adminInvites.invitedBy))
      .orderBy(asc(adminInvites.createdAt), asc(adminInvites.id)),
    partnerSlots(db, now),
  ])
  return {
    invites: rows.map((r) => ({ ...r, locale: r.locale as AppLocale, expired: r.expiresAt <= now })),
    slots: { ...slots, canInvite: slots.free > 0 },
  }
}

export type PartnerInviteRow = Awaited<ReturnType<typeof listPartnerInvites>>["invites"][number]

/** My profile: name, email, photo and profit share (read-only here; Money → Partners changes shares). */
export async function getMyProfile() {
  const { admin } = await requireAdmin()
  const [[row], url] = await Promise.all([
    db
      .select({ id: admins.id, name: admins.name, email: admins.email, shareBp: admins.shareBp, photoPath: admins.photoPath })
      .from(admins)
      .where(eq(admins.id, admin.id))
      .limit(1),
    publicUrls(),
  ])
  return { ...row, photoUrl: url(row.photoPath) }
}

export type MyProfile = Awaited<ReturnType<typeof getMyProfile>>
