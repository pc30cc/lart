import { afterEach, describe, expect, it, vi } from "vitest"

import { checkEmailText, type EmailLocale, renderEmail } from "@/emails"
import { paymentWays } from "@/emails/payment"
import { type EmailProps, type EmailTemplate, emailPlaceholders, emailTemplateNames } from "@/emails/templates"
import { localePath } from "@/i18n/paths"
import { env } from "@/lib/env"
import { encrypt } from "@/lib/crypto"
import { getBrand, settingDefaults, type SettingValue } from "@/lib/settings"
import en from "../../../messages/en/emails.json"
import siteEn from "../../../messages/en/site.json"
import fa from "../../../messages/fa/emails.json"
import siteFa from "../../../messages/fa/site.json"
import tr from "../../../messages/tr/emails.json"
import siteTr from "../../../messages/tr/site.json"
import { emailConfig, sendEmail, sender } from "./index"

const send = vi.hoisted(() => vi.fn())
vi.mock("resend", () => ({ Resend: class { emails = { send } } }))
const smtp = vi.hoisted(() => ({ createTransport: vi.fn(), sendMail: vi.fn() }))
vi.mock("nodemailer", () => ({ default: { createTransport: smtp.createTransport } }))

// The admin's email texts come from here, never from the shared test database (other files save some).
const saved = vi.hoisted(() => ({ emailTexts: {} as Record<string, unknown>, email: undefined as unknown }))
vi.mock("@/lib/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settings")>()
  return {
    ...actual,
    getSetting: async (key: string) =>
      key === "emailTexts" ? saved.emailTexts : key === "email" ? (saved.email ?? actual.settingDefaults.email) : actual.getSetting(key as never),
  }
})

const site = new URL(env.APP_URL).origin
const locales: EmailLocale[] = ["fa", "tr", "en"]

const samples: { [T in EmailTemplate]: EmailProps<T> } = {
  welcome_verify: { name: "Ayşe", verifyUrl: `${site}/account/verify?token=abc&next=1` },
  instructor_invite: { name: "Zeynep", acceptUrl: "/instructor/invite?token=inv123" },
  instructor_signup: {
    adminName: "Mina",
    instructorName: "Zeynep",
    teachingField: "Seramik",
    instructorEmail: "zeynep@example.com",
    instructorUrl: `${site}/admin/instructors/i1`,
  },
  instructor_approved: { name: "Zeynep", panelUrl: "/instructor" },
  partner_invite: { name: "Leyla", inviterName: "Mina", acceptUrl: "/fa/admin/invite?token=pi123" },
  contract_ready: {
    instructorName: "Zeynep",
    workshopTitle: "Mum Yapımı",
    workshopDate: "14 Eki 2026",
    signUrl: `${site}/instructor/contracts/c1`,
  },
  contract_signed: {
    adminName: "Mina",
    instructorName: "Zeynep",
    workshopTitle: "Mum Yapımı",
    workshopUrl: `${site}/admin/workshops/w1`,
  },
  decision_due: {
    adminName: "Mina",
    workshopTitle: "Mum Yapımı",
    registrations: 4,
    minimum: 6,
    decisionAt: "12 Eki 2026 18:00",
    workshopUrl: `${site}/admin/workshops/w1`,
  },
  registration_confirmed: {
    name: "Ayşe",
    workshopTitle: "Mum Yapımı",
    date: "14 Eki 2026",
    time: "18:00–20:30",
    venue: "Kadıköy Sanat Evi",
    amount: "₺1.500",
    workshopUrl: `${site}/workshops/mum-yapimi`,
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
  password_reset: { name: "Ayşe", resetUrl: `${site}/account/reset?token=r1` },
  password_changed_by_team: { name: "Ayşe", loginUrl: `${site}/account/login` },
  member_exists: { name: "Ayşe", loginUrl: "/account/login", resetUrl: "/account/forgot" },
  registration_received: {
    name: "Ayşe",
    participantName: "Deniz",
    workshopTitle: "Mum Yapımı",
    date: "14 Eki 2026",
    time: "18:00–20:30",
    venue: "Kadıköy Sanat Evi",
    amount: "₺1.500",
    accountUrl: "/account",
    cash: true,
    transfer: { accountHolder: "Lart Sanat", bankName: "Ziraat Bankası", iban: "TR330006100519786457841326", note: "Teşekkürler!" },
    paymentUrl: "https://iyzi.link/AKxyz",
  },
  payment_received: { name: "Ayşe", workshopTitle: "Mum Yapımı", amount: "₺1.500", method: "transfer", accountUrl: "/account" },
  registration_cancelled: {
    name: "Ayşe",
    workshopTitle: "Mum Yapımı",
    refundAmount: "₺750",
    refundPercent: 50,
    workshopsUrl: "/workshops",
  },
  refund_due: {
    adminName: "Mina",
    participantName: "Deniz",
    workshopTitle: "Mum Yapımı",
    amount: "₺750",
    url: `${site}/admin/workshops/w1/registrations`,
  },
  refund_sent: { name: "Ayşe", workshopTitle: "Mum Yapımı", amount: "₺750" },
}

/** The button link a sample should produce (optional links fall back to the home page; the main language is tr). */
function expectedLink(template: EmailTemplate, locale: EmailLocale): string {
  const link = Object.entries(samples[template]).find(([k]) => /(?:^url|Url)$/.test(k))?.[1] as string | undefined
  return new URL(link ?? localePath(locale, "/", "tr"), site).href
}

const withoutStyle = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "")

