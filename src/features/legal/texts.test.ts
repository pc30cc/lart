import { describe, expect, it } from "vitest"

import { parseContractText } from "@/features/contracts/text"
import { legalDocs, legalText, type LegalValues } from "./texts"

const values: LegalValues = {
  brand: "Limer",
  seller: "Limer Sanat Atölyesi",
  taxOffice: "Kadıköy",
  taxNumber: "1234567890",
  mersis: "",
  address: "Moda Cad. 1, Kadıköy / İstanbul",
  phone: "+90 530 000 00 00",
  email: "hello@limer.tr",
  kep: "",
  website: "limer.tr",
  updated: "11 Ekim 2026",
}

describe("legal texts", () => {
  it.each(["fa", "tr", "en"])("in %s: every page has one title, its sections, and no placeholder left", (locale) => {
    for (const doc of legalDocs) {
      const text = legalText(doc, locale, values)
      const blocks = parseContractText(text)
      expect(blocks.filter((b) => b.type === "title")).toHaveLength(1)
      expect(blocks[0].type).toBe("title")
      expect(blocks.filter((b) => b.type === "heading").length).toBeGreaterThan(2)
      expect(text).not.toMatch(/\{[a-zA-Z]+\}/)
    }
  })

  it("have the same sections in fa, tr and en", () => {
    for (const doc of legalDocs) {
      const count = (locale: string) => parseContractText(legalText(doc, locale, values)).filter((b) => b.type === "heading").length
      expect(count("fa")).toBe(count("tr"))
      expect(count("en")).toBe(count("tr"))
    }
  })

  it("leaves out a detail line that is not set, and keeps the ones that are", () => {
    const text = legalText("distanceSales", "tr", values)
    expect(text).not.toContain("MERSİS")
    expect(text).not.toContain("KEP adresi:")
    expect(text).toContain("- E-posta: hello@limer.tr")
    expect(text).toContain("- Vergi dairesi ve numarası: Kadıköy 1234567890")
    expect(legalText("distanceSales", "tr", { ...values, taxOffice: "" })).toContain("- Vergi dairesi ve numarası: 1234567890")
  })

  it("states the site's refund rules", () => {
    const text = legalText("cancellation", "en", values)
    for (const rule of ["72 hours", "50%", "five business days"]) expect(text).toContain(rule)
    expect(text).not.toContain("24 hours")
  })

  it("falls back to Turkish for an unknown language", () => {
    expect(legalText("privacy", "de", values)).toBe(legalText("privacy", "tr", values))
  })
})
