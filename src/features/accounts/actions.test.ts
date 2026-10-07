import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { refresh } from "next/cache"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { db } from "@/db"
import { instructors, members, sessions } from "@/db/schema"
import { decrypt, encrypt } from "@/lib/crypto"
import { sendEmail } from "@/lib/email"
import { sessionCookieName } from "@/lib/auth/cookies"
import { LOCKOUT } from "@/lib/auth/login"
import { hashPassword, verifyPassword } from "@/lib/auth/password"
import { createSession } from "@/lib/auth/session"
import { issueEmailToken, TOKEN_TTL } from "@/lib/auth/tokens"
import {
  acceptInviteAction,
  instructorLoginAction,
  instructorLogoutAction,
  instructorSignupAction,
  memberLoginAction,
  memberLogoutAction,
  memberSignupAction,
  requestMemberResetAction,
  resendMemberVerifyAction,
  resetMemberPasswordAction,
  setMemberLocaleAction,
  verifyMemberEmailAction,
} from "./actions"

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl")
  const messages = {
    common: (await import("../../../messages/en/common.json")).default,
    auth: (await import("../../../messages/en/auth.json")).default,
    account: (await import("../../../messages/en/account.json")).default,
    instructors: (await import("../../../messages/en/instructors.json")).default,
  }
  return {
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: "en", messages, namespace: namespace as never }),
    getLocale: async () => "en",
  }
})

/** One request: its cookies, client IP, page, and the work scheduled with after(). */
const request = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  ip: "",
  path: "/en/workshops",
  afterTasks: [] as Promise<unknown>[],
}))
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": request.ip, "x-pathname": request.path }),
  cookies: async () => ({
    get: (name: string) => (request.cookies.has(name) ? { name, value: request.cookies.get(name) } : undefined),
    set: (name: string, value: string) => (value ? request.cookies.set(name, value) : request.cookies.delete(name)),
  }),
}))
vi.mock("next/server", () => ({
  after: (task: () => Promise<unknown>) => request.afterTasks.push(Promise.resolve().then(task)),
}))
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }))
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }))

const PASSWORD = "a long and lovely password"
const NEW = "a brand new password"
let passwordHash: string

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD)
})

let ipCounter = 0
beforeEach(() => {
  request.cookies.clear()
  request.afterTasks = []
  request.path = "/en/workshops"
  // A new client network per test: the public actions are rate limited per network.
  request.ip = `198.51.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`
  vi.mocked(sendEmail).mockClear()
  vi.mocked(refresh).mockClear()
})

const address = (what: string) => `act-${what}-${randomUUID().slice(0, 8)}@test.local`
const memberCookie = () => request.cookies.get(sessionCookieName("member"))
const instructorCookie = () => request.cookies.get(sessionCookieName("instructor"))
const redirectTo = (path: string) => ({ digest: expect.stringContaining(`;${path};`) })
const emails = async () => {
  await Promise.all(request.afterTasks)
  return vi.mocked(sendEmail).mock.calls.map(([input]) => input as { to: string; template: string; props: Record<string, string> })
}

async function newMember(values: Partial<typeof members.$inferInsert> = {}) {
  const [row] = await db
    .insert(members)
    .values({ email: address("member"), name: "Ayşe Demir", passwordHash, locale: "en", ...values })
    .returning()
  return row
}

async function newInstructor(values: Partial<typeof instructors.$inferInsert> = {}) {
  const [row] = await db
    .insert(instructors)
    .values({
      email: address("instructor"),
      passwordHash,
      officialName: "Zeynep Yılmaz",
      idNumberEnc: encrypt("12345678901"),
      mobile: "+90 555 000 00 00",
      displayName: { tr: "Zeynep", en: "Zeynep" },
      teachingField: { tr: "Mum" },
      ...values,
    })
    .returning()
  return row
}

/** Signs a member in for the next call (a real session row and its cookie). */
async function signIn(kind: "member" | "instructor", id: string) {
  const { token } = await createSession(kind, id)
  request.cookies.set(sessionCookieName(kind), token)
}

const signup = (values: Partial<Parameters<typeof memberSignupAction>[0] & object> = {}) =>
  memberSignupAction({ name: "Ayşe", email: address("signup"), password: PASSWORD, phone: "", ...values })

