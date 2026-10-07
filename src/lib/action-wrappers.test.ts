import { redirect } from "next/navigation"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

import { instructorAction, memberAction, publicAction, UserError } from "./action"
import { requireInstructor } from "./auth/instructor"
import { requireMember } from "./auth/member"

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl")
  const messages = {
    common: (await import("../../messages/en/common.json")).default,
    auth: (await import("../../messages/en/auth.json")).default,
    account: (await import("../../messages/en/account.json")).default,
  }
  return {
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: "en", messages, namespace: namespace as never }),
    getLocale: async () => "en",
  }
})

const client = vi.hoisted(() => ({ ip: "203.0.113.9" }))
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-real-ip": client.ip }) }))

const member = {
  sessionId: "s",
  member: { id: "m1", email: "ayse@test.local", name: "Ayşe", phone: null, locale: "tr" as const, emailVerified: false },
}
const instructor = {
  sessionId: "s",
  instructor: { id: "i1", email: "z@test.local", displayName: { tr: "Zeynep" }, locale: "tr" as const, emailVerified: true, approved: true },
}
vi.mock("./auth/member", () => ({ requireMember: vi.fn(async () => member) }))
vi.mock("./auth/instructor", () => ({ requireInstructor: vi.fn(async () => instructor) }))

const schema = z.object({ note: z.string().trim().min(1).max(20) })

beforeEach(() => {
  vi.mocked(requireMember).mockClear()
  vi.mocked(requireInstructor).mockClear()
})

describe("memberAction", () => {
  it("passes the signed-in member as ctx and validates the input", async () => {
    const action = memberAction(schema, async ({ note }, ctx) => ({ note, by: ctx.member.id }))
    expect(await action({ note: " hi " })).toEqual({ ok: true, data: { note: "hi", by: "m1" } })
    expect(await action({ note: "" })).toEqual({
      ok: false,
      error: "Please check the highlighted fields.",
      fieldErrors: { note: "Please fill this in." },
    })
    expect(requireMember).toHaveBeenCalledTimes(2)
  })

  it("lets requireMember's redirect to the login through", async () => {
    vi.mocked(requireMember).mockImplementationOnce(async () => redirect("/en/account/login?next=%2Fen%2Fworkshops"))
    const handler = vi.fn()
    await expect(memberAction(schema, handler)({ note: "x" })).rejects.toMatchObject({
      digest: expect.stringContaining("/en/account/login?next=%2Fen%2Fworkshops"),
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it("with { verified: true }, asks an unconfirmed member to confirm the email first", async () => {
    const handler = vi.fn(async () => "registered")
    const action = memberAction(schema, handler, { verified: true })
    expect(await action({ note: "x" })).toEqual({
      ok: false,
      error: "Please confirm your email first. We sent you a link; you can ask for a new one at the top of the page.",
    })
    expect(handler).not.toHaveBeenCalled()
    vi.mocked(requireMember).mockResolvedValueOnce({ ...member, member: { ...member.member, emailVerified: true } })
    expect(await action({ note: "x" })).toEqual({ ok: true, data: "registered" })
  })
})

describe("instructorAction", () => {
  it("passes the signed-in instructor as ctx and maps UserError to friendly text", async () => {
    const action = instructorAction(schema, async (_input, ctx) => {
      if (ctx.instructor.id !== "i1") throw new Error("wrong ctx")
      throw new UserError("account.reset.errors.invalidLink")
    })
    expect(await action({ note: "x" })).toEqual({ ok: false, error: "This link no longer works. Please ask for a new one." })
    expect(requireInstructor).toHaveBeenCalledOnce()
  })
})

describe("publicAction", () => {
  it("needs no session", async () => {
    const action = publicAction(schema, async ({ note }) => note.toUpperCase())
    expect(await action({ note: "hi" })).toEqual({ ok: true, data: "HI" })
    expect(requireMember).not.toHaveBeenCalled()
  })

  it("counts every call per client network, before reading the input", async () => {
    const handler = vi.fn(async () => "ok")
    const action = publicAction(schema, handler, { rateLimit: { limit: 2, windowMs: 60_000 } })
    client.ip = "2001:db8:5:6::1"
    expect((await action({ note: "" })).ok).toBe(false) // invalid input still counts
    expect(await action({ note: "a" })).toEqual({ ok: true, data: "ok" })
    client.ip = "2001:db8:5:6::ffff" // the same /64 network
    expect(await action({ note: "a" })).toEqual({
      ok: false,
      error: "Too many tries from this device. Please wait a few minutes, then try again.",
    })
    client.ip = "2001:db8:5:7::1" // another network
    expect(await action({ note: "a" })).toEqual({ ok: true, data: "ok" })
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it("can answer the limit with its own message", async () => {
    const action = publicAction(schema, async () => "ok", {
      rateLimit: { limit: 0, windowMs: 60_000 },
      rateLimitMessage: "account.verify.errors.rateLimited",
    })
    expect(await action({ note: "a" })).toEqual({
      ok: false,
      error: "We’ve sent a few links already. Please wait a few minutes, then try again.",
    })
  })
})