const flatKeys = (obj: object, prefix = ""): string[] =>
  Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? flatKeys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  )

afterEach(() => {
  saved.emailTexts = {}
  saved.email = undefined
  smtp.createTransport.mockReset()
  smtp.sendMail.mockReset()
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

  it("send a student who wants to cancel to My workshops, by the name the site uses", () => {
    for (const [messages, nav] of [
      [fa, siteFa],
      [tr, siteTr],
      [en, siteEn],
    ] as const) {
      for (const note of [messages.registration_confirmed.note, messages.payment_received.note]) {
        expect(note).toContain(nav.header.myWorkshops)
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

describe("payment emails", () => {
  const received = samples.registration_received

  it("shows one block per way to pay, with the IBAN in groups of four and a Pay online button", async () => {
    const email = await renderEmail("registration_received", received, "en")
    expect(email.text).toContain("Cash at the workshop")
    expect(email.text).toContain("Bank transfer")
    expect(email.text).toContain("TR33 0006 1005 1978 6457 8413 26")
    expect(email.text).toContain("Ziraat Bankası")
    expect(email.text).toContain("“Deniz”")
    expect(email.text).toContain("Teşekkürler!")
    expect(email.text).toContain("Choose whichever way suits you best")
    expect(email.html).toContain('href="https://iyzi.link/AKxyz"')
    expect(email.text).toContain("Pay online")
    // The main button (My workshops) is the quieter one next to "Pay online".
    expect(email.html).toContain(`class="e-btn-quiet"`)
    expect(email.html).toContain(`href="${site}/account"`)
  })

  it("shows only the ways that are on", async () => {
    const base = { ...received, cash: undefined, transfer: undefined, paymentUrl: undefined }
    const cashOnly = await renderEmail("registration_received", { ...base, cash: true }, "tr")
    expect(cashOnly.text).toContain("Atölyede nakit")
    expect(cashOnly.text).not.toContain("IBAN")
    expect(cashOnly.text).toContain("Şöyle ödeyebilirsiniz")
    expect(cashOnly.html).not.toContain(`class="e-btn-quiet"`)
    const none = await renderEmail("registration_received", base, "fa")
    expect(none.text).toContain("به‌زودی دربارهٔ روش پرداخت")
  })

  it("allows an external https link only as the payment link", async () => {
    for (const paymentUrl of ["http://iyzi.link/x", "javascript:alert(1)", "https://user:pw@iyzi.link/x", "/pay"]) {
      await expect(renderEmail("registration_received", { ...received, paymentUrl }, "en"), paymentUrl).rejects.toThrow()
    }
    await expect(renderEmail("registration_received", { ...received, accountUrl: "https://iyzi.link/x" }, "en")).rejects.toThrow()
    await expect(
      renderEmail("payment_received", { ...samples.payment_received, accountUrl: "https://www.paytr.com/link/x" }, "en"),
    ).rejects.toThrow()
  })

  it("refuses a malformed IBAN", async () => {
    const transfer = { ...received.transfer!, iban: "TR33 not an iban" }
    await expect(renderEmail("registration_received", { ...received, transfer }, "en")).rejects.toThrow()
  })

  it("never offers the bank account or flags as placeholders", () => {
    const { names } = emailPlaceholders("registration_received")
    expect(names).not.toContain("transfer")
    expect(names).not.toContain("cash")
    expect(names).toEqual(expect.arrayContaining(["amount", "participantName", "paymentUrl", "ways", "brand"]))
  })

  it("takes the payment ways from the setting, leaving out the ones that cannot be used", () => {
    const payment = {
      cash: true,
      transfer: { enabled: true, accountHolder: "Lart", bankName: "Ziraat", iban: "TR330006100519786457841326", note: { tr: "Not", fa: "یادداشت" } },
      online: { enabled: true, note: { tr: "Dekontu gönderin" } },
    }
    expect(paymentWays(payment, "https://iyzi.link/x", "fa")).toEqual({
      cash: true,
      transfer: { accountHolder: "Lart", bankName: "Ziraat", iban: "TR330006100519786457841326", note: "یادداشت" },
      paymentUrl: "https://iyzi.link/x",
      onlineNote: "Dekontu gönderin", // no Persian note: the Turkish one
    })
    expect(paymentWays({ ...payment, cash: false }, null, "en")).toEqual({ transfer: expect.objectContaining({ note: "Not" }) })
    expect(paymentWays({ ...payment, transfer: { ...payment.transfer, iban: "" } }, "", "en")).toEqual({ cash: true })
    const off = { cash: false, transfer: { ...payment.transfer, enabled: false }, online: { ...payment.online, enabled: false } }
    expect(paymentWays(off, "https://iyzi.link/x", "tr")).toEqual({})
  })

  it("names how the payment was made", async () => {
    const cash = await renderEmail("payment_received", { ...samples.payment_received, method: "cash" }, "en")
    expect(cash.text).toContain("₺1.500 in cash")
    const online = await renderEmail("payment_received", { ...samples.payment_received, method: "online" }, "tr")
    expect(online.text).toContain("online olarak")
    const transfer = await renderEmail("payment_received", samples.payment_received, "fa")
    expect(transfer.text).toContain("پرداخت بانکی")
  })

  it("explains the refund of a cancellation, and leaves it out when nothing was paid", async () => {
    const half = await renderEmail("registration_cancelled", samples.registration_cancelled, "fa")
    expect(half.text).toContain("۵۰ درصد")
    expect(half.text).toContain("₺750")
    const none = await renderEmail("registration_cancelled", { ...samples.registration_cancelled, refundPercent: 0, refundAmount: "₺0" }, "en")
    expect(none.text).toContain("can’t be refunded")
    const unpaid = { ...samples.registration_cancelled, refundAmount: undefined, refundPercent: 100 }
    const notPaid = await renderEmail("registration_cancelled", unpaid, "en")
    expect(notPaid.text).toContain("You hadn’t paid yet")
    expect(notPaid.text).not.toContain("Refund")
  })

  it("says “as you asked” only when the participant cancelled", async () => {
    const own = await renderEmail("registration_cancelled", samples.registration_cancelled, "en")
    expect(own.text).toContain("As you asked")
    const byUs = await renderEmail("registration_cancelled", { ...samples.registration_cancelled, byUs: true }, "tr")
    expect(byUs.text).toContain("“Mum Yapımı” kaydınız iptal edildi")
    expect(byUs.text).not.toContain("İsteğiniz üzerine")
    expect(emailPlaceholders("registration_cancelled").names).toEqual(expect.arrayContaining(["refund", "by"]))
    expect(emailPlaceholders("registration_cancelled").names).not.toContain("byUs")
  })

  it("tells people who had not paid that a cancelled workshop won’t take place, without a refund", async () => {
    const paid = await renderEmail("workshop_cancelled", samples.workshop_cancelled, "en")
    expect(paid.text).toContain("We’ll refund ₺1.500")
    const unpaid = await renderEmail("workshop_cancelled", { ...samples.workshop_cancelled, refundAmount: undefined }, "en")
    expect(unpaid.text).toContain("please don’t come to the venue")
    expect(unpaid.text).not.toContain("Refund")
    expect(unpaid.html).toContain("The workshop won’t take place.")
  })

  it("reminds of what is still to pay, with the ways to pay, apart from “Please bring”", async () => {
    const reminder = samples.workshop_reminder
    const paid = await renderEmail("workshop_reminder", reminder, "en")
    expect(paid.text).not.toContain("To pay")
    expect(paid.text).not.toContain("Cash at the workshop")
    const unpaid = await renderEmail(
      "workshop_reminder",
      { ...reminder, amount: "₺1.500", participantName: "Deniz", cash: true, paymentUrl: "https://iyzi.link/AKxyz" },
      "en",
    )
    expect(unpaid.text).toContain("Please bring")
    expect(unpaid.text).toContain("Bir önlük")
    expect(unpaid.text).toContain("To pay")
    expect(unpaid.text).toContain("There’s still ₺1.500 to pay")
    expect(unpaid.text).toContain("Cash at the workshop")
    expect(unpaid.html).toContain('href="https://iyzi.link/AKxyz"')
    const fa = await renderEmail("workshop_reminder", { ...reminder, amount: "₺1.500" }, "fa")
    expect(fa.text).toContain("دربارهٔ روش پرداخت")
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
    expect(output).toContain(`${site}/account/verify?token=abc&next=1`)
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
    expect(result).toEqual({ ok: false, error: "no email provider (Settings → Email, or RESEND_API_KEY)" })
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
    expect(result).toEqual({ ok: false, error: "RESEND: fetch failed" })
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

describe("email providers (Settings → Email)", () => {
  const setting = (over: Partial<SettingValue<"email">> = {}): SettingValue<"email"> => ({ ...settingDefaults.email, ...over })

  it("without the setting, uses the server's RESEND_API_KEY and EMAIL_FROM", () => {
    expect(emailConfig(setting())).toEqual({ transport: null, fromAddress: "", replyTo: "" })
    env.RESEND_API_KEY = "re_server"
    env.EMAIL_FROM = "Limer <hello@limer.tr>"
    expect(emailConfig(setting())).toEqual({
      transport: { kind: "resend", apiKey: "re_server" },
      fromAddress: "Limer <hello@limer.tr>",
      replyTo: "",
    })
  })

  it("Resend with its own key (stored encrypted) wins over the server's; the page's sender too", () => {
    env.RESEND_API_KEY = "re_server"
    env.EMAIL_FROM = "old@limer.tr"
    const config = emailConfig(setting({ provider: "resend", resendKeyEnc: encrypt("re_own_key"), fromAddress: "hello@limer.tr" }))
    expect(config).toMatchObject({ transport: { kind: "resend", apiKey: "re_own_key" }, fromAddress: "hello@limer.tr" })
  })

  it("sends through SMTP with the brand as sender name and the reply-to address", async () => {
    smtp.createTransport.mockReturnValue({ sendMail: smtp.sendMail })
    smtp.sendMail.mockResolvedValue({ messageId: "<m1@limer.tr>" })
    saved.email = setting({
      provider: "smtp",
      fromAddress: "hello@limer.tr",
      replyTo: "info@limer.tr",
      smtp: { host: "mail.limer.tr", port: 587, security: "starttls", user: "hello@limer.tr", passwordEnc: encrypt("s3cret") },
    })
    const result = await sendEmail({ to: "a@example.com", template: "password_reset", props: samples.password_reset, locale: "en" })
    expect(result).toEqual({ ok: true, id: "<m1@limer.tr>" })
    expect(smtp.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "mail.limer.tr",
        port: 587,
        secure: false,
        requireTLS: true,
        ignoreTLS: false,
        auth: { user: "hello@limer.tr", pass: "s3cret" },
      }),
    )
    const message = smtp.sendMail.mock.calls[0][0]
    expect(message).toMatchObject({ to: "a@example.com", replyTo: "info@limer.tr" })
    expect(message.from).toBe(`"${await getBrand("en")}" <hello@limer.tr>`)
    expect(message.html).toContain("<html")
    expect(send).not.toHaveBeenCalled()
  })

  it("an SMTP server without sign-in gets no credentials; a failure is reported, not thrown", async () => {
    smtp.createTransport.mockReturnValue({ sendMail: smtp.sendMail })
    smtp.sendMail.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:25"))
    vi.spyOn(console, "error").mockImplementation(() => {})
    saved.email = setting({
      provider: "smtp",
      fromAddress: "hello@limer.tr",
      smtp: { host: "relay", port: 25, security: "none", user: "", passwordEnc: "" },
    })
    const result = await sendEmail({ to: "a@example.com", template: "password_reset", props: samples.password_reset })
    expect(result).toEqual({ ok: false, error: "SMTP: connect ECONNREFUSED 10.0.0.5:25" })
    expect(smtp.createTransport).toHaveBeenCalledWith(expect.objectContaining({ ignoreTLS: true, auth: undefined }))
  })
})