describe("memberSignupAction", () => {
  it("creates the account, signs in, emails the verify link and goes back to the site", async () => {
    const email = address("new")
    await expect(signup({ email, phone: "0532 123 45 67", next: "/en/workshops/candles" })).rejects.toMatchObject(
      redirectTo("/en/workshops/candles?notice=checkEmail"),
    )
    const [row] = await db.select().from(members).where(eq(members.email, email))
    expect(row).toMatchObject({ name: "Ayşe", phone: "05321234567", locale: "en", emailVerifiedAt: null })
    expect(memberCookie()).toBeTruthy()
    const sent = await emails()
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ to: email, template: "welcome_verify" })
    expect(sent[0].props.verifyUrl).toMatch(/^\/en\/account\/verify\?token=/)
  })

  it("answers an existing email the same way, without signing in, and tells the owner", async () => {
    const existing = await newMember()
    await expect(signup({ email: existing.email.toUpperCase(), password: NEW })).rejects.toMatchObject(
      redirectTo("/en/workshops?notice=checkEmail"),
    )
    expect(memberCookie()).toBeUndefined()
    const [row] = await db.select().from(members).where(eq(members.id, existing.id))
    expect(await verifyPassword(row.passwordHash, PASSWORD)).toBe(true) // unchanged
    const sent = await emails()
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ to: existing.email, template: "member_exists" })
  })

  it("never goes on to another site or a panel", async () => {
    await expect(signup({ next: "https://evil.example/en" })).rejects.toMatchObject(redirectTo("/en/workshops?notice=checkEmail"))
    request.cookies.clear()
    await expect(signup({ next: "/en/admin" })).rejects.toMatchObject(redirectTo("/en/workshops?notice=checkEmail"))
  })

  it("asks for a long enough password and a real phone number, in friendly words", async () => {
    expect(await signup({ password: "short", phone: "call me" })).toEqual({
      ok: false,
      error: "Please check the highlighted fields.",
      fieldErrors: {
        password: "Please use at least 10 characters.",
        phone: "Please enter a phone number, like +90 532 123 45 67.",
      },
    })
  })

  it("refuses a name with a link or a phone number, and sends no email", async () => {
    const email = address("spam")
    for (const name of ["Your order failed, visit evil.example", "Call +90 555 123 45 67"]) {
      expect(await signup({ email, name })).toEqual({
        ok: false,
        error: "Please check the highlighted fields.",
        fieldErrors: { name: "Please enter just your name (no links, emails or numbers)." },
      })
    }
    expect(await db.select().from(members).where(eq(members.email, email))).toEqual([])
    expect(await emails()).toEqual([])
  })

  it("is rate limited per network", async () => {
    for (let i = 0; i < 10; i++) await signup({ password: "short" })
    expect(await signup()).toEqual({
      ok: false,
      error: "Too many tries from this device. Please wait a few minutes, then try again.",
    })
  })
})

describe("memberLoginAction", () => {
  it("signs in and goes back to the page, or the workshops", async () => {
    const m = await newMember()
    await expect(memberLoginAction({ email: m.email, password: PASSWORD, next: "/en/account" })).rejects.toMatchObject(
      redirectTo("/en/account"),
    )
    expect(memberCookie()).toBeTruthy()
    request.cookies.clear()
    await expect(memberLoginAction({ email: m.email, password: PASSWORD, next: "//evil.example" })).rejects.toMatchObject(
      redirectTo("/en/workshops"),
    )
  })

  it("gives one message for an unknown email, a wrong password and a locked account", async () => {
    const m = await newMember()
    const message = `That email and password don’t match. If you’ve tried several times, please wait ${LOCKOUT.lockMs / 60_000} minutes and try again.`
    expect(await memberLoginAction({ email: address("nobody"), password: PASSWORD })).toEqual({ ok: false, error: message })
    for (let i = 0; i < LOCKOUT.maxFailures; i++) {
      expect(await memberLoginAction({ email: m.email, password: "wrong password" })).toEqual({ ok: false, error: message })
    }
    // Locked now: even the right password is refused, with the same words.
    request.ip = "192.0.2.77"
    expect(await memberLoginAction({ email: m.email, password: PASSWORD })).toEqual({ ok: false, error: message })
    expect(memberCookie()).toBeUndefined()
  })
})

describe("memberLogoutAction", () => {
  it("ends the session and says goodbye on the workshops page", async () => {
    const m = await newMember()
    await signIn("member", m.id)
    await expect(memberLogoutAction()).rejects.toMatchObject(redirectTo("/en/workshops?notice=signedOut"))
    expect(memberCookie()).toBeUndefined()
    expect(await db.select().from(sessions).where(and(eq(sessions.kind, "member"), eq(sessions.subjectId, m.id)))).toHaveLength(0)
  })
})

