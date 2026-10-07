import { randomUUID } from "node:crypto"
import { and, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

import { db } from "@/db"
import { adminInvites, admins, auditLog, sessions } from "@/db/schema"
import { issueAdminResetToken, isAdminResetTokenValid } from "@/lib/auth/account"
import { sessionCookieName } from "@/lib/auth/cookies"
import { hashPassword, verifyPassword } from "@/lib/auth/password"
import { createSession } from "@/lib/auth/session"
import { sha256 } from "@/lib/crypto"
import { sendEmail } from "@/lib/email"
import { remove } from "@/lib/storage"
import {
  acceptPartnerInviteAction,
  cancelPartnerInvite,
  invitePartner,
  resendPartnerInvite,
  updateMyProfile,
} from "./actions"
import { partnerInviteDetails } from "./invites"

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl")
  const messages = {
    common: (await import("../../../messages/en/common.json")).default,
    auth: (await import("../../../messages/en/auth.json")).default,
    partners: (await import("../../../messages/en/partners.json")).default,
  }
  return {
    getTranslations: async (namespace?: string) => createTranslator({ locale: "en", messages, namespace: namespace as never }),
    getLocale: async () => "en",
  }
})

/** The request: cookies, and a fresh client IP per test (the invitation page is rate limited per network). */
const request = vi.hoisted(() => ({ cookies: new Map<string, string>(), ip: "198.51.100.1" }))
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": request.ip }),
  cookies: async () => ({
    get: (name: string) => (request.cookies.has(name) ? { name, value: request.cookies.get(name) } : undefined),
    set: (name: string, value: string) => request.cookies.set(name, value),
  }),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }))
/** Storage: the files these tests "uploaded"; removing one takes it away. */
const stored = vi.hoisted(() => new Set<string>())
vi.mock("@/lib/storage", async (original) => ({
  ...(await original<typeof import("@/lib/storage")>()),
  remove: vi.fn(async (path: string) => void stored.delete(path)),
  read: vi.fn(async (path: string) =>
    stored.has(path) ? { body: new ReadableStream<Uint8Array>(), size: 0, contentType: "image/webp" } : null,
  ),
}))
// The shared test database holds many active admins from other tests: lift the limit here
// (invites.test.ts checks it against a snapshot).
vi.mock("./limits", async (original) => ({ ...(await original<typeof import("./limits")>()), MAX_PARTNERS: 1_000_000 }))

/** The signed-in partner: a real row (the audit log and the invitations refer to it) and a real session row. */
const session = vi.hoisted(() => ({
  sessionId: "",
  admin: { id: "", email: "", name: "", shareBp: 0 },
}))
vi.mock("@/lib/auth/admin", () => ({ requireAdmin: async () => session, getAdmin: async () => session }))

const PASSWORD = "the partner's long password"
const NEW_PASSWORD = "a brand new partner password"
const tag = () => randomUUID().slice(0, 8)
const address = (what: string) => `pa-${what}-${tag()}@test.local`
let ipCount = 0
const created: string[] = []

/** A partner (inactive, so it takes no place in the shared test database), signed in on this device. */
async function signIn(name = "Mina Partner") {
  const [admin] = await db
    .insert(admins)
    .values({ email: address("me"), name, passwordHash: await hashPassword(PASSWORD), active: false })
    .returning()
  created.push(admin.id)
  const own = await createSession("admin", admin.id)
  session.sessionId = own.id
  session.admin = { id: admin.id, email: admin.email, name: admin.name, shareBp: 0 }
  return admin
}

const tokenOf = (url: string) => new URL(url).searchParams.get("token")!
const adminRow = async (id: string) => (await db.select().from(admins).where(eq(admins.id, id)))[0]
const auditOf = (entityId: string, action: string) =>
  db.select().from(auditLog).where(and(eq(auditLog.entityId, entityId), eq(auditLog.action, action)))
const redirectTo = (path: string) => ({ digest: expect.stringContaining(`;${path};`) })

async function invited(email = address("invitee"), name = "Leyla Ahmadi") {
  const result = await invitePartner({ name, email, locale: "en" })
  if (!result.ok) throw new Error(result.error)
  return { ...result.data, email, token: tokenOf(result.data.inviteUrl) }
}

