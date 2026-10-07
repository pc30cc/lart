import { randomUUID } from "node:crypto"
import { and, eq, TransactionRollbackError } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"

import { db, type Tx } from "@/db"
import { adminInvites, admins, auditLog } from "@/db/schema"
import { verifyPassword } from "@/lib/auth/password"
import { sha256 } from "@/lib/crypto"
import {
  acceptPartnerInvite,
  cancelPartnerInvite,
  createPartnerInvite,
  partnerInviteDetails,
  partnerSlots,
  renewPartnerInvite,
} from "./invites"
import { PARTNER_INVITE_TTL_MS } from "./limits"

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-real-ip": "198.51.100.4" }) }))

/**
 * Far in the future, so every invitation other test files leave in the shared
 * test database has expired by then and only active admins hold places.
 */
const NOW = new Date("2030-01-07T09:00:00Z")
const DAY = 86_400_000
const LATER = new Date(NOW.getTime() + PARTNER_INVITE_TTL_MS + DAY)
const PASSWORD = "a long and lovely partner password"
const tag = () => randomUUID().slice(0, 8)
const address = (what: string) => `partner-${what}-${tag()}@test.local`

/**
 * Run in a transaction that is rolled back, on one snapshot (repeatable read):
 * admins other test files add meanwhile do not change the counts. The limit is
 * then set relative to the snapshot (`room`).
 */
async function rolledBack(fn: (tx: Tx) => Promise<void>) {
  await db
    .transaction(
      async (tx) => {
        await fn(tx)
        tx.rollback()
      },
      { isolationLevel: "repeatable read" },
    )
    .catch((err) => {
      if (!(err instanceof TransactionRollbackError)) throw err
    })
}

/** A limit that leaves `free` places at `now` in this snapshot. */
async function room(tx: Tx, free: number, now = NOW) {
  const { active, invited } = await partnerSlots(tx, now)
  return active + invited + free
}

let inviter: { id: string; name: string }
beforeAll(async () => {
  // Inactive, so it takes no place in the shared test database.
  const [row] = await db
    .insert(admins)
    .values({ email: address("inviter"), name: "Mina Inviter", passwordHash: "x", active: false })
    .returning()
  inviter = row
})

const invite = (tx: Tx, email: string, max: number, now = NOW, name = "Leyla Ahmadi") =>
  createPartnerInvite({ name, email, locale: "fa" }, inviter.id, { exec: tx, now, max })

const inviteRow = async (tx: Tx, id: string) => (await tx.select().from(adminInvites).where(eq(adminInvites.id, id)))[0]
/**
 * The entries about one record. In one transaction every `at` is the same
 * (`now()` is the transaction's start), so the action name breaks the tie:
 * the tests below expect "admin.invite" before "admin.invite_resend"/"_cancel".
 */
const auditOf = (tx: Tx, entityId: string) =>
  tx.select().from(auditLog).where(eq(auditLog.entityId, entityId)).orderBy(auditLog.at, auditLog.action)