describe("verify email", () => {
  it("confirms the email from the link and refreshes the page (the banner goes away)", async () => {
    const m = await newMember()
    const token = await issueEmailToken("member", "verify_email", m.id, TOKEN_TTL.verify_email)
    expect(await verifyMemberEmailAction({ token })).toEqual({ ok: true, data: undefined })
    expect(refresh).toHaveBeenCalledOnce()
    expect((await db.select().from(members).where(eq(members.id, m.id)))[0].emailVerifiedAt).toBeInstanceOf(Date)
    expect(await verifyMemberEmailAction({ token: "made-up" })).toEqual({
      ok: false,
      error: "This link no longer works. Please ask for a new one.",
    })
  })

  it("sends the link again to the signed-in member, a few times at most", async () => {
    const m = await newMember()
    await signIn("member", m.id)
    for (let i = 0; i < 3; i++) expect(await resendMemberVerifyAction({})).toEqual({ ok: true, data: { verified: false } })
    expect(await resendMemberVerifyAction({})).toEqual({
      ok: false,
      error: "We’ve sent a few links already. Please wait a few minutes, then try again.",
    })
    expect((await emails()).every((e) => e.to === m.email && e.template === "welcome_verify")).toBe(true)
  })

  it("sends a signed-out visitor to the login, coming back to the page", async () => {
    request.path = "/en/workshops/candles"
    await expect(resendMemberVerifyAction({})).rejects.toMatchObject(
      redirectTo(`/en/account/login?next=${encodeURIComponent("/en/workshops/candles")}`),
    )
  })
})

describe("password reset", () => {
  it("gives the same answer for any address and emails only members", async () => {
    const m = await newMember()
    expect(await requestMemberResetAction({ email: address("nobody") })).toEqual({ ok: true, data: undefined })
    expect(await requestMemberResetAction({ email: m.email })).toEqual({ ok: true, data: undefined })
    const sent = await emails()
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ to: m.email, template: "password_reset" })
    expect(sent[0].props.resetUrl).toMatch(/^\/en\/account\/reset\?token=/)
  })

  it("saves the new password, signs this device in and says so", async () => {
    const m = await newMember()
    const token = await issueEmailToken("member", "reset_password", m.id, TOKEN_TTL.reset_password)
    await expect(resetMemberPasswordAction({ token, password: NEW })).rejects.toMatchObject(
      redirectTo("/en/workshops?notice=passwordSaved"),
    )
    expect(memberCookie()).toBeTruthy()
    expect(await resetMemberPasswordAction({ token, password: NEW })).toEqual({
      ok: false,
      error: "This link no longer works. Please ask for a new one.",
    })
  })
})

describe("setMemberLocaleAction", () => {
  it("stores a signed-in member's language and does nothing for a visitor", async () => {
    const m = await newMember({ locale: "en" })
    expect(await setMemberLocaleAction({ locale: "fa" })).toEqual({ ok: true, data: undefined })
    await signIn("member", m.id)
    expect(await setMemberLocaleAction({ locale: "fa" })).toEqual({ ok: true, data: undefined })
    expect((await db.select().from(members).where(eq(members.id, m.id)))[0].locale).toBe("fa")
    expect((await setMemberLocaleAction({ locale: "de" as never })).ok).toBe(false)
  })
})

describe("instructors", () => {
  it("sign in to the panel, or back to a page inside it", async () => {
    const i = await newInstructor()
    await expect(instructorLoginAction({ email: i.email, password: PASSWORD })).rejects.toMatchObject(redirectTo("/en/instructor"))
    expect(instructorCookie()).toBeTruthy()
    expect(memberCookie()).toBeUndefined()
    request.cookies.clear()
    await expect(
      instructorLoginAction({ email: i.email, password: PASSWORD, next: "/en/workshops" }),
    ).rejects.toMatchObject(redirectTo("/en/instructor"))
  })

  it("cannot sign in while deactivated, or before accepting the invitation", async () => {
    const off = await newInstructor({ active: false })
    const invited = await newInstructor({ passwordHash: null })
    const message = `That email and password don’t match. If you’ve tried several times, please wait ${LOCKOUT.lockMs / 60_000} minutes and try again.`
    expect(await instructorLoginAction({ email: off.email, password: PASSWORD })).toEqual({ ok: false, error: message })
    expect(await instructorLoginAction({ email: invited.email, password: PASSWORD })).toEqual({ ok: false, error: message })
    expect(instructorCookie()).toBeUndefined()
  })

  it("accept the invitation: password set, signed in, into the panel; the link works once", async () => {
    const i = await newInstructor({ passwordHash: null })
    const token = await issueEmailToken("instructor", "invite", i.id, 7 * 24 * 3_600_000)
    await expect(acceptInviteAction({ token, password: NEW })).rejects.toMatchObject(redirectTo("/en/instructor"))
    expect(instructorCookie()).toBeTruthy()
    const [row] = await db.select().from(instructors).where(eq(instructors.id, i.id))
    expect(row.locale).toBe("en") // the invitation page's language
    expect(await verifyPassword(row.passwordHash!, NEW)).toBe(true)
    expect(row.emailVerifiedAt).toBeInstanceOf(Date)

    request.cookies.clear()
    expect(await acceptInviteAction({ token, password: "another password!" })).toEqual({
      ok: false,
      error: "This invitation link no longer works. Please ask the team to send you a new one.",
    })
    expect(instructorCookie()).toBeUndefined()
  })

  it("sign out to the instructor login", async () => {
    const i = await newInstructor()
    await signIn("instructor", i.id)
    await expect(instructorLogoutAction()).rejects.toMatchObject(redirectTo("/en/instructor/login?notice=signedOut"))
    expect(instructorCookie()).toBeUndefined()
  })
})

