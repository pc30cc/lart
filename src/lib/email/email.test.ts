import { afterEach, describe, expect, it, vi } from "vitest"

import { checkEmailText, type EmailLocale, renderEmail } from "@/emails"
import { type EmailProps, type EmailTemplate, emailPlaceholders, emailTemplateNames } from "@/emails/templates"
import { env } from "@/lib/env"
import { getBrand } from "@/lib/settings"
import en from "../../../messages/en/emails.json"
import fa from "../../../messages/fa/emails.json"
import tr from "../../../messages/tr/emails.json"
import { sendEmail, sender } from "./index"

const send = vi.hoisted(() => vi.fn())
vi.mock("resend", () => ({ Resend: class { emails = { send } } }))

// The admin's email texts come from here, never from the shared test database (other files save some).
const saved = vi.hoisted(() => ({ emailTexts: {} as Record<string, unknown> }))
vi.mock("@/lib/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settings")>()
  return {
    ...actual,
    getSetting: async (key: string) => (key === "emailTexts" ? saved.emailTexts : actual.getSetting(key as never)),
  }
})

const site = new URL(env.APP_URL).origin
const locales: EmailLocale[] = ["fa", "tr", "en"]

const samples: { [T in EmailTemplate]: EmailProps<T> } = {
  welcome_verify: { name: "Ayşe", verifyUrl: `${site}/tr/verify?token=abc&next=1` },
  instructor_invite: { name: "Zeynep", acceptUrl: "/tr/instructor/invite?token=inv123" },
  contract_ready: {
    instructorName: "Zeynep",
    workshopTitle: "Mum Yapımı",
    workshopDate: "14 Eki 2026",
    signUrl: `${site}/tr/instructor/contracts/c1`,
  },
  contract_signed: {
    adminName: "Mina",
    instructorName: "Zeynep",
    workshopTitle: "Mum Yapımı",
    workshopUrl: `${site}/tr/admin/workshops/w1`,
  },
  decision_due: {
    adminName: "Mina",
    workshopTitle: "Mum Yapımı",
    registrations: 4,
    minimum: 6,
    decisionAt: "12 Eki 2026 18:00",
    workshopUrl: `${site}/tr/admin/workshops/w1`,
  },
  registration_confirmed: {
    name: "Ayşe",
    workshopTitle: "Mum Yapımı",
    date: "14 Eki 2026",
    time: "18:00–20:30",
    venue: "Kadıköy Sanat Evi",
    amount: "₺1.500",
    workshopUrl: `${site}/tr/workshops/mum-yapimi`,
  },
  workshop_reminder: {
    name: "Ayşe",
    workshopTitle: "Mum Yapımı",
    date: "14 Eki 2026",
    time: "18:00–20:30",
    venue: "Kadıköy Sanat Evi",
    bring: "Bir önlük",
  },
  workshop_cancelled: { name: "Ayşe", workshopTitle: "Mum Yapımı", refundAmount: "₺1.500" },
  password_reset: { name: "Ayşe", resetUrl: `${site}/tr/reset?token=r1` },
}

/** The button link a sample should produce (optional links fall back to the home page). */
function expectedLink(template: EmailTemplate, locale: EmailLocale): string {
  const link = Object.entries(samples[template]).find(([k]) => /Url$/.test(k))?.[1] as string | undefined
  return link ? new URL(link, site).href : `${site}/${locale}`
}

const withoutStyle = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "")

const flatKeys = (obj: object, prefix = ""): string[] =>
  Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? flatKeys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  )

afterEach(() => {
  saved.emailTexts = {}
  vi.restoreAllMocks()
  send.mockReset()
  env.RESEND_API_KEY = undefined
  env.EMAIL_FROM = undefined
  env.NODE_ENV = "test"
})

