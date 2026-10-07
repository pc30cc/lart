import { createTranslator } from "next-intl"
import { describe, expect, it } from "vitest"

import { locales } from "@/i18n/routing"
import moneyEn from "../../../../messages/en/money.json"
import settingsEn from "../../../../messages/en/settings.json"
import workshopsEn from "../../../../messages/en/workshops.json"
import moneyFa from "../../../../messages/fa/money.json"
import settingsFa from "../../../../messages/fa/settings.json"
import workshopsFa from "../../../../messages/fa/workshops.json"
import moneyTr from "../../../../messages/tr/money.json"
import settingsTr from "../../../../messages/tr/settings.json"
import workshopsTr from "../../../../messages/tr/workshops.json"

/** The texts of the admin's registration pages: workshops.registrations, money.refunds, settings.payments. */
const sections = {
  fa: { workshops: { registrations: workshopsFa.registrations }, money: { refunds: moneyFa.refunds }, settings: { payments: settingsFa.payments, tabs: settingsFa.tabs } },
  tr: { workshops: { registrations: workshopsTr.registrations }, money: { refunds: moneyTr.refunds }, settings: { payments: settingsTr.payments, tabs: settingsTr.tabs } },
  en: { workshops: { registrations: workshopsEn.registrations }, money: { refunds: moneyEn.refunds }, settings: { payments: settingsEn.payments, tabs: settingsEn.tabs } },
} as const

const flat = (obj: object, prefix = ""): string[] =>
  Object.entries(obj).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, `${prefix}${k}.`) : [`${prefix}${k}`]))

/** A value for every placeholder; numbers where they are formatted as numbers. */
const values = {
  title: "Mum",
  name: "Ayşe",
  participant: "Deniz",
  amount: "₺1.500",
  paid: "₺1.500",
  refund: "₺750",
  percent: "%50",
  date: "14 Eki 2026",
  method: "cash",
  min: "4",
  max: "10",
  photos: "3",
  videos: "2",
  total: "%50",
  count: 2,
}

describe("registration admin messages", () => {
  it("have the same keys in fa, tr and en", () => {
    const keys = flat(sections.tr).sort()
    expect(flat(sections.fa).sort()).toEqual(keys)
    expect(flat(sections.en).sort()).toEqual(keys)
  })

  it.each(locales)("all format without errors in %s", (locale) => {
    const t = createTranslator({ locale, messages: sections[locale], onError: (error) => { throw error } })
    for (const key of flat(sections[locale])) {
      expect(t(key as never, values as never), key).not.toMatch(/[{}]/)
    }
  })

  it("write counts with Persian digits in Persian, and use «ورکشاپ»", () => {
    const t = createTranslator({ locale: "fa", messages: sections.fa })
    expect(t("workshops.registrations.summary.people", { count: 12 })).toBe("۱۲ نفر")
    expect(JSON.stringify(sections.fa)).toContain("ورکشاپ")
    expect(JSON.stringify(sections.fa)).not.toMatch(/کارگاه/)
  })

  it("name every payment method", () => {
    const t = createTranslator({ locale: "en", messages: sections.en })
    expect(t("workshops.registrations.state.paidVia", { method: "transfer", date: "3 Oct" })).toBe("Bank transfer · 3 Oct")
  })
})