const instructorSignup = (values: Partial<Parameters<typeof instructorSignupAction>[0] & object> = {}) =>
  instructorSignupAction({
    displayName: { fa: "", tr: "Zeynep Kaya", en: "Zeynep Kaya" },
    teachingField: { fa: "", tr: "Seramik", en: "Ceramics" },
    bio: { fa: "", tr: "", en: "" },
    teachingLanguages: ["tr", "en"],
    website: "@zeynep.clay",
    officialName: "Zeynep  Kaya",
    idNumber: "123 456 789 01",
    mobile: "0090 532 123 45 67",
    email: address("teach"),
    password: PASSWORD,
    agree: true,
    ...values,
  })

describe("instructorSignupAction", () => {
  it("creates an account waiting for approval, signs in, opens the panel and emails the verify link and the admins", async () => {
    const email = address("teacher")
    await expect(instructorSignup({ email: email.toUpperCase() })).rejects.toMatchObject(redirectTo("/en/instructor"))
    const [row] = await db.select().from(instructors).where(eq(instructors.email, email))
    expect(row).toMatchObject({
      officialName: "Zeynep Kaya",
      mobile: "+905321234567",
      website: "https://www.instagram.com/zeynep.clay",
      teachingLanguages: ["tr", "en"],
      bio: null,
      locale: "en",
      active: true,
      approvedAt: null,
      emailVerifiedAt: null,
    })
    expect(decrypt(row.idNumberEnc)).toBe("12345678901")
    expect(await verifyPassword(row.passwordHash!, PASSWORD)).toBe(true)
    expect(instructorCookie()).toBeTruthy()

    const sent = await emails()
    expect(sent.find((e) => e.to === email)).toMatchObject({ template: "welcome_verify" })
    expect(sent.find((e) => e.to === email)?.props.verifyUrl).toMatch(/^\/en\/instructor\/verify\?token=/)
    expect(sent.filter((e) => e.to !== email).every((e) => e.template === "instructor_signup")).toBe(true)
  })

  it("refuses an email that already has an instructor account, and changes nothing", async () => {
    const existing = await newInstructor()
    const taken = "There’s already an instructor account with this email. Please log in, or use “Forgot your password?” on the login page."
    expect(await instructorSignup({ email: existing.email, password: NEW })).toEqual({
      ok: false,
      error: taken,
      fieldErrors: {
        email: taken,
      },
    })
    expect(instructorCookie()).toBeUndefined()
    const [row] = await db.select().from(instructors).where(eq(instructors.id, existing.id))
    expect(await verifyPassword(row.passwordHash!, PASSWORD)).toBe(true)
    expect(await emails()).toEqual([])
  })

  it("needs the ID number, the confirmation, Turkish and English names, and no links in the name", async () => {
    const email = address("incomplete")
    const result = await instructorSignup({
      email,
      idNumber: "",
      agree: false as true,
      displayName: { fa: "", tr: "Zeynep", en: "" },
      mobile: "123",
    })
    expect(result).toMatchObject({ ok: false })
    expect(Object.keys((result as { fieldErrors: object }).fieldErrors).sort()).toEqual(
      ["agree", "displayName.en", "idNumber", "mobile"].sort(),
    )
    // The display name greets the emails we send: no links, addresses or numbers (any language).
    expect(await instructorSignup({ email, displayName: { fa: "سایت evil.example", tr: "Zeynep", en: "Zeynep" } })).toEqual({
      ok: false,
      error: "Please check the highlighted fields.",
      fieldErrors: { "displayName.fa": "Please enter just your name (no links, emails or numbers)." },
    })
    expect(await db.select().from(instructors).where(eq(instructors.email, email))).toEqual([])
    expect(await emails()).toEqual([])
  })

  it("is rate limited per network", async () => {
    for (let i = 0; i < 5; i++) await instructorSignup({ password: "short" })
    expect(await instructorSignup()).toEqual({
      ok: false,
      error: "Too many tries from this device. Please wait a few minutes, then try again.",
    })
  })
})
