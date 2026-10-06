import { describe, expect, it } from "vitest"

import { likePattern, parseTableParams } from "@/components/admin/data-table/params"
import {
  formatDate,
  formatTime,
  formatWeekday,
  localized,
  normalizeDigits,
  slugify,
  zonedParts,
  zonedToIso,
} from "./format"

describe("Istanbul time", () => {
  it("turns an Istanbul date and time into an instant", () => {
    expect(zonedToIso("2026-10-14", "18:30")).toBe("2026-10-14T15:30:00.000Z")
    expect(zonedToIso("2026-01-01", "00:00")).toBe("2025-12-31T21:00:00.000Z")
  })

  it("refuses impossible or missing values", () => {
    expect(zonedToIso("2026-02-30", "10:00")).toBeNull()
    expect(zonedToIso("2026-10-14", "24:00")).toBeNull()
    expect(zonedToIso("", "10:00")).toBeNull()
    expect(zonedToIso("2026-10-14", "")).toBeNull()
  })

  it("splits an instant back into Istanbul date and time", () => {
    expect(zonedParts("2026-10-14T15:30:00.000Z")).toEqual({ date: "2026-10-14", time: "18:30" })
    expect(zonedParts("2025-12-31T21:00:00.000Z")).toEqual({ date: "2026-01-01", time: "00:00" })
  })
})

describe("formatting per language", () => {
  const instant = "2026-10-13T15:30:00.000Z" // Tuesday 18:30 in Istanbul

  it("uses the Gregorian calendar with Persian digits for Persian", () => {
    expect(formatDate(instant, "fa", "long")).toContain("۲۰۲۶")
    expect(formatDate(instant, "fa", "long")).toContain("اکتبر")
    expect(formatTime(instant, "fa")).toBe("۱۸:۳۰")
  })

  it("shows weekdays and 24-hour times in Istanbul time", () => {
    expect(formatWeekday(instant, "tr")).toBe("Salı")
    expect(formatWeekday(instant, "en")).toBe("Tuesday")
    expect(formatTime(instant, "en")).toBe("18:30")
    expect(formatDate(instant, "en", "full")).toMatch(/^Tuesday,? 13 October 2026$/)
  })
})

describe("helpers", () => {
  it("makes Turkish-aware slugs", () => {
    expect(slugify("Mum Yapımı Atölyesi")).toBe("mum-yapimi-atolyesi")
    expect(slugify("İğne Oyası & Çini!")).toBe("igne-oyasi-cini")
    expect(slugify("  --Seramik  ")).toBe("seramik")
    expect(slugify("شمع‌سازی")).toBe("")
  })

  it("picks the text in the language, with a fallback", () => {
    expect(localized({ fa: "شمع", tr: "Mum", en: "Candle" }, "fa")).toBe("شمع")
    expect(localized({ tr: "Mum", en: "Candle" }, "fa")).toBe("Mum")
    expect(localized({ en: "Candle", tr: " " }, "tr")).toBe("Candle")
    expect(localized(null, "en")).toBe("")
  })

  it("reads Persian and Arabic digits", () => {
    expect(normalizeDigits("۱٬۲۵۰٫۵۰")).toBe("1.250,50")
    expect(normalizeDigits("١٢٣")).toBe("123")
  })
})

describe("table params", () => {
  const options = { sort: ["name", "sort"] as const, defaultSort: "sort" as const, filters: { usage: ["used", "unused"] } }

  it("keeps valid values", () => {
    expect(parseTableParams({ q: " mum ", sort: "name", dir: "desc", page: "3", usage: "used" }, options)).toEqual({
      q: "mum",
      sort: "name",
      dir: "desc",
      page: 3,
      pageSize: 20,
      offset: 40,
      filters: { usage: "used" },
    })
  })

  it("falls back to defaults for anything unexpected", () => {
    expect(
      parseTableParams({ sort: "password_hash", dir: "sideways", page: "-1", usage: "drop table" }, options),
    ).toMatchObject({ sort: "sort", dir: "asc", page: 1, offset: 0, filters: {} })
    expect(parseTableParams({ page: "1e9" }, options).page).toBe(1)
    expect(parseTableParams({ q: "x".repeat(500) }, options).q).toHaveLength(100)
  })

  it("escapes LIKE wildcards typed by the user", () => {
    expect(likePattern("50%_off\\")).toBe("%50\\%\\_off\\\\%")
  })
})