beforeEach(async () => {
  request.cookies.clear()
  request.ip = `198.51.100.${++ipCount}`
  vi.mocked(sendEmail).mockClear()
  vi.mocked(remove).mockClear()
  vi.mocked(revalidatePath).mockClear()
  await signIn()
})

afterAll(async () => {
  // Open invitations of these tests go; partners created by accepting step aside (admins are never deleted).
  await db.delete(adminInvites).where(inArray(adminInvites.invitedBy, created))
  await db.update(admins).set({ active: false }).where(inArray(admins.id, created))
})

describe("invitePartner", () => {
  it("creates the invitation, emails the link in the chosen language and returns it once to copy", async () => {
    const email = address("leyla")
    const result = await invitePartner({ name: "  Leyla   Ahmadi ", email: ` ${email.toUpperCase()} `, locale: "fa" })
    expect(result).toEqual({
      ok: true,
      data: {
        id: expect.any(String),
        emailed: true,
        inviteUrl: expect.stringMatching(/^http:\/\/localhost:3000\/fa\/admin\/invite\?token=[\w-]{43}$/),
      },
    })
    if (!result.ok) return
    const token = tokenOf(result.data.inviteUrl)
    const [row] = await db.select().from(adminInvites).where(eq(adminInvites.id, result.data.id))
    expect(row).toMatchObject({ email, name: "Leyla Ahmadi", locale: "fa", tokenHash: sha256(token), invitedBy: session.admin.id })

    expect(sendEmail).toHaveBeenCalledExactlyOnceWith({
      to: email,
      template: "partner_invite",
      locale: "fa",
      props: { name: "Leyla Ahmadi", inviterName: "Mina Partner", acceptUrl: result.data.inviteUrl },
    })
    const entries = await auditOf(result.data.id, "admin.invite")
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ adminId: session.admin.id, entity: "admin_invite" })
    expect(JSON.stringify(entries)).not.toContain(token)
    expect(revalidatePath).toHaveBeenCalledWith("/[locale]/admin/money/partners", "page")
  })

  it("still gives the link to copy when the email could not be sent", async () => {
    vi.mocked(sendEmail).mockResolvedValueOnce({ ok: false, error: "no provider" })
    const result = await invitePartner({ name: "Leyla Ahmadi", email: address("nomail"), locale: "tr" })
    expect(result).toMatchObject({ ok: true, data: { emailed: false, inviteUrl: expect.stringMatching(/^http:\/\/localhost:3000\/admin\/invite\?token=/) } })
  })

  it("puts friendly messages on the fields: invalid input, an admin's email, an email already invited", async () => {
    expect(await invitePartner({ name: "L", email: "not an email", locale: "de" as "en" })).toMatchObject({
      ok: false,
      fieldErrors: { name: expect.any(String), email: expect.any(String), locale: expect.any(String) },
    })
    const other = await db
      .insert(admins)
      .values({ email: address("partner"), name: "Other Partner", passwordHash: "x", active: false })
      .returning()
    created.push(other[0].id)
    expect(await invitePartner({ name: "Other Partner", email: other[0].email.toUpperCase(), locale: "en" })).toEqual({
      ok: false,
      error: "There’s already a partner (admin) with this email.",
      fieldErrors: { email: "There’s already a partner (admin) with this email." },
    })

    const { email } = await invited()
    expect(await invitePartner({ name: "Leyla Again", email, locale: "en" })).toMatchObject({
      ok: false,
      fieldErrors: { email: "This email already has an open invitation. You can send it again from the list." },
    })
  })

  it("sends at most 10 invitations per partner per hour", async () => {
    for (let i = 0; i < 10; i++) await invited()
    expect(await invitePartner({ name: "One Too Many", email: address("many"), locale: "en" })).toEqual({
      ok: false,
      error: "You’ve sent a lot of invitations just now. Please wait a while, then try again.",
    })
  })
})

