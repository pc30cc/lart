import { describe, expect, it } from "vitest"

import { formatLira } from "@/lib/money"
import { renderContract, type ContractData } from "./render"
import { contractPlaceholders, fillPlaceholders, parseContractText } from "./text"

const data: ContractData = {
  version: 2,
  templateBody: {
    tr: "## Ücret ve hesap\n\n1. {brand} ve {instructor_name}: {workshop_title}.\n\n2. Karar zamanı: {decision_deadline}. {unknown} ve {Brand} olduğu gibi kalır.",
    en: "## Fee\n\n1. {brand} pays {fee_amount} ({fee_type}); advance {advance_amount}.",
    fa: "## بندها\n\n۱. {brand} و {instructor_name} برای «{workshop_title}» در {venue}.",
  },
  instructor: { officialName: "Zeynep Yılmaz", idNumber: "12345678901" },
  course: {
    title: { fa: "شمع‌سازی", tr: "Mum Yapımı", en: "Candle making" },
    // 14 Oct 2026, 18:00–20:30 Istanbul time (UTC+3).
    startsAt: new Date("2026-10-14T15:00:00Z"),
    endsAt: new Date("2026-10-14T17:30:00Z"),
    venue: { tr: "Moda Sanat Evi", en: "Moda Art House" },
    minCapacity: 4,
    maxCapacity: 12,
    decisionAt: new Date("2026-10-12T15:00:00Z"),
  },
  fee: { feeType: "per_participant", feeAmount: 50_000, advanceAmount: 100_000 },
}

describe("renderContract", () => {
  it("builds the header from the fields and fills the fixed clauses (Turkish)", async () => {
    const text = await renderContract(data, "tr", { brand: "Lart" })
    expect(text).toContain("# Eğitmen sözleşmesi")
    expect(text).toContain("Mum Yapımı · Sürüm 2")
    expect(text).toContain("Lart ile eğitmen Zeynep Yılmaz (kimlik numarası: 12345678901)")
    expect(text).toContain("- Tarih: 14 Ekim 2026, Çarşamba")
    expect(text).toContain("- Saat: 18:00 – 20:30 (İstanbul saati)")
    expect(text).toContain("- Yer: Moda Sanat Evi")
    expect(text).toContain("en az 4, en fazla 12")
    expect(text).toContain("her katılımcı için ₺500 alır")
    expect(text).toContain("₺1.000 tutarında ön ödeme")
    // The fixed clauses follow, with placeholders filled and unknown ones left alone.
    expect(text).toContain("## Ücret ve hesap")
    expect(text).toContain("1. Lart ve Zeynep Yılmaz: Mum Yapımı.")
    expect(text).toContain("Karar zamanı: 12 Ekim 2026 18:00.")
    expect(text).toContain("{unknown} ve {Brand} olduğu gibi kalır.")
    expect(text.indexOf("## Ücret ve hesap")).toBeGreaterThan(text.indexOf("## Ön ödeme"))
  })

  it("writes Persian with Persian digits and the Persian title", async () => {
    const text = await renderContract(data, "fa", { brand: "لارت" })
    expect(text).toContain("# قرارداد همکاری مدرس")
    expect(text).toContain("«شمع‌سازی» در Moda Sanat Evi")
    expect(text).toContain("حداقل ۴ و حداکثر ۱۲ نفر")
    expect(text).not.toMatch(/\{(brand|workshop_title|instructor_name)\}/)
    // Dates in the Solar Hijri calendar: 14 Oct 2026 is Wednesday 22 Mehr 1405.
    expect(text).toContain("تاریخ: چهارشنبه ۲۲ مهر ۱۴۰۵")
    expect(text).toContain("آخرین زمان تصمیم‌گیری دربارهٔ برگزاری: ۲۰ مهر ۱۴۰۵ ساعت ۱۸:۰۰")
    expect(text).not.toMatch(/اکتبر|۲۰۲۶/)
  })

  it("says so when the fee is fixed and there is no advance (English)", async () => {
    const text = await renderContract(
      { ...data, fee: { feeType: "fixed", feeAmount: 400_000, advanceAmount: 0 } },
      "en",
      { brand: "Lart" },
    )
    const fee = formatLira(400_000, "en")
    expect(text).toContain(`a fixed fee of ${fee} for the whole workshop`)
    expect(text).toContain("There is no advance payment.")
    expect(text).toContain(`1. Lart pays ${fee} (fixed for the whole workshop); advance ${formatLira(0, "en")}.`)
  })

  it("writes the venue in the contract's language, falling back to Turkish", async () => {
    const en = await renderContract(data, "en", { brand: "Lart" })
    expect(en).toContain("- Venue: Moda Art House")
    expect(en).not.toContain("Moda Sanat Evi")
    const fa = await renderContract({ ...data, course: { ...data.course, venue: { ...data.course.venue, fa: "خانهٔ هنر مودا" } } }, "fa", { brand: "لارت" })
    expect(fa).toContain("«شمع‌سازی» در خانهٔ هنر مودا")
  })

  it("is deterministic, so the signed text can be hashed and checked", async () => {
    expect(await renderContract(data, "en", { brand: "Lart" })).toBe(await renderContract(data, "en", { brand: "Lart" }))
  })

  it("parses into blocks for display", async () => {
    const blocks = parseContractText(await renderContract(data, "en", { brand: "Lart" }))
    expect(blocks[0]).toEqual({ type: "title", text: "Instructor agreement" })
    expect(blocks[1]).toEqual({ type: "paragraph", text: "Candle making · Version 2" })
    expect(blocks.filter((b) => b.type === "heading").map((b) => b.text)).toEqual([
      "Parties",
      "Workshop details",
      "Instructor fee",
      "Advance payment",
      "Fee",
    ])
    expect(blocks.filter((b) => b.type === "item")).toHaveLength(6)
  })
})

describe("fillPlaceholders", () => {
  it("replaces only known names", () => {
    const values = Object.fromEntries(contractPlaceholders.map((p) => [p, `<${p}>`])) as Record<
      (typeof contractPlaceholders)[number],
      string
    >
    expect(fillPlaceholders("{brand} {constructor} {__proto__} {x} {brand", values)).toBe(
      "<brand> {constructor} {__proto__} {x} {brand",
    )
  })
})
