import { describe, expect, it } from "vitest"

import { normalizeName, panelStatus, profileSchema, sameName, signSchema } from "./schema"

describe("sameName (the typed signature against the official name)", () => {
  it.each([
    ["Zeynep Yılmaz", "Zeynep Yılmaz"],
    ["  zeynep   YILMAZ ", "Zeynep Yılmaz"], // spacing and case; Turkish I → ı
    ["ipek şahin", "İpek Şahin"], // Turkish İ → i
    ["IRENE SMITH", "Irene Smith"], // English I → i
    ["علي رضايي", "علی رضایی"], // Arabic yeh as typed on some keyboards
    ["محمد‌رضا کریمی", "محمدرضا کریمی"], // a zero-width non-joiner
    ["Zeynep Yılmaz", "Zeynep Yılmaz"], // a no-break space
  ])("accepts %j for %j", (typed, official) => {
    expect(sameName(typed, official)).toBe(true)
  })

  it.each([
    ["Zeynep", "Zeynep Yılmaz"], // first name only
    ["Zeynep Yilmaz", "Zeynep Yılmaz"], // another letter (i is not ı)
    ["Isik", "Işık"], // accents count
    ["", "Zeynep Yılmaz"],
    ["   ", ""],
  ])("refuses %j for %j", (typed, official) => {
    expect(sameName(typed, official)).toBe(false)
  })

  it("normalizes what is stored as the signed name", () => {
    expect(normalizeName("  Zeynep ‏  Yılmaz\n")).toBe("Zeynep Yılmaz")
    expect(normalizeName("علي")).toBe("علی")
  })
})

describe("signSchema", () => {
  const valid = {
    contractId: "8a3f3f2e-6a43-4d4f-9b52-0d5a3f0e1c11",
    locale: "tr",
    textSha256: "a".repeat(64),
    agree: true,
    signedName: "Zeynep Yılmaz",
  }

  it("needs the box ticked, a name and the text's fingerprint", () => {
    expect(signSchema.safeParse(valid).success).toBe(true)
    expect(signSchema.safeParse({ ...valid, agree: false }).success).toBe(false)
    expect(signSchema.safeParse({ ...valid, signedName: " " }).success).toBe(false)
    expect(signSchema.safeParse({ ...valid, textSha256: "not-a-hash" }).success).toBe(false)
    expect(signSchema.safeParse({ ...valid, locale: "de" }).success).toBe(false)
  })
})

describe("profileSchema", () => {
  it("keeps only the public fields (private ones are dropped)", () => {
    const parsed = profileSchema.parse({
      displayName: { fa: "", tr: "Zeynep", en: "Zeynep" },
      teachingField: { fa: "", tr: "Seramik", en: "Ceramics" },
      bio: { fa: "", tr: "", en: "" },
      teachingLanguages: ["tr", "tr", "en"],
      website: "@zeynep.seramik",
      photoPath: null,
      officialName: "Someone Else",
      email: "x@y.z",
      idNumber: "99999999999",
    })
    expect(parsed).toEqual({
      displayName: { tr: "Zeynep", en: "Zeynep" },
      teachingField: { tr: "Seramik", en: "Ceramics" },
      bio: {},
      teachingLanguages: ["tr", "en"],
      website: "https://www.instagram.com/zeynep.seramik",
      photoPath: null,
    })
  })

  it("accepts only a photo path in the instructors' folder", () => {
    const base = {
      displayName: { tr: "Z", en: "Z" },
      teachingField: { tr: "S", en: "C" },
      bio: {},
      teachingLanguages: [],
      website: "",
    }
    expect(profileSchema.safeParse({ ...base, photoPath: "instructors/2026-10/abcdefghijklmnopqrstuv.webp" }).success).toBe(true)
    expect(profileSchema.safeParse({ ...base, photoPath: "courses/2026-10/abcdefghijklmnopqrstuv.webp" }).success).toBe(false)
    expect(profileSchema.safeParse({ ...base, photoPath: "instructors/../brand/logo.png" }).success).toBe(false)
  })
})

describe("panelStatus", () => {
  const now = new Date("2026-10-07T12:00:00Z")
  const later = new Date("2026-10-20T12:00:00Z")
  const earlier = new Date("2026-10-01T12:00:00Z")
  const w = (status: Parameters<typeof panelStatus>[0]["status"], endsAt = later, cancelledAt: Date | null = null) => ({
    status,
    endsAt,
    cancelledAt,
  })

  it("says what the status means for the instructor", () => {
    expect(panelStatus(w("awaiting_signature"), now)).toBe("toSign")
    expect(panelStatus(w("published"), now)).toBe("open")
    expect(panelStatus(w("confirmed"), now)).toBe("confirmed")
    expect(panelStatus(w("confirmed", earlier), now)).toBe("finished")
    expect(panelStatus(w("closed", earlier), now)).toBe("finished")
    expect(panelStatus(w("cancelled"), now)).toBe("cancelled")
    // An older row closed after a cancellation stays cancelled.
    expect(panelStatus(w("closed", earlier, earlier), now)).toBe("cancelled")
  })
})
