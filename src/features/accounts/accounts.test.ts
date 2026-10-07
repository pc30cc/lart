import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { db } from "@/db"
import { emailTokens, instructors, members, sessions } from "@/db/schema"
import { encrypt, sha256 } from "@/lib/crypto"
import { sendEmail } from "@/lib/email"
import { verifyCredentials } from "@/lib/auth/login"
import { hashPassword, verifyPassword } from "@/lib/auth/password"
import { createSession } from "@/lib/auth/session"
import { issueEmailToken, TOKEN_TTL } from "@/lib/auth/tokens"
import {
  acceptInvite,
  inviteDetails,
  isResetLinkValid,
  resetPassword,
  sendMemberExists,
  sendResetLink,
  sendVerifyLink,
  setMemberLocale,
  signUpMember,
  verifyEmail,
} from "./accounts"

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }))

const PASSWORD = "a long and lovely password"
const NEW = "a brand new password"
const INVITE_TTL = 7 * 24 * 3_600_000
let passwordHash: string

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD)
})
beforeEach(() => vi.mocked(sendEmail).mockClear())

const email = (what: string) => `acc-${what}-${randomUUID().slice(0, 8)}@test.local`

async function newMember(values: Partial<typeof members.$inferInsert> = {}) {
  const [row] = await db
    .insert(members)
    .values({ email: email("member"), name: "Ayşe Demir", passwordHash, locale: "fa", ...values })
    .returning()
  return row
}

async function newInstructor(values: Partial<typeof instructors.$inferInsert> = {}) {
  const [row] = await db
    .insert(instructors)
    .values({
      email: email("instructor"),
      officialName: "Zeynep Yılmaz",
      idNumberEnc: encrypt("12345678901"),
      mobile: "+90 555 000 00 00",
      displayName: { tr: "Zeynep Hoca", en: "Zeynep", fa: "زینب" },
      teachingField: { tr: "Mum" },
      locale: "tr",
      ...values,
    })
    .returning()
  return row
}

const member = async (id: string) => (await db.select().from(members).where(eq(members.id, id)))[0]
const instructor = async (id: string) => (await db.select().from(instructors).where(eq(instructors.id, id)))[0]
const sessionsOf = (kind: "member" | "instructor", id: string) =>
  db.select().from(sessions).where(and(eq(sessions.kind, kind), eq(sessions.subjectId, id)))
type SentEmail = { to: string; template: string; locale: string; props: Record<string, string> }
const lastEmail = () => vi.mocked(sendEmail).mock.calls.at(-1)?.[0] as unknown as SentEmail
const tokenOf = (url: string) => new URL(url, "http://x").searchParams.get("token")!

describe("signUpMember", () => {
  it("creates the account with a lower-case email, a hashed password, no empty phone and the page's language", async () => {
    const address = email("signup")
    const id = await signUpMember({ name: "Ayşe", email: `  ${address.toUpperCase()} `, password: PASSWORD, phone: "", locale: "en" })
    expect(id).toBeTruthy()
    const row = await member(id!)
    expect(row).toMatchObject({ email: address, name: "Ayşe", phone: null, locale: "en", emailVerifiedAt: null })
    expect(row.passwordHash).not.toContain(PASSWORD)
    expect(await verifyPassword(row.passwordHash, PASSWORD)).toBe(true)
  })

  it("changes nothing when the email already has an account", async () => {
    const existing = await newMember()
    expect(await signUpMember({ name: "Someone Else", email: existing.email, password: NEW, phone: "+905321234567", locale: "tr" })).toBeNull()
    expect(await member(existing.id)).toEqual(existing)
  })
})

describe("sendMemberExists", () => {
  it("tells the existing member, in the page's language, how to log in or reset", async () => {
    const m = await newMember()
    expect(await sendMemberExists(m.email.toUpperCase(), "tr")).toBe(true)
    expect(lastEmail()).toMatchObject({
      to: m.email,
      template: "member_exists",
      locale: "tr",
      props: { name: "Ayşe Demir", loginUrl: "/account/login", resetUrl: "/account/forgot" },
    })
  })

  it("sends nothing for an unknown address", async () => {
    expect(await sendMemberExists(email("nobody"), "tr")).toBe(false)
    expect(sendEmail).not.toHaveBeenCalled()
  })
})

