import { describe, expect, it } from "vitest"

import { courseValues, feeValues, gallerySchema, maxAdvance, workshopEditSchema, workshopSchema } from "./schema"
import { text, workshopInput } from "./test-fixtures"

const refs = { categoryId: crypto.randomUUID(), instructorId: crypto.randomUUID() }
const input = (overrides: Parameters<typeof workshopInput>[2] = {}) => workshopInput("schema", refs, overrides)
const HOUR = 3_600_000

/** The message keys of the issues, by field. */
function issues(result: ReturnType<typeof workshopSchema.safeParse>) {
  if (result.success) return {}
  return Object.fromEntries(result.error.issues.map((i) => [i.path.join("."), i.message]))
}

describe("workshop schema", () => {
  it("accepts a complete workshop", () => {
    const result = workshopSchema.safeParse(input())
    expect(result.success).toBe(true)
  })

  it("needs the title in all three languages", () => {
    const result = workshopSchema.safeParse(input({ title: { fa: "", tr: "Mum", en: "Candle" } }))
    expect(Object.keys(issues(result))).toContain("title.fa")
  })

  it("wants the end after the start", () => {
    const base = input()
    const result = workshopSchema.safeParse({ ...base, endsAt: base.startsAt })
    expect(issues(result)).toMatchObject({ endsAt: "common.validation.endAfterStart" })
  })

  it("wants the maximum at least the minimum", () => {
    expect(issues(workshopSchema.safeParse(input({ minCapacity: 8, maxCapacity: 5 })))).toMatchObject({
      maxCapacity: "workshops.validation.maxBelowMin",
    })
    expect(workshopSchema.safeParse(input({ minCapacity: 5, maxCapacity: 5 })).success).toBe(true)
  })

  it("wants the registration deadline and the decision before the start", () => {
    const base = input()
    const later = new Date(new Date(base.startsAt).getTime() + HOUR).toISOString()
    expect(issues(workshopSchema.safeParse({ ...base, registrationDeadline: later, decisionAt: later }))).toMatchObject({
      registrationDeadline: "workshops.validation.deadlineBeforeStart",
      decisionAt: "workshops.validation.decisionBeforeStart",
    })
  })

  it("only creates workshops in the future, but past ones stay editable", () => {
    const start = Date.now() - 48 * HOUR
    const past = input({
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(start + 2 * HOUR).toISOString(),
      registrationDeadline: new Date(start - 24 * HOUR).toISOString(),
      decisionAt: new Date(start - 24 * HOUR).toISOString(),
    })
    expect(issues(workshopSchema.safeParse(past))).toMatchObject({ startsAt: "workshops.validation.startInFuture" })
    expect(workshopEditSchema.safeParse(past).success).toBe(true)
  })

  it("needs a valid children's age range", () => {
    expect(issues(workshopSchema.safeParse(input({ ageGroup: "children", ageMin: null, ageMax: 12 })))).toMatchObject({
      ageMin: "common.validation.required",
    })
    expect(issues(workshopSchema.safeParse(input({ ageGroup: "children", ageMin: 12, ageMax: 7 })))).toMatchObject({
      ageMax: "workshops.validation.ageRange",
    })
    const ok = workshopSchema.parse(input({ ageGroup: "children", ageMin: 7, ageMax: 12 }))
    expect(courseValues(ok)).toMatchObject({ ageMin: 7, ageMax: 12 })
    // Adults ignore any leftover range.
    expect(courseValues(workshopSchema.parse(input({ ageMin: 7, ageMax: 12 })))).toMatchObject({ ageMin: null, ageMax: null })
  })

  it("keeps the advance at or below the total fee", () => {
    // Fixed fee: the advance can be up to the fee itself.
    expect(workshopSchema.safeParse(input({ feeType: "fixed", feeAmount: 300_000, advanceAmount: 300_000 })).success).toBe(true)
    expect(issues(workshopSchema.safeParse(input({ feeType: "fixed", feeAmount: 300_000, advanceAmount: 300_001 })))).toMatchObject({
      advanceAmount: "workshops.validation.advanceTooBig",
    })
    // Per participant: up to the fee times the maximum participants (10 × ₺500 = ₺5,000).
    expect(workshopSchema.safeParse(input({ feeAmount: 50_000, advanceAmount: 500_000 })).success).toBe(true)
    expect(issues(workshopSchema.safeParse(input({ feeAmount: 50_000, advanceAmount: 500_001 })))).toMatchObject({
      advanceAmount: "workshops.validation.advanceTooBig",
    })
    expect(maxAdvance({ feeType: "per_participant", feeAmount: 50_000, maxCapacity: 10 })).toBe(500_000)
  })

  it("asks for the advance amount when there is one, and stores 0 when there isn't", () => {
    expect(issues(workshopSchema.safeParse(input({ hasAdvance: true, advanceAmount: null })))).toMatchObject({
      advanceAmount: "workshops.validation.advanceRequired",
    })
    const none = workshopSchema.parse(input({ hasAdvance: false, advanceAmount: 999 }))
    expect(feeValues(none)).toEqual({ feeType: "per_participant", feeAmount: 50_000, advanceAmount: 0 })
  })

  it("refuses storage paths outside the expected folder", () => {
    for (const coverPath of ["../etc/passwd", "gallery/2026-10/abc.webp", "/courses/2026-10/abc.webp", "courses/x/../../a.webp"]) {
      expect(workshopSchema.safeParse(input({ coverPath })).success, coverPath).toBe(false)
    }
    expect(workshopSchema.safeParse(input({ coverPath: "courses/2026-10/abcDEF_123-x.webp" })).success).toBe(true)
    expect(workshopSchema.safeParse(input({ samples: [{ path: "originals/2026-10/a.webp" }] })).success).toBe(false)
  })

  it("stores 'nothing needed' and empty texts as null", () => {
    const values = courseValues(
      workshopSchema.parse(
        input({ bringNothing: false, bring: text({ tr: "  " }), intro: text(), experienceRequired: false, experienceNote: text({ tr: "x" }) }),
      ),
    )
    expect(values).toMatchObject({ bring: null, intro: null, experienceNote: null, notes: null })
    const bring = courseValues(workshopSchema.parse(input({ bringNothing: false, bring: text({ tr: "Önlük" }) })))
    expect(bring.bring).toEqual({ tr: "Önlük" })
  })

  it("checks gallery items", () => {
    const id = crypto.randomUUID()
    expect(
      gallerySchema.safeParse({
        id,
        items: [
          { kind: "image", path: "gallery/2026-10/a.webp", originalPath: "originals/2026-10/a.webp", width: 10, height: 10 },
          { kind: "video", path: "gallery/2026-10/b.mp4" },
        ],
      }).success,
    ).toBe(true)
    expect(gallerySchema.safeParse({ id, items: [{ kind: "image", path: "courses/2026-10/a.webp" }] }).success).toBe(false)
    expect(
      gallerySchema.safeParse({ id, items: [{ kind: "image", path: "gallery/2026-10/a.webp", originalPath: "gallery/x/a.webp" }] })
        .success,
    ).toBe(false)
  })
})