describe("createPartnerInvite", () => {
  it("stores only the token's SHA-256, for 7 days, and audits who was invited (never the token)", async () => {
    await rolledBack(async (tx) => {
      const email = address("Leyla").toUpperCase()
      const { id, token } = await invite(tx, `  ${email} `, await room(tx, 1))
      expect(token).toMatch(/^[\w-]{43}$/)

      const row = await inviteRow(tx, id)
      expect(row).toMatchObject({
        email: email.toLowerCase(),
        name: "Leyla Ahmadi",
        locale: "fa",
        tokenHash: sha256(token),
        invitedBy: inviter.id,
        expiresAt: new Date(NOW.getTime() + 7 * DAY),
      })
      const [entry] = await auditOf(tx, id)
      expect(entry).toMatchObject({
        adminId: inviter.id,
        action: "admin.invite",
        entity: "admin_invite",
        data: { name: "Leyla Ahmadi", email: email.toLowerCase(), locale: "fa" },
      })
      expect(JSON.stringify([row, entry])).not.toContain(token)

      expect(await partnerInviteDetails(token, { exec: tx, now: NOW })).toEqual({
        name: "Leyla Ahmadi",
        email: email.toLowerCase(),
        locale: "fa",
        inviterName: "Mina Inviter",
        expiresAt: row.expiresAt,
      })
      expect(await partnerInviteDetails(token, { exec: tx, now: LATER })).toBeNull()
      for (const wrong of ["not-the-token", "", undefined, "x".repeat(200)]) {
        expect(await partnerInviteDetails(wrong, { exec: tx, now: NOW })).toBeNull()
      }
    })
  })

  it("keeps to the limit: active partners and working invitations together; expired and cancelled ones free their place", async () => {
    await rolledBack(async (tx) => {
      const max = await room(tx, 1)
      const first = await invite(tx, address("first"), max)
      expect(await partnerSlots(tx, NOW, max)).toMatchObject({ invited: 1, free: 0 })
      // The open invitation is what holds the last place (the message then says to cancel one).
      await expect(invite(tx, address("second"), max)).rejects.toMatchObject({
        key: "partners.errors.limit",
        values: { max, invited: (await partnerSlots(tx, NOW, max)).invited },
      })

      // A week later the first invitation has expired: its place is free.
      expect(await partnerSlots(tx, LATER, max)).toMatchObject({ invited: 0, free: 1 })
      const second = await invite(tx, address("second"), max, LATER)
      await expect(invite(tx, address("third"), max, LATER)).rejects.toMatchObject({ key: "partners.errors.limit" })

      await cancelPartnerInvite(second.id, inviter.id, { exec: tx })
      await invite(tx, address("third"), max, LATER)
      expect(await inviteRow(tx, first.id)).toBeDefined() // expired invitations stay listed ("Send again")
    })
  })

  it("refuses an email that is an admin's (any letter case, active or not) or has a working invitation", async () => {
    await rolledBack(async (tx) => {
      const max = await room(tx, 5)
      const partner = address("Old-Partner")
      await tx.insert(admins).values({ email: partner, name: "Old Partner", passwordHash: "x", active: false })
      await expect(invite(tx, partner.toLowerCase(), max)).rejects.toMatchObject({
        key: "partners.errors.emailTaken",
        field: "email",
      })

      const email = address("twice")
      await invite(tx, email, max)
      await expect(invite(tx, email.toUpperCase(), max)).rejects.toMatchObject({
        key: "partners.errors.emailInvited",
        field: "email",
      })
    })
  })

  it("replaces an expired invitation of the same address", async () => {
    await rolledBack(async (tx) => {
      const max = await room(tx, 2)
      const email = address("again")
      const old = await invite(tx, email, max)
      const renewed = await invite(tx, email, max, LATER, "Leyla A.")
      const rows = await tx.select().from(adminInvites).where(eq(adminInvites.email, email))
      expect(rows.map((r) => [r.id, r.name])).toEqual([[renewed.id, "Leyla A."]])
      expect(await partnerInviteDetails(old.token, { exec: tx, now: NOW })).toBeNull()
    })
  })
})

describe("renewPartnerInvite", () => {
  it("gives a new link for 7 more days; the old link stops working", async () => {
    await rolledBack(async (tx) => {
      const max = await room(tx, 1)
      const email = address("resend")
      const { id, token } = await invite(tx, email, max)
      const then = new Date(NOW.getTime() + DAY)
      const renewed = await renewPartnerInvite(id, inviter.id, { exec: tx, now: then, max })
      expect(renewed).toEqual({
        token: expect.stringMatching(/^[\w-]{43}$/),
        email,
        name: "Leyla Ahmadi",
        locale: "fa",
        inviterName: "Mina Inviter",
      })
      expect(renewed.token).not.toBe(token)
      expect(await partnerInviteDetails(token, { exec: tx, now: then })).toBeNull()
      expect(await partnerInviteDetails(renewed.token, { exec: tx, now: then })).toMatchObject({
        email,
        expiresAt: new Date(then.getTime() + 7 * DAY),
      })
      const entries = await auditOf(tx, id)
      expect(entries.map((e) => e.action)).toEqual(["admin.invite", "admin.invite_resend"])
      expect(JSON.stringify(entries)).not.toContain(renewed.token)
    })
  })

  it("needs a free place again for an expired invitation", async () => {
    await rolledBack(async (tx) => {
      const max = await room(tx, 1)
      const expired = await invite(tx, address("expired"), max)
      const taker = await invite(tx, address("taker"), max, LATER) // the expired one's place was free
      await expect(renewPartnerInvite(expired.id, inviter.id, { exec: tx, now: LATER, max })).rejects.toMatchObject({
        key: "partners.errors.limit",
      })
      await cancelPartnerInvite(taker.id, inviter.id, { exec: tx })
      const renewed = await renewPartnerInvite(expired.id, inviter.id, { exec: tx, now: LATER, max })
      expect(await partnerInviteDetails(renewed.token, { exec: tx, now: LATER })).not.toBeNull()
    })
  })

  it("says how many working invitations hold places, so the message only asks to cancel one when there is one", async () => {
    await rolledBack(async (tx) => {
      const max = await room(tx, 1)
      const expired = await invite(tx, address("lapsed"), max)
      // A week later the team is full without any working invitation (someone joined another way).
      await tx.insert(admins).values({ email: address("joined"), name: "Joined", passwordHash: "x" })
      expect(await partnerSlots(tx, LATER, max)).toMatchObject({ invited: 0, free: 0 })
      const full = { key: "partners.errors.limit", values: { max, invited: 0 } }
      await expect(renewPartnerInvite(expired.id, inviter.id, { exec: tx, now: LATER, max })).rejects.toMatchObject(full)
      await expect(invite(tx, address("another"), max, LATER)).rejects.toMatchObject(full)
    })
  })

  it("answers not found for an invitation that is gone", async () => {
    await rolledBack(async (tx) => {
      await expect(renewPartnerInvite(randomUUID(), inviter.id, { exec: tx, now: NOW })).rejects.toMatchObject({
        key: "partners.errors.inviteNotFound",
      })
      await expect(cancelPartnerInvite(randomUUID(), inviter.id, { exec: tx })).rejects.toMatchObject({
        key: "partners.errors.inviteNotFound",
      })
    })
  })
})

