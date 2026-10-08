import { createTranslator } from "next-intl"
import { describe, expect, it } from "vitest"

import en from "../../../messages/en/money.json"
import fa from "../../../messages/fa/money.json"
import tr from "../../../messages/tr/money.json"
import { periodLabel } from "./period-label"

const label = (start: string, unit: "month" | "quarter" | "year", locale: "fa" | "tr" | "en") => {
  const t = createTranslator({ locale, messages: { money: { fa, tr, en }[locale] } })
  return periodLabel(start, unit, locale, (values) => t("money.reports.quarter", values))
}

describe("report period labels", () => {
  it("name Persian periods in the Solar Hijri calendar, a quarter by its season", () => {
    expect(label("2026-03-21", "quarter", "fa")).toBe("بهار ۱۴۰۵")
    expect(label("2026-06-22", "quarter", "fa")).toBe("تابستان ۱۴۰۵")
    expect(label("2026-09-23", "quarter", "fa")).toBe("پاییز ۱۴۰۵")
    expect(label("2026-12-22", "quarter", "fa")).toBe("زمستان ۱۴۰۵")
    expect(label("2026-09-23", "month", "fa")).toBe("مهر ۱۴۰۵")
    expect(label("2026-03-21", "year", "fa")).toBe("۱۴۰۵")
    // The last days of 1404 are still its winter.
    expect(label("2026-03-20", "quarter", "fa")).toBe("زمستان ۱۴۰۴")
  })

  it("name Turkish and English periods in the Gregorian calendar", () => {
    expect(label("2026-10-01", "quarter", "en")).toBe("Q4 2026")
    expect(label("2026-10-01", "quarter", "tr")).toBe("2026 4. çeyrek")
    expect(label("2026-10-01", "month", "en")).toBe("October 2026")
    expect(label("2026-10-01", "month", "tr")).toBe("Ekim 2026")
    expect(label("2026-01-01", "year", "en")).toBe("2026")
  })
})