describe("messages", () => {
  it("have the same keys in fa, tr and en", () => {
    const keys = flatKeys(tr).sort()
    expect(flatKeys(fa).sort()).toEqual(keys)
    expect(flatKeys(en).sort()).toEqual(keys)
  })

  it("cover every template", () => {
    for (const template of emailTemplateNames) {
      for (const key of ["subject", "preview", "heading", "intro", "cta"]) {
        expect(flatKeys(tr)).toContain(`${template}.${key}`)
      }
    }
  })
})

describe("renderEmail", () => {
  for (const template of emailTemplateNames) {
    for (const locale of locales) {
      it(`${template} in ${locale}`, async () => {
        const email = await renderEmail(template, samples[template], locale)
        const link = expectedLink(template, locale)
        const visibleHtml = withoutStyle(email.html)

        expect(email.subject.trim()).not.toBe("")
        expect(email.subject).not.toMatch(/[{}\n]/)
        expect(email.text).not.toMatch(/[{}]/)
        expect(visibleHtml).not.toMatch(/[{}]/)
        expect(email.text).not.toContain("emails.")

        expect(email.html).toContain(`lang="${locale}"`)
        if (locale === "fa") expect(email.html).toContain('dir="rtl"')
        else expect(email.html).not.toContain('dir="rtl"')

        expect(email.html).toContain(`href="${link.replaceAll("&", "&amp;")}"`)
        expect(email.text).toContain(link)
        expect(email.html).toContain(await getBrand(locale))
        expect(email.text).toContain(samples[template][Object.keys(samples[template])[0] as never])
      })
    }
  }

  it("uses Tahoma for Persian and never letter-spaces Persian text", async () => {
    const email = await renderEmail("password_reset", samples.password_reset, "fa")
    expect(email.html).toContain("Tahoma")
    expect(email.html).not.toContain("letter-spacing:0.06em")
  })

  it("writes counts with Persian digits in Persian", async () => {
    const email = await renderEmail("decision_due", samples.decision_due, "fa")
    expect(email.text).toContain("۴")
    expect(email.text).toContain("۶")
    // The preview line (hidden preheader, first text in the inbox) too.
    expect(email.html).toContain("۴ ثبت‌نام")
    expect(email.html).toContain("حداقل لازم ۶ نفر")
    expect(email.html).not.toMatch(/\b4 ثبت‌نام/)
  })

  it("says whether the minimum is reached", async () => {
    const notReached = await renderEmail("decision_due", samples.decision_due, "en")
    const reached = await renderEmail("decision_due", { ...samples.decision_due, registrations: 6 }, "en")
    expect(notReached.text).toContain("hasn’t reached")
    expect(reached.text).toContain("has reached")
  })

  it("leaves out an empty optional detail", async () => {
    const email = await renderEmail("workshop_reminder", { ...samples.workshop_reminder, bring: "" }, "en")
    expect(email.text).not.toContain("Please bring")
  })

  it("escapes user-entered text", async () => {
    const email = await renderEmail("welcome_verify", { ...samples.welcome_verify, name: '<script>alert("x")</script>' }, "en")
    expect(email.html).not.toContain("<script>")
    expect(email.html).toContain("&lt;script&gt;")
  })

  it.each(["https://evil.example/verify", "//evil.example/x", "javascript:alert(1)"])("refuses the link %s", async (url) => {
    await expect(renderEmail("welcome_verify", { name: "Ayşe", verifyUrl: url }, "tr")).rejects.toThrow()
  })
})

