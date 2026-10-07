import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.unmock("@/i18n/main-locale")

/** A stand-in for the settings query: each call takes the next programmed answer. */
const query = vi.hoisted(() => ({ answers: [] as (() => Promise<unknown[]>)[], calls: 0 }))
vi.mock("@/db", () => {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => {
      query.calls++
      const next = query.answers.shift()
      return next ? next() : Promise.resolve([])
    },
  }
  return { db: { select: () => chain } }
})

const { getMainLocale, getMainLocaleState, MAIN_LOCALE_TTL_MS, resetMainLocaleCache, setMainLocale } = await import("./main-locale")

const row = (value: unknown) => () => Promise.resolve([{ value }])
const answer = (...answers: (() => Promise<unknown[]>)[]) => query.answers.push(...answers)

beforeEach(() => {
  vi.useFakeTimers()
  resetMainLocaleCache()
  query.answers = []
  query.calls = 0
  vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("getMainLocale", () => {
  it("reads the setting once, then serves it from the cache for 30 seconds", async () => {
    answer(row("fa"))
    expect(await getMainLocale()).toBe("fa")
    vi.advanceTimersByTime(MAIN_LOCALE_TTL_MS - 1)
    expect(await getMainLocale()).toBe("fa")
    expect(query.calls).toBe(1)
  })

  it.each([["no row", []], ["an unknown language", [{ value: "de" }]], ["not a string", [{ value: { tr: 1 } }]]])(
    "falls back to tr with %s",
    async (_name, rows) => {
      answer(() => Promise.resolve(rows))
      expect(await getMainLocale()).toBe("tr")
    },
  )

  it("serves the old value while one fresh read runs, then the new one", async () => {
    answer(row("fa"))
    await getMainLocale()
    vi.advanceTimersByTime(MAIN_LOCALE_TTL_MS)
    let resolve!: (rows: unknown[]) => void
    answer(() => new Promise((r) => (resolve = r)))
    expect(await Promise.all([getMainLocale(), getMainLocale()])).toEqual(["fa", "fa"])
    await vi.waitFor(() => expect(query.calls).toBe(2)) // one refresh for both
    resolve([{ value: "en" }])
    await vi.waitFor(async () => expect(await getMainLocale()).toBe("en"))
    expect(query.calls).toBe(2)
  })

  it("keeps the last value when the database fails, and tries again after 5 seconds", async () => {
    answer(row("fa"))
    await getMainLocale()
    vi.advanceTimersByTime(MAIN_LOCALE_TTL_MS)
    answer(() => Promise.reject(new Error("connection refused")))
    expect(await getMainLocale()).toBe("fa")
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalledOnce())
    expect(await getMainLocale()).toBe("fa")
    expect(query.calls).toBe(2)
    vi.advanceTimersByTime(5_000)
    answer(row("en"))
    await getMainLocale()
    await vi.waitFor(async () => expect(await getMainLocale()).toBe("en"))
    expect(query.calls).toBe(3)
  })

  it("never throws: tr when the first read fails", async () => {
    answer(() => Promise.reject(new Error("down")))
    expect(await getMainLocale()).toBe("tr")
  })

  it("does not wait more than 1.5 seconds for a first read that hangs", async () => {
    answer(() => new Promise(() => {}))
    const result = getMainLocale()
    vi.advanceTimersByTime(1_500)
    expect(await result).toBe("tr")
  })

  it("takes a saved language at once, also over an older read still running", async () => {
    let resolve!: (rows: unknown[]) => void
    answer(() => new Promise((r) => (resolve = r)))
    const first = getMainLocale()
    await vi.waitFor(() => expect(query.calls).toBe(1))
    setMainLocale("en")
    resolve([{ value: "fa" }])
    expect(await first).toBe("en")
    expect(await getMainLocale()).toBe("en")
    expect(query.calls).toBe(1)
  })

  it("keeps one cache per process, shared by every copy of the module (proxy and app)", async () => {
    setMainLocale("fa")
    vi.resetModules()
    const copy = await import("./main-locale")
    expect(await copy.getMainLocale()).toBe("fa")
    expect(query.calls).toBe(0)
  })
})

describe("getMainLocaleState: known or only guessed", () => {
  const known = (locale: string) => ({ locale, known: true })
  const guessed = { locale: "tr", known: false }

  it("is known once the setting was read, also when it has no value (the default)", async () => {
    answer(row("fa"))
    expect(await getMainLocaleState()).toEqual(known("fa"))
    resetMainLocaleCache()
    answer(() => Promise.resolve([]))
    expect(await getMainLocaleState()).toEqual(known("tr"))
  })

  it("is a guess when the first read hangs past 1.5 seconds, known once it answers", async () => {
    let resolve!: (rows: unknown[]) => void
    answer(() => new Promise((r) => (resolve = r)))
    const result = getMainLocaleState()
    await vi.waitFor(() => expect(query.calls).toBe(1))
    vi.advanceTimersByTime(1_500)
    expect(await result).toEqual(guessed)
    resolve([{ value: "fa" }])
    await vi.waitFor(async () => expect(await getMainLocaleState()).toEqual(known("fa")))
  })

  it("stays a guess while the database fails from the start, known after the first read that works", async () => {
    answer(() => Promise.reject(new Error("down")))
    expect(await getMainLocaleState()).toEqual(guessed)
    expect(await getMainLocaleState()).toEqual(guessed) // cached for 5 seconds
    vi.advanceTimersByTime(5_000)
    answer(() => Promise.reject(new Error("still down")))
    expect(await getMainLocaleState()).toEqual(guessed)
    await vi.waitFor(() => expect(query.calls).toBe(2))
    vi.advanceTimersByTime(5_000)
    answer(row("en"))
    await getMainLocaleState()
    await vi.waitFor(async () => expect(await getMainLocaleState()).toEqual(known("en")))
  })

  it("keeps a value read before as known when a later read fails", async () => {
    answer(row("fa"))
    await getMainLocaleState()
    vi.advanceTimersByTime(MAIN_LOCALE_TTL_MS)
    answer(() => Promise.reject(new Error("connection refused")))
    expect(await getMainLocaleState()).toEqual(known("fa"))
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalledOnce())
    expect(await getMainLocaleState()).toEqual(known("fa"))
  })

  it("is known after a save in this process, even after a failed first read", async () => {
    answer(() => Promise.reject(new Error("down")))
    expect(await getMainLocaleState()).toEqual(guessed)
    setMainLocale("en")
    expect(await getMainLocaleState()).toEqual(known("en"))
    expect(await getMainLocale()).toBe("en")
  })
})
