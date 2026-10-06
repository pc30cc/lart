import { redirect } from "next/navigation"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

import { slug } from "@/components/admin/form/schemas"
import { adminAction, formDataToObject, UserError } from "./action"
import { requireAdmin } from "./auth/admin"

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl")
  const messages = {
    common: (await import("../../messages/en/common.json")).default,
    categories: (await import("../../messages/en/categories.json")).default,
  }
  return {
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: "en", messages, namespace: namespace as never }),
    getLocale: async () => "en",
  }
})

const session = {
  sessionId: "s",
  admin: { id: "00000000-0000-4000-8000-000000000001", email: "a@test.local", name: "A", shareBp: 10000 },
}
vi.mock("./auth/admin", () => ({ requireAdmin: vi.fn(async () => session) }))

const schema = z.object({
  title: z.string().trim().min(1).max(10),
  slug: slug(),
  count: z.coerce.number().int().min(1),
  name: z.object({ tr: z.string().min(1), en: z.string().optional() }),
})

const valid = { title: "Candles", slug: "candles", count: 2, name: { tr: "Mum" } }

describe("adminAction", () => {
  beforeEach(() => vi.mocked(requireAdmin).mockClear())

  it("checks the admin, validates and returns the handler's data", async () => {
    const handler = vi.fn(async (input: z.output<typeof schema>, ctx: { admin: { id: string } }) => ({
      got: input.title,
      by: ctx.admin.id,
    }))
    const action = adminAction(schema, handler)
    expect(await action(valid)).toEqual({ ok: true, data: { got: "Candles", by: session.admin.id } })
    expect(requireAdmin).toHaveBeenCalledOnce()
  })

  it("returns friendly, translated field errors and does not run the handler", async () => {
    const handler = vi.fn()
    const result = await adminAction(schema, handler)({
      title: "",
      slug: "Not A Slug!",
      count: 0.5,
      name: { tr: "" },
    })
    expect(handler).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: false,
      error: "Please check the highlighted fields.",
      fieldErrors: {
        title: "Please fill this in.",
        slug: "Use only lowercase letters, numbers and hyphens (for example: candle-making).",
        count: "Please enter a whole number.",
        "name.tr": "Please fill this in.",
      },
    })
  })

  it("reports too long and too small with the limit", async () => {
    const result = await adminAction(schema, vi.fn())({ ...valid, title: "x".repeat(11), count: -3 })
    expect(result.ok ? null : result.fieldErrors).toEqual({
      title: "Please use 10 characters or fewer.",
      count: "Please enter 1 or more.",
    })
  })

  it("accepts FormData, with dotted keys for nested values", async () => {
    const form = new FormData()
    form.set("title", "Candles")
    form.set("slug", "candles")
    form.set("count", "3")
    form.set("name.tr", "Mum")
    form.set("name.en", "Candles")
    const result = await adminAction(schema, async (input) => input)(form)
    expect(result).toEqual({
      ok: true,
      data: { title: "Candles", slug: "candles", count: 3, name: { tr: "Mum", en: "Candles" } },
    })
  })

  it("maps a UserError to its translated message (and field)", async () => {
    const action = adminAction(schema, async () => {
      throw new UserError("categories.errors.slugTaken", { field: "slug" })
    })
    const message = "Another category already uses this page address. Please choose a different one."
    expect(await action(valid)).toEqual({ ok: false, error: message, fieldErrors: { slug: message } })

    const plural = adminAction(schema, async () => {
      throw new UserError("categories.errors.inUse", { values: { count: 2 } })
    })
    expect(await plural(valid)).toEqual({
      ok: false,
      error: "2 workshops use this category, so it can’t be deleted.",
    })
  })

  it("hides unexpected errors behind a generic message and logs them", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const action = adminAction(schema, async () => {
      throw new Error("relation does not exist")
    })
    expect(await action(valid)).toEqual({
      ok: false,
      error: "Something went wrong on our side. Please try again in a moment.",
    })
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })

  it("lets redirect() through", async () => {
    const action = adminAction(schema, async () => redirect("/en/admin"))
    await expect(action(valid)).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") })
  })

  it("does not validate or run anything when the admin check redirects", async () => {
    vi.mocked(requireAdmin).mockImplementationOnce(async () => redirect("/en/admin/login"))
    const handler = vi.fn()
    await expect(adminAction(schema, handler)(valid)).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    })
    expect(handler).not.toHaveBeenCalled()
  })
})

describe("formDataToObject", () => {
  it("ignores prototype-polluting keys and React's internal fields", () => {
    const form = new FormData()
    form.set("__proto__.polluted", "yes")
    form.set("a.constructor.x", "yes")
    form.set("$ACTION_ID_123", "")
    form.append("tags", "a")
    form.append("tags", "b")
    form.set("a", "plain")
    form.set("a.b", "nested")
    const out = formDataToObject(form)
    expect(out).toEqual({ tags: ["a", "b"], a: { b: "nested" } })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})