describe("edited texts (emailTexts setting)", () => {
  it("lays the admin's texts over the default ones, only in their language", async () => {
    saved.emailTexts = { workshop_reminder: { heading: { en: "See you soon, {name}!" }, note: { en: "Parking at {venue}." } } }
    const en = await renderEmail("workshop_reminder", samples.workshop_reminder, "en")
    expect(en.html).toContain("See you soon, Ayşe!")
    expect(en.text).toContain("Parking at Kadıköy Sanat Evi.")
    expect(en.subject).toBe(`See you soon at “Mum Yapımı”`)
    const tr = await renderEmail("workshop_reminder", samples.workshop_reminder, "tr")
    expect(tr.html).not.toContain("See you soon, Ayşe!")
    // Other emails keep their texts.
    expect((await renderEmail("password_reset", samples.password_reset, "en")).html).not.toContain("Parking")
  })

  it("previews unsaved texts instead of the saved ones", async () => {
    saved.emailTexts = { workshop_reminder: { heading: { en: "Saved heading" } } }
    const email = await renderEmail("workshop_reminder", samples.workshop_reminder, "en", { texts: { heading: { en: "Draft heading" } } })
    expect(email.html).toContain("Draft heading")
    expect(email.html).not.toContain("Saved heading")
  })

  it("sends the default texts, and logs it, when a saved text cannot be used", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    saved.emailTexts = { workshop_reminder: { subject: { en: "Tomorrow: {unknown}" } } }
    const email = await renderEmail("workshop_reminder", samples.workshop_reminder, "en")
    expect(email.subject).toBe(`See you soon at “Mum Yapımı”`)
    expect(error.mock.calls.flat().join(" ")).toContain("workshop_reminder")
    // A preview reports the problem instead.
    await expect(
      renderEmail("workshop_reminder", samples.workshop_reminder, "en", { texts: { subject: { en: "{unknown}" } } }),
    ).rejects.toThrow()
  })

  it("lists each email's placeholders: its props, computed values and the brand", () => {
    expect(emailPlaceholders("decision_due")).toEqual({
      names: ["adminName", "workshopTitle", "registrations", "minimum", "decisionAt", "workshopUrl", "status", "brand"],
      numbers: ["registrations", "minimum"],
    })
    expect(emailPlaceholders("password_reset").names).toEqual(["name", "resetUrl", "brand"])
  })

  it.each([
    ["Hello {adminName}, welcome to {brand}", null],
    ["{registrations, plural, one {# person} other {# people}} so far", null],
    ["{status, select, reached {Yes} other {Not yet}}", null],
    ["Hello {nme}", { problem: "placeholder", name: "nme" }],
    ["Hello <b>{adminName}</b>", { problem: "placeholder", name: "b" }],
    ["Hello {adminName", { problem: "syntax" }],
    ["{workshopTitle, plural, one {#} other {#}}", { problem: "number" }],
  ])("checks %s", (text, problem) => {
    expect(checkEmailText("decision_due", text, "en")).toEqual(problem)
  })

  it("checks the bundled texts too", () => {
    for (const template of emailTemplateNames) {
      for (const locale of locales) {
        const own = { fa, tr, en }[locale][template] as Record<string, string>
        for (const [field, text] of Object.entries(own)) expect(checkEmailText(template, text, locale), `${template}.${field} ${locale}`).toBeNull()
      }
    }
  })
})