describe("cancelPartnerInvite", () => {
  it("deletes the invitation, so its link stops working, and audits it", async () => {
    await rolledBack(async (tx) => {
      const email = address("cancel")
      const { id, token } = await invite(tx, email, await room(tx, 1))
      await cancelPartnerInvite(id, inviter.id, { exec: tx })
      expect(await inviteRow(tx, id)).toBeUndefined()
      expect(await partnerInviteDetails(token, { exec: tx, now: NOW })).toBeNull()
      const entries = await auditOf(tx, id)
      expect(entries.at(-1)).toMatchObject({
        adminId: inviter.id,
        action: "admin.invite_cancel",
        entity: "admin_invite",
        data: { name: "Leyla Ahmadi", email },
      })
    })
  })
})

describe("acceptPartnerInvite", () => {
  it("creates an active partner with a 0 % share and the chosen password; the link works once", async () => {
    await rolledBack(async (tx) => {
      const max = await room(tx, 1)
      const email = address("neda")
      const { id, token } = await invite(tx, email.toUpperCase(), max, NOW, "Neda Karimi")
      const before = await partnerSlots(tx, NOW, max)
      const then = new Date(NOW.getTime() + 2 * DAY)

      const { adminId } = await acceptPartnerInvite(token, PASSWORD, { exec: tx, now: then, max })
      const [admin] = await tx.select().from(admins).where(eq(admins.id, adminId))
      expect(admin).toMatchObject({ email, name: "Neda Karimi", shareBp: 0, active: true, photoPath: null })
      expect(await verifyPassword(admin.passwordHash, PASSWORD)).toBe(true)
      expect(await inviteRow(tx, id)).toBeUndefined()
      expect(await partnerSlots(tx, NOW, max)).toMatchObject({ active: before.active + 1, invited: before.invited - 1 })

      const [entry] = await tx
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, "admin.accept_invite"), eq(auditLog.entityId, adminId)))
      expect(entry).toMatchObject({
        adminId,
        entity: "admin",
        data: { name: "Neda Karimi", email, invitedBy: inviter.id },
      })
      expect(JSON.stringify(entry)).not.toContain(token)
      expect(JSON.stringify(entry)).not.toContain(PASSWORD)

      await expect(acceptPartnerInvite(token, PASSWORD, { exec: tx, now: then, max })).rejects.toMatchObject({
        key: "partners.accept.errors.invalidLink",
      })
    })
  })

  it("refuses an expired, unknown or malformed link", async () => {
    await rolledBack(async (tx) => {
      const max = await room(tx, 1)
      const { token } = await invite(tx, address("late"), max)
      for (const [wrong, now] of [
        [token, LATER],
        ["not-the-token", NOW],
        [undefined, NOW],
        ["x".repeat(200), NOW],
      ] as const) {
        await expect(acceptPartnerInvite(wrong, PASSWORD, { exec: tx, now, max })).rejects.toMatchObject({
          key: "partners.accept.errors.invalidLink",
        })
      }
    })
  })

  it("is refused when the partners filled up meanwhile; the invitation stays", async () => {
    await rolledBack(async (tx) => {
      const max = await room(tx, 1)
      const { id, token } = await invite(tx, address("full"), max)
      // Someone became a partner another way meanwhile (e.g. the setup command).
      await tx.insert(admins).values({ email: address("meanwhile"), name: "Meanwhile", passwordHash: "x" })
      await expect(acceptPartnerInvite(token, PASSWORD, { exec: tx, now: NOW, max })).rejects.toMatchObject({
        key: "partners.accept.errors.limit",
        values: { max },
      })
      expect(await inviteRow(tx, id)).toBeDefined()
    })
  })

  it("is refused when the email became an admin's meanwhile", async () => {
    await rolledBack(async (tx) => {
      const max = await room(tx, 2)
      const email = address("taken")
      const { token } = await invite(tx, email, max)
      await tx.insert(admins).values({ email: email.toUpperCase(), name: "Same Person", passwordHash: "x", active: false })
      await expect(acceptPartnerInvite(token, PASSWORD, { exec: tx, now: NOW, max })).rejects.toMatchObject({
        key: "partners.accept.errors.emailTaken",
      })
    })
  })
})
