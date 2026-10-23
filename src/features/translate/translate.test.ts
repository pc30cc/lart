import { afterEach, describe, expect, it, vi } from "vitest"

import { encrypt } from "@/lib/crypto"
import { UserError } from "@/lib/errors"

const setting = vi.hoisted(() => ({ value: { openaiKeyEnc: "", model: "gpt-4o-mini" } }))
vi.mock("@/lib/settings", () => ({ getSetting: async () => setting.value }))

const { translate } = await import("./translate")

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

afterEach(() => {
  vi.unstubAllGlobals()
  setting.value = { openaiKeyEnc: "", model: "gpt-4o-mini" }
})

describe("translate", () => {
  it("asks OpenAI once for every language wanted, with the key and model saved", async () => {
    setting.value = { openaiKeyEnc: encrypt("sk-test-0123456789abcdefghij"), model: "gpt-4.1-mini" }
    const fetchMock = vi.fn(async () => json({ choices: [{ message: { content: JSON.stringify({ tr: "Mum atölyesi", en: "Candle workshop" }) } }] }))
    vi.stubGlobal("fetch", fetchMock)

    expect(await translate("ورکشاپ شمع", "fa", ["tr", "en", "fa"])).toEqual({ tr: "Mum atölyesi", en: "Candle workshop" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://api.openai.com/v1/chat/completions")
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-test-0123456789abcdefghij")
    expect(JSON.parse(String(init.body))).toMatchObject({ model: "gpt-4.1-mini" })
  })

  it("says so when the OpenAI key is refused", async () => {
    setting.value = { openaiKeyEnc: encrypt("sk-test-0123456789abcdefghij"), model: "gpt-4o-mini" }
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: {} }, 401)))
    await expect(translate("x", "en", ["tr"])).rejects.toMatchObject({ key: "settings.translation.errors.badKey" })
  })

  it("without a key uses the free service, piece by piece, keeping the line breaks", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const q = new URL(url).searchParams.get("q")
      return json({ responseStatus: 200, responseData: { translatedText: `[${q}]` } })
    })
    vi.stubGlobal("fetch", fetchMock)
    expect(await translate("Line one\n\nLine two", "en", ["tr"])).toEqual({ tr: "[Line one]\n\n[Line two]" })
    expect(fetchMock.mock.calls.map(([u]) => new URL(u as string).searchParams.get("langpair"))).toEqual(["en|tr", "en|tr"])
  })

  it("turns a service failure into a friendly error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 500)))
    vi.spyOn(console, "error").mockImplementation(() => {})
    const err = await translate("Hello", "en", ["fa"]).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UserError)
    expect(err).toMatchObject({ key: "settings.translation.errors.failed" })
  })
})