describe("resendPartnerInvite", () => {
  it("emails a new link and returns it once; the old link stops working", async () => {
    const first = await invited()
    vi.mocked(sendEmail).mockClear()
    const result = await resendPartnerInvite({ id: first.id })
    expect(result).toMatchObject({ ok: true, data: { id: first.id, emailed: true } })
    if (!result.ok) return
    const token = tokenOf(result.data.inviteUrl)
    expect(token).not.toBe(first.token)
    expect(await partnerInviteDetails(first.token)).toBeNull()
    expect(await partnerInviteDetails(token)).toMatchObject({ email: first.email, inviterName: "Mina Partner" })
    expect(sendEmail).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ to: first.email, template: "partner_invite", locale: "en", props: expect.objectContaining({ acceptUrl: result.data.inviteUrl }) }),
    )
    expect(await auditOf(first.id, "admin.invite_resend")).toHaveLength(1)
  })

  it("answers kindly for an invitation that is gone", async () => {
    expect(await resendPartnerInvite({ id: randomUUID() })).toEqual({
      ok: false,
      error: "This invitation no longer exists. It may have just been accepted or cancelled.",
    })
  })
})

describe("cancelPartnerInvite", () => {
  it("deletes the invitation: its link stops working", async () => {
    const { id, token } = await invited()
    expect(await cancelPartnerInvite({ id })).toEqual({ ok: true, data: { id } })
    expect(await partnerInviteDetails(token)).toBeNull()
    expect(await auditOf(id, "admin.invite_cancel")).toHaveLength(1)
    expect(await cancelPartnerInvite({ id })).toMatchObject({ ok: false })
  })
})

describe("acceptPartnerInviteAction", () => {
  it("creates the partner with a 0 % share, signs them in (ending another session here) and opens the panel", async () => {
    const { email, token } = await invited(address("neda"), "Neda Karimi")
    // The inviter tries the link in their own browser first.
    const inviterSession = await createSession("admin", session.admin.id)
    request.cookies.set(sessionCookieName("admin"), inviterSession.token)

    await expect(acceptPartnerInviteAction({ token, password: NEW_PASSWORD })).rejects.toMatchObject(
      redirectTo("/en/admin?notice=welcome"),
    )
    const [partner] = await db.select().from(admins).where(eq(admins.email, email))
    created.push(partner.id)
    expect(partner).toMatchObject({ name: "Neda Karimi", shareBp: 0, active: true })
    expect(await verifyPassword(partner.passwordHash, NEW_PASSWORD)).toBe(true)

    const cookie = request.cookies.get(sessionCookieName("admin"))!
    const [signedIn] = await db.select().from(sessions).where(eq(sessions.id, sha256(cookie)))
    expect(signedIn).toMatchObject({ kind: "admin", subjectId: partner.id })
    expect(await db.select().from(sessions).where(eq(sessions.id, inviterSession.id))).toEqual([])

    expect(await db.select().from(adminInvites).where(eq(adminInvites.email, email))).toEqual([])
    expect(await auditOf(partner.id, "admin.accept_invite")).toMatchObject([{ adminId: partner.id }])

    expect(await acceptPartnerInviteAction({ token, password: NEW_PASSWORD })).toEqual({
      ok: false,
      error:
        "This invitation link no longer works. If you have already joined, just sign in with your email and password. Otherwise, ask the partner who invited you to send a new link.",
    })
  })

  it("asks for a password as long as the admins' own", async () => {
    const { token } = await invited()
    expect(await acceptPartnerInviteAction({ token, password: "eleven char" })).toMatchObject({
      ok: false,
      fieldErrors: { password: "Please use at least 12 characters." },
    })
  })

  it("is rate limited per network", async () => {
    for (let i = 0; i < 10; i++) {
      expect(await acceptPartnerInviteAction({ token: "not-a-real-token", password: NEW_PASSWORD })).toMatchObject({ ok: false })
    }
    expect(await acceptPartnerInviteAction({ token: "not-a-real-token", password: NEW_PASSWORD })).toEqual({
      ok: false,
      error: "Too many tries from this device. Please wait a few minutes, then try again.",
    })
  })
})