describe("sendEmail", () => {
  it("logs the email instead of sending when there is no API key", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {})
    const result = await sendEmail({
      to: "ayse@example.com",
      template: "welcome_verify",
      props: samples.welcome_verify,
      locale: "en",
    })
    expect(result).toEqual({ ok: true })
    expect(send).not.toHaveBeenCalled()
    const output = log.mock.calls.flat().join("\n")
    expect(output).toContain("To: ayse@example.com")
    expect(output).toContain("Subject: Welcome to")
    expect(output).toContain(`${site}/tr/verify?token=abc&next=1`)
    expect(output).toContain("Confirm my email")
  })

  it("falls back to Turkish for an unknown language", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {})
    await sendEmail({ to: "a@example.com", template: "password_reset", props: samples.password_reset, locale: "de" })
    expect(log.mock.calls.flat().join("\n")).toContain("şifrenizi yenileyin")
  })

  it("refuses to run without an API key in production, without logging the content", async () => {
    env.NODE_ENV = "production"
    const log = vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
    const result = await sendEmail({ to: "a@example.com", template: "password_reset", props: samples.password_reset })
    expect(result).toEqual({ ok: false, error: "RESEND_API_KEY is not set" })
    expect(log).not.toHaveBeenCalled()
  })

  it("sends with Resend, the brand as sender name and an idempotency key", async () => {
    env.RESEND_API_KEY = "re_test"
    env.EMAIL_FROM = "Old Name <hello@example.com>"
    send.mockResolvedValue({ data: { id: "email_1" }, error: null, headers: null })
    const result = await sendEmail({
      to: ["mina@example.com", "deniz@example.com"],
      template: "contract_signed",
      props: samples.contract_signed,
      locale: "tr",
      idempotencyKey: "contract_signed:c1",
    })
    expect(result).toEqual({ ok: true, id: "email_1" })
    const [payload, options] = send.mock.calls[0]
    expect(payload).toMatchObject({
      from: `"${await getBrand("tr")}" <hello@example.com>`,
      to: ["mina@example.com", "deniz@example.com"],
      subject: "Zeynep, “Mum Yapımı” sözleşmesini imzaladı",
    })
    expect(payload.html).toContain("<!DOCTYPE html")
    expect(payload.text).toContain("Atölyeyi görüntüle")
    expect(options).toEqual({ idempotencyKey: "contract_signed:c1" })
  })

  it("returns Resend's error instead of throwing", async () => {
    env.RESEND_API_KEY = "re_test"
    env.EMAIL_FROM = "hello@example.com"
    vi.spyOn(console, "error").mockImplementation(() => {})
    send.mockResolvedValue({
      data: null,
      error: { name: "rate_limit_exceeded", message: "Too many requests", statusCode: 429 },
      headers: null,
    })
    const result = await sendEmail({ to: "a@example.com", template: "password_reset", props: samples.password_reset })
    expect(result).toEqual({ ok: false, error: "Resend rate_limit_exceeded: Too many requests" })
  })

  it("returns an error for a network failure", async () => {
    env.RESEND_API_KEY = "re_test"
    env.EMAIL_FROM = "hello@example.com"
    vi.spyOn(console, "error").mockImplementation(() => {})
    send.mockRejectedValue(new Error("fetch failed"))
    const result = await sendEmail({ to: "a@example.com", template: "password_reset", props: samples.password_reset })
    expect(result).toEqual({ ok: false, error: "Error: fetch failed" })
  })

  it("returns an error for bad input without sending", async () => {
    env.RESEND_API_KEY = "re_test"
    env.EMAIL_FROM = "hello@example.com"
    vi.spyOn(console, "error").mockImplementation(() => {})
    const badTo = await sendEmail({ to: "not-an-email", template: "password_reset", props: samples.password_reset })
    const badLink = await sendEmail({
      to: "a@example.com",
      template: "password_reset",
      props: { name: "Ayşe", resetUrl: "https://evil.example/reset" },
    })
    const noFrom = await (async () => {
      env.EMAIL_FROM = undefined
      return sendEmail({ to: "a@example.com", template: "password_reset", props: samples.password_reset })
    })()
    expect(badTo).toEqual({ ok: false, error: "invalid recipient address" })
    expect(badLink.ok).toBe(false)
    expect(!badLink.ok && badLink.error).toMatch(/^invalid props: [\s\S]*resetUrl/)
    expect(noFrom.ok).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })
})

describe("sender", () => {
  it.each([
    ["Lart <hello@example.com>", "Lart", '"Lart" <hello@example.com>'],
    ["hello@example.com", "لارت", '"لارت" <hello@example.com>'],
    ["x <hello@example.com>", 'Bad"<Name>\r\n', '"BadName" <hello@example.com>'],
    ["hello@example.com", "", "hello@example.com"],
  ])("%s + %s → %s", (from, brand, expected) => expect(sender(from, brand)).toBe(expected))

  it.each([undefined, "", "no address", "Name <not-an-email>"])("rejects %s", (from) =>
    expect(sender(from, "Lart")).toBeNull(),
  )
})