describe("verify links", () => {
  it("emails a member a 24-hour link to the site's verify page, in the member's language", async () => {
    const m = await newMember()
    const now = Date.now()
    expect(await sendVerifyLink("member", m.id)).toBe("sent")
    const sent = lastEmail()
    expect(sent).toMatchObject({ to: m.email, template: "welcome_verify", locale: "fa", props: { name: "Ayşe Demir" } })
    expect(sent.props.verifyUrl).toMatch(/^\/fa\/account\/verify\?token=[\w-]{43}$/)
    const [row] = await db.select().from(emailTokens).where(eq(emailTokens.id, sha256(tokenOf(sent.props.verifyUrl))))
    expect(row).toMatchObject({ kind: "member", purpose: "verify_email", subjectId: m.id, usedAt: null })
    expect(row.expiresAt.getTime() - now).toBeGreaterThan(TOKEN_TTL.verify_email - 60_000)
    expect(row.expiresAt.getTime() - now).toBeLessThanOrEqual(TOKEN_TTL.verify_email + 1000)
  })

  it("sends an instructor to the panel's verify page, and nothing to a deactivated one", async () => {
    const i = await newInstructor()
    expect(await sendVerifyLink("instructor", i.id)).toBe("sent")
    expect(lastEmail().props.verifyUrl).toMatch(/^\/instructor\/verify\?token=/)
    expect(lastEmail().props.name).toBe("Zeynep Hoca")
    const off = await newInstructor({ active: false })
    expect(await sendVerifyLink("instructor", off.id)).toBe("failed")
  })

  it("does not send when the email is already confirmed", async () => {
    const m = await newMember({ emailVerifiedAt: new Date() })
    expect(await sendVerifyLink("member", m.id)).toBe("verified")
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("confirms the email once; opening it again still says it is confirmed", async () => {
    const m = await newMember()
    await sendVerifyLink("member", m.id)
    const token = tokenOf(lastEmail().props.verifyUrl)
    expect(await verifyEmail("member", token)).toBe(m.id)
    const verifiedAt = (await member(m.id)).emailVerifiedAt
    expect(verifiedAt).toBeInstanceOf(Date)
    expect(await verifyEmail("member", token)).toBe(m.id)
    expect((await member(m.id)).emailVerifiedAt).toEqual(verifiedAt)
  })

  it("refuses an old, expired, other-kind or made-up link", async () => {
    const m = await newMember()
    const old = await issueEmailToken("member", "verify_email", m.id, TOKEN_TTL.verify_email)
    const newer = await issueEmailToken("member", "verify_email", m.id, TOKEN_TTL.verify_email)
    expect(await verifyEmail("member", old)).toBeNull() // only the newest link works
    expect(await verifyEmail("instructor", newer)).toBeNull()
    expect(await verifyEmail("member", "made-up")).toBeNull()
    expect(await verifyEmail("member", { token: newer })).toBeNull()
    const expired = await issueEmailToken("member", "verify_email", m.id, 1000, { now: new Date(Date.now() - 60_000) })
    expect(await verifyEmail("member", expired)).toBeNull()
    expect((await member(m.id)).emailVerifiedAt).toBeNull()
  })
})

describe("password reset", () => {
  it("emails a 30-minute link in the page's language, and nothing for an unknown address", async () => {
    const m = await newMember()
    expect(await sendResetLink("member", m.email, "en")).toBe(true)
    expect(lastEmail()).toMatchObject({ to: m.email, template: "password_reset", locale: "en" })
    const url = lastEmail().props.resetUrl
    expect(url).toMatch(/^\/en\/account\/reset\?token=/)
    expect(await isResetLinkValid("member", tokenOf(url))).toBe(true)
    expect(await isResetLinkValid("instructor", tokenOf(url))).toBe(false)

    vi.mocked(sendEmail).mockClear()
    expect(await sendResetLink("member", email("nobody"), "en")).toBe(false)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("sets the new password once, clears the lockout, confirms the email and ends every session", async () => {
    const m = await newMember({ failedLogins: 5, lockedUntil: new Date(Date.now() + 600_000) })
    await createSession("member", m.id)
    await sendResetLink("member", m.email, "tr")
    const token = tokenOf(lastEmail().props.resetUrl)

    expect(await resetPassword("member", token, NEW)).toBe(m.id)
    const row = await member(m.id)
    expect(await verifyPassword(row.passwordHash, NEW)).toBe(true)
    expect(row).toMatchObject({ failedLogins: 0, lockedUntil: null })
    expect(row.emailVerifiedAt).toBeInstanceOf(Date)
    expect(await sessionsOf("member", m.id)).toHaveLength(0)

    expect(await resetPassword("member", token, "yet another password")).toBeNull()
    expect(await isResetLinkValid("member", token)).toBe(false)
  })

  it("refuses an expired link", async () => {
    const m = await newMember()
    const token = await issueEmailToken("member", "reset_password", m.id, TOKEN_TTL.reset_password, {
      now: new Date(Date.now() - TOKEN_TTL.reset_password - 1000),
    })
    expect(await isResetLinkValid("member", token)).toBe(false)
    expect(await resetPassword("member", token, NEW)).toBeNull()
  })

  it("works for instructors (their own page), never for deactivated ones", async () => {
    const i = await newInstructor({ passwordHash })
    expect(await sendResetLink("instructor", i.email.toUpperCase(), "fa")).toBe(true)
    const url = lastEmail().props.resetUrl
    expect(url).toMatch(/^\/fa\/instructor\/reset\?token=/)
    expect(lastEmail().props.name).toBe("زینب")

    await db.update(instructors).set({ active: false }).where(eq(instructors.id, i.id))
    expect(await isResetLinkValid("instructor", tokenOf(url))).toBe(false)
    expect(await resetPassword("instructor", tokenOf(url), NEW)).toBeNull()
    vi.mocked(sendEmail).mockClear()
    expect(await sendResetLink("instructor", i.email, "fa")).toBe(false)
    expect(sendEmail).not.toHaveBeenCalled()
  })
})

describe("instructor invitation", () => {
  it("greets the instructor, then sets the password, confirms the email and uses the link, all at once", async () => {
    const i = await newInstructor()
    const other = await issueEmailToken("instructor", "reset_password", i.id, TOKEN_TTL.reset_password)
    await createSession("instructor", i.id)
    const token = await issueEmailToken("instructor", "invite", i.id, INVITE_TTL)

    expect(await inviteDetails(token, "en")).toEqual({ name: "Zeynep", email: i.email })
    expect(await acceptInvite(token, NEW, "fa")).toBe(i.id)

    const row = await instructor(i.id)
    expect(row.locale).toBe("fa") // the invitation page's language: their emails and panel
    expect(await verifyPassword(row.passwordHash!, NEW)).toBe(true)
    expect(row.emailVerifiedAt).toBeInstanceOf(Date)
    const [used] = await db.select().from(emailTokens).where(eq(emailTokens.id, sha256(token)))
    expect(used.usedAt).toBeInstanceOf(Date)
    expect(await isResetLinkValid("instructor", other)).toBe(false) // other open links are dropped
    expect(await sessionsOf("instructor", i.id)).toHaveLength(0)
    expect(await verifyCredentials("instructor", i.email, NEW)).toEqual({ ok: true, id: i.id })
  })

  it("refuses a used link", async () => {
    const i = await newInstructor()
    const token = await issueEmailToken("instructor", "invite", i.id, INVITE_TTL)
    expect(await acceptInvite(token, NEW)).toBe(i.id)
    const { locale } = await instructor(i.id)
    expect(await acceptInvite(token, "someone else's password", locale === "en" ? "fa" : "en")).toBeNull()
    expect((await instructor(i.id)).locale).toBe(locale) // a refused link changes nothing
    expect(await inviteDetails(token, "en")).toBeNull()
    expect(await verifyPassword((await instructor(i.id)).passwordHash!, NEW)).toBe(true)
  })

  it("refuses an expired link and a deactivated instructor's link", async () => {
    const i = await newInstructor()
    const expired = await issueEmailToken("instructor", "invite", i.id, INVITE_TTL, {
      now: new Date(Date.now() - INVITE_TTL - 1000),
    })
    expect(await inviteDetails(expired, "en")).toBeNull()
    expect(await acceptInvite(expired, NEW)).toBeNull()

    const off = await newInstructor({ active: false })
    const token = await issueEmailToken("instructor", "invite", off.id, INVITE_TTL)
    expect(await inviteDetails(token, "en")).toBeNull()
    expect(await acceptInvite(token, NEW)).toBeNull()
    expect((await instructor(off.id)).passwordHash).toBeNull()
  })

  it("does not accept another purpose's token as an invitation", async () => {
    const i = await newInstructor()
    const reset = await issueEmailToken("instructor", "reset_password", i.id, TOKEN_TTL.reset_password)
    expect(await acceptInvite(reset, NEW)).toBeNull()
  })
})

describe("language", () => {
  it("stores the member's language", async () => {
    const m = await newMember()
    await setMemberLocale(m.id, "tr")
    expect((await member(m.id)).locale).toBe("tr")
  })
})
