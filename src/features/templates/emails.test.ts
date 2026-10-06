import { randomUUID } from "node:crypto"
import { and, desc, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { db } from "@/db"
import { admins, auditLog, settings } from "@/db/schema"
import { getSetting } from "@/lib/settings"
import { previewEmailTexts, resetEmailTexts, saveEmailTexts } from "./actions"
import { getEmailEditor, listEmails } from "./emails"

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl")
  const load = async (l: "fa" | "tr" | "en") => ({
    common: (await import(`../../../messages/${l}/common.json`)).default,
    templates: (await import(`../../../messages/${l}/templates.json`)).default,
  })
  const all = { fa: await load("fa"), tr: await load("tr"), en: await load("en") }
  return {
    getTranslations: async (options?: string | { locale: "fa" | "tr" | "en"; namespace?: string }) => {
      const { locale = "en", namespace } = typeof options === "object" ? options : { namespace: options }
      return createTranslator({ locale, messages: all[locale], namespace: namespace as never })
    },
    getLocale: async () => "en",
  }
})
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))

const session = vi.hoisted(() => ({
  sessionId: "test",
  admin: { id: "", email: "", name: "Email Tester", shareBp: 0 },
}))
vi.mock("@/lib/auth/admin", () => ({ requireAdmin: async () => session, getAdmin: async () => session }))

// No code sends this email yet (phase 2), so other test files never render it while these run.
const template = "workshop_reminder" as const
const run = randomUUID().slice(0, 8)
const empty = { fa: "", tr: "", en: "" }
const blank = { subject: empty, preview: empty, heading: empty, intro: empty, intro2: empty, cta: empty, note: empty }

const audits = async (action: string) =>
  db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, action), eq(auditLog.entityId, template), eq(auditLog.adminId, session.admin.id)))
    .orderBy(desc(auditLog.at))

beforeAll(async () => {
  const [admin] = await db.insert(admins).values({ email: `email-${run}@test.local`, name: "Email Tester", passwordHash: "x" }).returning()
  Object.assign(session.admin, { id: admin.id, email: admin.email })
})

afterAll(async () => {
  await resetEmailTexts({ template })
})

describe("email texts", () => {
  it("lists every email and starts with the default texts", async () => {
    await resetEmailTexts({ template })
    const emails = await listEmails()
    expect(emails.map((e) => e.template)).toContain(template)
    const editor = await getEmailEditor(template)
    expect(editor.edited).toEqual([])
    expect(editor.saved.subject).toEqual(empty)
    expect(editor.defaults.subject.en).toBe("See you soon at “{workshopTitle}”")
    expect(editor.placeholders).toEqual(expect.arrayContaining(["name", "workshopTitle", "venue", "brand"]))
  })

  it("saves only the filled languages, audits the change and shows them in the editor", async () => {
    const texts = { ...blank, subject: { fa: "", tr: "", en: "Tomorrow: {workshopTitle}" }, note: { fa: "", tr: "Otopark: {venue}", en: "" } }
    expect(await saveEmailTexts({ template, texts })).toEqual({ ok: true, data: { changed: true } })

    const stored = (await getSetting("emailTexts"))[template]
    expect(stored).toEqual({ subject: { en: "Tomorrow: {workshopTitle}" }, note: { tr: "Otopark: {venue}" } })
    const editor = await getEmailEditor(template)
    expect(editor.edited).toEqual(["tr", "en"])
    expect(editor.saved.subject).toEqual({ fa: "", tr: "", en: "Tomorrow: {workshopTitle}" })
    expect((await listEmails()).find((e) => e.template === template)?.edited).toEqual(["tr", "en"])

    const [entry] = await audits("email.update")
    expect(entry).toMatchObject({ entity: "email", entityId: template })
    expect(entry.data).toMatchObject({ subject: { from: null, to: { en: "Tomorrow: {workshopTitle}" } } })

    // Saving the same texts again changes nothing; clearing one is recorded.
    expect(await saveEmailTexts({ template, texts })).toEqual({ ok: true, data: { changed: false } })
    expect(await saveEmailTexts({ template, texts: { ...texts, note: empty } })).toEqual({ ok: true, data: { changed: true } })
    expect((await audits("email.update"))[0].data).toEqual({ note: { from: { tr: "Otopark: {venue}" }, to: null } })
    expect(await saveEmailTexts({ template, texts })).toEqual({ ok: true, data: { changed: true } })
  })

  it.each([
    ["Hi {nmae}", "templates.emails.errors.placeholder", "{nmae} isn’t a placeholder of this email. Use one from the list, or remove it."],
    ["Hi {name", "templates.emails.errors.syntax", "Check the curly brackets: each { needs a }, and they are only for placeholders."],
    ["{venue, plural, one {#} other {#}}", "templates.emails.errors.number", "A text placeholder can’t be used as a number or a plural here."],
  ])("refuses %s with a message on that field", async (text, _key, message) => {
    const before = (await getSetting("emailTexts"))[template]
    const result = await saveEmailTexts({ template, texts: { ...blank, intro: { fa: "", tr: "", en: text } } })
    expect(result).toEqual({ ok: false, error: message, fieldErrors: { "texts.intro.en": message } })
    expect((await getSetting("emailTexts"))[template]).toEqual(before)
  })

  it("previews unsaved texts with example details, without saving them", async () => {
    const before = (await getSetting("emailTexts"))[template]
    const result = await previewEmailTexts({
      template,
      locale: "en",
      texts: { ...blank, heading: { fa: "", tr: "", en: "See you, {name}!" } },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.subject).toMatch(/^See you soon at “.+”$/)
    expect(result.data.html).toContain("See you, Zeynep Arslan!")
    expect((await getSetting("emailTexts"))[template]).toEqual(before)

    const broken = await previewEmailTexts({ template, locale: "en", texts: { ...blank, cta: { fa: "", tr: "", en: "{oops}" } } })
    expect(broken).toMatchObject({ ok: false, fieldErrors: { "texts.cta.en": expect.stringContaining("{oops}") } })
  })

  it("goes back to the default texts and keeps the old ones in the activity log", async () => {
    await saveEmailTexts({ template, texts: { ...blank, heading: { fa: "", tr: "", en: "Soon!" } } })
    expect(await resetEmailTexts({ template })).toEqual({ ok: true, data: undefined })
    expect((await getSetting("emailTexts"))[template]).toBeUndefined()
    const [entry] = await audits("email.reset")
    expect(entry.data).toEqual({ heading: { en: "Soon!" } })
    // Other emails' texts stay.
    const [row] = await db.select().from(settings).where(eq(settings.key, "emailTexts"))
    expect(row?.value ?? {}).not.toHaveProperty(template)
  })
})