describe("updateMyProfile", () => {
  const profile = () => ({ name: session.admin.name, email: session.admin.email, photoPath: null as string | null })

  it("saves the name, audits the changed fields and refreshes the panel's header", async () => {
    expect(await updateMyProfile({ ...profile(), name: "  Mina   Yılmaz " })).toEqual({ ok: true, data: { emailChanged: false } })
    expect((await adminRow(session.admin.id)).name).toBe("Mina Yılmaz")
    const entries = await auditOf(session.admin.id, "admin.profile_update")
    expect(entries).toMatchObject([
      { adminId: session.admin.id, entity: "admin", data: { fields: ["name"], name: { from: "Mina Partner", to: "Mina Yılmaz" } } },
    ])
    expect(revalidatePath).toHaveBeenCalledWith("/[locale]/admin", "layout")

    // Nothing changed: nothing written.
    expect(await updateMyProfile({ ...profile(), name: "Mina Yılmaz" })).toMatchObject({ ok: true })
    expect(await auditOf(session.admin.id, "admin.profile_update")).toHaveLength(1)
  })

  it("needs the current password for a new email", async () => {
    const email = address("new")
    expect(await updateMyProfile({ ...profile(), email })).toMatchObject({
      ok: false,
      fieldErrors: { currentPassword: "To change your email, please enter your current password." },
    })
    expect(await updateMyProfile({ ...profile(), email, currentPassword: "not my password" })).toMatchObject({
      ok: false,
      fieldErrors: { currentPassword: "That isn’t your current password." },
    })
    expect((await adminRow(session.admin.id)).email).toBe(session.admin.email)
  })

  it("changes the email with the password: lower-case, other devices signed out, reset links to the old address dropped", async () => {
    const other = await createSession("admin", session.admin.id)
    const resetToken = await issueAdminResetToken(session.admin.id)
    const email = address("moved")

    const result = await updateMyProfile({ ...profile(), email: email.toUpperCase(), currentPassword: PASSWORD })
    expect(result).toEqual({ ok: true, data: { emailChanged: true } })
    expect((await adminRow(session.admin.id)).email).toBe(email)

    const left = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.kind, "admin"), eq(sessions.subjectId, session.admin.id)))
    expect(left.map((s) => s.id)).toEqual([session.sessionId])
    expect(left.map((s) => s.id)).not.toContain(other.id)
    expect(await isAdminResetTokenValid(resetToken)).toBe(false)

    const entries = await auditOf(session.admin.id, "admin.profile_update")
    expect(entries).toMatchObject([{ data: { fields: ["email"] } }])
    expect(JSON.stringify(entries)).not.toContain(PASSWORD)
  })

  it("refuses an email of another admin (any letter case) or of an open invitation", async () => {
    const [other] = await db
      .insert(admins)
      .values({ email: address("other"), name: "Other Partner", passwordHash: "x", active: false })
      .returning()
    created.push(other.id)
    expect(await updateMyProfile({ ...profile(), email: other.email.toUpperCase(), currentPassword: PASSWORD })).toMatchObject({
      ok: false,
      fieldErrors: { email: "There’s already a partner (admin) with this email." },
    })
    // Worded for this page: there is no list of invitations to send it again from.
    const { email } = await invited()
    expect(await updateMyProfile({ ...profile(), email, currentPassword: PASSWORD })).toMatchObject({
      ok: false,
      fieldErrors: {
        email: "A partner invitation is open for this email. Please choose another email, or first cancel that invitation under Money → Partners.",
      },
    })
  })

  it("takes the email of an expired invitation, and that invitation goes (it could never be sent again)", async () => {
    const email = address("lapsed")
    const [lapsed] = await db
      .insert(adminInvites)
      .values({
        email,
        name: "Lapsed Invitee",
        locale: "en",
        tokenHash: sha256(randomUUID()),
        invitedBy: session.admin.id,
        expiresAt: new Date(Date.now() - 60_000),
      })
      .returning()
    expect(await updateMyProfile({ ...profile(), email, currentPassword: PASSWORD })).toEqual({
      ok: true,
      data: { emailChanged: true },
    })
    expect(await db.select().from(adminInvites).where(eq(adminInvites.id, lapsed.id))).toEqual([])
  })

  const photo = () => `partners/mina-partner/photo-${randomUUID().replace(/-/g, "").slice(0, 22)}.webp`
  /** An upload: the file in storage and the route's record of who uploaded it, for what. */
  async function uploaded(path: string, adminId: string, purpose = "admin_photo") {
    stored.add(path)
    await db
      .insert(auditLog)
      .values({ adminId, action: "media.upload", entity: "media", entityId: path, data: { purpose, width: 512, height: 512 } })
  }

  it("only takes a photo this partner uploaded as their photo, and removes the old file from storage", async () => {
    const me = session.admin.id
    const [someone] = await db
      .insert(admins)
      .values({ email: address("someone"), name: "Someone Else", passwordHash: "x", active: false })
      .returning()
    created.push(someone.id)

    const someoneElses = photo()
    await uploaded(someoneElses, someone.id)
    const notAPhoto = photo()
    await uploaded(notAPhoto, me, "course_cover")
    for (const path of [
      someoneElses,
      notAPhoto,
      photo(),
      "instructors/2026-10/abcdefghijklmnopqrstuv.webp",
      "admins/../x.webp",
      "partners/../brand/x.webp",
      "partners/mina/photo-x.png",
    ]) {
      expect(await updateMyProfile({ ...profile(), photoPath: path }), path).toMatchObject({
        ok: false,
        fieldErrors: { photoPath: "This photo couldn’t be saved. Please upload it again." },
      })
    }

    const first = photo()
    const second = photo()
    await uploaded(first, me)
    await uploaded(second, me)
    expect(await updateMyProfile({ ...profile(), photoPath: first })).toMatchObject({ ok: true })
    expect(remove).not.toHaveBeenCalled()
    expect(await updateMyProfile({ ...profile(), photoPath: second })).toMatchObject({ ok: true })
    expect(remove).toHaveBeenCalledExactlyOnceWith(first)
    expect((await adminRow(me)).photoPath).toBe(second)
    // Saving again with the same photo needs no new upload.
    expect(await updateMyProfile({ ...profile(), photoPath: second })).toMatchObject({ ok: true })

    expect(await updateMyProfile({ ...profile(), photoPath: null })).toMatchObject({ ok: true })
    expect(remove).toHaveBeenLastCalledWith(second)
    expect((await adminRow(me)).photoPath).toBeNull()
    const entries = await auditOf(me, "admin.profile_update")
    expect(entries.map((e) => (e.data as { fields: string[] }).fields)).toEqual([["photo"], ["photo"], ["photo"]])
  })

  it("keeps a photo saved before the named folders (admins/…) when the profile is saved again", async () => {
    const me = session.admin.id
    const old = `admins/2026-10/${randomUUID().replace(/-/g, "").slice(0, 22)}.webp`
    await db.update(admins).set({ photoPath: old }).where(eq(admins.id, me))
    expect(await updateMyProfile({ ...profile(), name: "Mina Earlier", photoPath: old })).toMatchObject({ ok: true })
    expect(await adminRow(me)).toMatchObject({ name: "Mina Earlier", photoPath: old })
    expect(remove).not.toHaveBeenCalled()
    await db.update(admins).set({ photoPath: null }).where(eq(admins.id, me))
  })

  it("does not take back a photo a save on another device already removed (that would remove the current one)", async () => {
    const me = session.admin.id
    const first = photo()
    const second = photo()
    await uploaded(first, me)
    await uploaded(second, me)
    // Device 1 opens the profile with the first photo; device 2 then saves the second one.
    expect(await updateMyProfile({ ...profile(), photoPath: first })).toMatchObject({ ok: true })
    expect(await updateMyProfile({ ...profile(), photoPath: second })).toMatchObject({ ok: true })
    expect(remove).toHaveBeenCalledExactlyOnceWith(first)

    // Device 1 changes only the name; its form still holds the first photo.
    expect(await updateMyProfile({ ...profile(), name: "Mina Elsewhere", photoPath: first })).toMatchObject({
      ok: false,
      fieldErrors: { photoPath: "This photo couldn’t be saved. Please upload it again." },
    })
    expect(remove).toHaveBeenCalledOnce()
    expect(await adminRow(me)).toMatchObject({ name: "Mina Partner", photoPath: second })
  })
})
