import { randomUUID } from "node:crypto"
import { and, desc, eq, inArray } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { db } from "@/db"
import {
  admins,
  auditLog,
  categories,
  contracts,
  courses,
  instructors,
  members,
  registrations,
  templates,
} from "@/db/schema"
import { createTemplate, deleteTemplate, setDefaultTemplate, updateTemplate } from "./actions"
import { fillTemplate, placeholdersIn, unknownPlaceholders } from "./placeholders"
import { templatePreview } from "./preview"
import { getTemplate, listTemplates } from "./queries"
import { defaultText, seedDefaults } from "./seed"

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
  admin: { id: "", email: "", name: "Template Tester", shareBp: 0 },
}))
vi.mock("@/lib/auth/admin", () => ({ requireAdmin: async () => session, getAdmin: async () => session }))

const run = randomUUID().slice(0, 8)
const body = (s: string) => ({ fa: `${s} fa {brand}`, tr: `${s} tr {brand}`, en: `${s} en {brand}` })
const made: string[] = []
const fixtures = { category: "", instructor: "", member: "", courses: [] as string[] }

async function create(kind: "terms" | "contract", name: string) {
  const result = await createTemplate({ kind, name: `${name} ${run}`, body: body(name) })
  if (!result.ok) throw new Error(result.error)
  made.push(result.data.id)
  return result.data.id
}

const defaultsOf = (kind: "terms" | "contract") =>
  db
    .select({ id: templates.id })
    .from(templates)
    .where(and(eq(templates.kind, kind), eq(templates.isDefault, true)))
    .then((rows) => rows.map((r) => r.id))

const lastAudit = async (id: string) =>
  (await db.select().from(auditLog).where(and(eq(auditLog.entity, "template"), eq(auditLog.entityId, id))).orderBy(desc(auditLog.at)))[0]

beforeAll(async () => {
  const [admin] = await db
    .insert(admins)
    .values({ email: `tpl-${run}@test.local`, name: "Template Tester", passwordHash: "x" })
    .returning()
  Object.assign(session.admin, { id: admin.id, email: admin.email })
  await seedDefaults(db) // the tests below expect a default of each kind
  const [category] = await db.insert(categories).values({ slug: `tpl-${run}`, name: { tr: "Mum" } }).returning()
  const [instructor] = await db
    .insert(instructors)
    .values({
      email: `tpl-instructor-${run}@test.local`,
      officialName: "Test Instructor",
      idNumberEnc: "v1.x.x.x",
      mobile: "+900000000000",
      displayName: { tr: "Eğitmen" },
      teachingField: { tr: "Mum" },
    })
    .returning()
  const [member] = await db
    .insert(members)
    .values({ email: `tpl-member-${run}@test.local`, name: "Member", passwordHash: "x" })
    .returning()
  Object.assign(fixtures, { category: category.id, instructor: instructor.id, member: member.id })
})

afterAll(async () => {
  await db.delete(registrations).where(eq(registrations.memberId, fixtures.member))
  if (fixtures.courses.length) {
    await db.delete(contracts).where(inArray(contracts.courseId, fixtures.courses))
    await db.delete(courses).where(inArray(courses.id, fixtures.courses))
  }
  await db.delete(members).where(eq(members.id, fixtures.member))
  await db.delete(instructors).where(eq(instructors.id, fixtures.instructor))
  await db.delete(categories).where(eq(categories.id, fixtures.category))
  const leftovers = made.length
    ? await db.select({ id: templates.id }).from(templates).where(and(inArray(templates.id, made), eq(templates.isDefault, false)))
    : []
  if (leftovers.length) await db.delete(templates).where(inArray(templates.id, leftovers.map((r) => r.id)))
})

/** A workshop using `termsId` (or the default terms when null). */
async function addCourse(termsId: string | null) {
  const start = new Date(Date.now() + 10 * 86_400_000)
  const [course] = await db
    .insert(courses)
    .values({
      slug: `tpl-course-${randomUUID()}`,
      categoryId: fixtures.category,
      instructorId: fixtures.instructor,
      title: { tr: "Atölye" },
      venue: "Studio",
      startsAt: start,
      endsAt: new Date(start.getTime() + 3_600_000),
      minCapacity: 1,
      maxCapacity: 5,
      price: 10_000,
      registrationDeadline: start,
      decisionAt: start,
      termsTemplateId: termsId,
      createdBy: session.admin.id,
    })
    .returning({ id: courses.id })
  fixtures.courses.push(course.id)
  return course.id
}

describe("placeholders", () => {
  it("finds, checks and fills placeholders", () => {
    const text = "{brand} and {brand}: {decision_deadline}, {brnad}, {Brand} {}"
    expect(placeholdersIn(text)).toEqual(["brand", "decision_deadline", "brnad"])
    expect(unknownPlaceholders(text, "contract")).toEqual(["brnad"])
    expect(unknownPlaceholders(text, "terms")).toEqual(["decision_deadline", "brnad"])
    expect(fillTemplate(text, { brand: "Lart" })).toBe("Lart and Lart: {decision_deadline}, {brnad}, {Brand} {}")
    // A value is never read from the prototype.
    expect(fillTemplate("{constructor}", {})).toBe("{constructor}")
  })
})

describe("seedDefaults", () => {
  it("inserts the default terms and contract once, in all three languages", async () => {
    const before = { terms: await defaultsOf("terms"), contract: await defaultsOf("contract") }
    await db.update(templates).set({ isDefault: false }).where(eq(templates.isDefault, true))
    try {
      const first = await seedDefaults(db)
      expect([...first.inserted].sort()).toEqual(["contract", "terms"])
      expect(await seedDefaults(db)).toEqual({ inserted: [] })
      expect(await seedDefaults(db)).toEqual({ inserted: [] })

      for (const kind of ["terms", "contract"] as const) {
        const ids = await defaultsOf(kind)
        expect(ids).toHaveLength(1)
        const [row] = await db.select().from(templates).where(eq(templates.id, ids[0]))
        expect(row.body).toEqual(defaultText(kind))
        for (const l of ["fa", "tr", "en"] as const) {
          expect(row.body[l]).toContain("{brand}")
          expect(unknownPlaceholders(row.body[l]!, kind)).toEqual([])
          if (kind === "contract") expect(row.body[l]).toContain("{decision_deadline}")
        }
        expect(await lastAudit(row.id)).toMatchObject({ adminId: null, action: "template.create" })
        made.push(row.id)
      }
    } finally {
      // Put the earlier defaults back so the rest of the suite sees the usual state.
      for (const kind of ["terms", "contract"] as const) {
        if (!before[kind].length) continue
        await db.update(templates).set({ isDefault: false }).where(and(eq(templates.kind, kind), eq(templates.isDefault, true)))
        await db.update(templates).set({ isDefault: true }).where(eq(templates.id, before[kind][0]))
      }
    }
  })

  it("has a consent text in all three languages", () => {
    const consent = defaultText("consent")
    for (const l of ["fa", "tr", "en"] as const) expect(consent[l]).toContain("{brand}")
  })
})

describe("template actions", () => {
  it("creates a template (not the default while another one is) and audits its text", async () => {
    const id = await create("terms", "summer")
    const row = await getTemplate(id)
    expect(row).toMatchObject({ kind: "terms", isDefault: false, body: body("summer") })
    expect(row?.usage).toEqual({ workshops: 0, contracts: 0, signedContracts: 0, registrations: 0 })
    expect(await lastAudit(id)).toMatchObject({ action: "template.create", data: { kind: "terms", body: body("summer") } })
  })

  it("makes the first template of a kind the default", async () => {
    const [original] = await defaultsOf("contract")
    await db.update(templates).set({ isDefault: false }).where(eq(templates.id, original))
    const id = await create("contract", "first")
    expect(await defaultsOf("contract")).toEqual([id])
    expect(await setDefaultTemplate({ id: original })).toEqual({ ok: true, data: { id: original } })
    expect(await defaultsOf("contract")).toEqual([original])
  })

  it("requires all three languages and refuses unknown placeholders", async () => {
    const missing = await createTemplate({ kind: "terms", name: "x", body: { fa: "", tr: "Metin", en: "Text" } })
    expect(missing).toMatchObject({ ok: false, fieldErrors: { "body.fa": "Please fill this in." } })

    const typo = await createTemplate({ kind: "terms", name: "x", body: { fa: "م", tr: "{brnad}", en: "{decision_deadline}" } })
    expect(typo).toMatchObject({ ok: false })
    if (typo.ok) return
    expect(Object.keys(typo.fieldErrors ?? {}).sort()).toEqual(["body.en", "body.tr"])
    expect(typo.fieldErrors?.["body.tr"]).toMatch(/placeholder we don’t recognise/)
  })

  it("checks placeholders against the stored kind, not the one sent", async () => {
    const id = await create("terms", "kind")
    const result = await updateTemplate({ id, kind: "contract", name: `kind ${run}`, body: { ...body("kind"), tr: "{workshop_title}" } })
    expect(result).toMatchObject({ ok: false, fieldErrors: { "body.tr": expect.any(String) } })
    expect((await getTemplate(id))?.body).toEqual(body("kind"))
  })

  it("updates the text, keeps the previous version in the audit log, and skips no-op saves", async () => {
    const id = await create("terms", "edit")
    const next = { ...body("edit"), en: "Edited text for {brand}" }
    expect(await updateTemplate({ id, kind: "terms", name: `edit ${run}`, body: next })).toEqual({ ok: true, data: { id } })
    const audit = await lastAudit(id)
    expect(audit).toMatchObject({ action: "template.update", data: { kind: "terms", body: { from: body("edit"), to: next } } })
    expect(audit.data).not.toHaveProperty("name")

    await updateTemplate({ id, kind: "terms", name: `edit ${run}`, body: next })
    expect((await lastAudit(id)).id).toBe(audit.id)
  })

  it("switches the default atomically: exactly one default per kind, even when racing", async () => {
    const [original] = await defaultsOf("terms")
    const a = await create("terms", "a")
    const b = await create("terms", "b")

    expect(await setDefaultTemplate({ id: a })).toEqual({ ok: true, data: { id: a } })
    expect(await defaultsOf("terms")).toEqual([a])
    expect(await lastAudit(a)).toMatchObject({ action: "template.set_default", data: { kind: "terms", previousDefault: original } })

    const results = await Promise.all([setDefaultTemplate({ id: b }), setDefaultTemplate({ id: a }), setDefaultTemplate({ id: b })])
    expect(results.every((r) => r.ok)).toBe(true)
    const now = await defaultsOf("terms")
    expect(now).toHaveLength(1)
    expect([a, b]).toContain(now[0])
    // The other kind is untouched.
    expect(await defaultsOf("contract")).toHaveLength(1)

    await setDefaultTemplate({ id: original })
    expect(await defaultsOf("terms")).toEqual([original])
  })

  it("never deletes the default", async () => {
    const [current] = await defaultsOf("terms")
    expect(await deleteTemplate({ id: current })).toEqual({
      ok: false,
      error: "The default template can’t be deleted. Make another template the default first.",
    })
  })

  it("refuses to delete a template that a workshop, contract or registration uses", async () => {
    const inUse = { ok: false, error: "This template is in use, so it can’t be deleted." }

    const terms = await create("terms", "chosen")
    const courseId = await addCourse(terms)
    expect(await deleteTemplate({ id: terms })).toEqual(inUse)
    expect((await getTemplate(terms))?.usage.workshops).toBe(1)

    const accepted = await create("terms", "accepted")
    await db.insert(registrations).values({
      courseId,
      memberId: fixtures.member,
      participantName: "Ayşe",
      amount: 10_000,
      termsTemplateId: accepted,
      termsSha256: "0".repeat(64),
      termsAcceptedAt: new Date(),
    })
    expect(await deleteTemplate({ id: accepted })).toEqual(inUse)

    const contract = await create("contract", "signed")
    await db.insert(contracts).values({
      courseId: await addCourse(null),
      instructorId: fixtures.instructor,
      templateId: contract,
      feeType: "fixed",
      feeAmount: 50_000,
      signedAt: new Date(),
    })
    expect(await deleteTemplate({ id: contract })).toEqual(inUse)
    expect((await getTemplate(contract))?.usage).toMatchObject({ contracts: 1, signedContracts: 1 })

    const listed = (await listTemplates()).find((t) => t.id === accepted)
    expect(listed).toMatchObject({ languages: ["fa", "tr", "en"], usage: { registrations: 1 } })
    expect(listed).not.toHaveProperty("body")
  })

  it("deletes an unused template and audits it", async () => {
    const id = await create("contract", "spare")
    expect(await deleteTemplate({ id })).toEqual({ ok: true, data: { id } })
    expect(await getTemplate(id)).toBeNull()
    expect(await lastAudit(id)).toMatchObject({ action: "template.delete", data: { kind: "contract", name: `spare ${run}` } })
    expect(await deleteTemplate({ id })).toEqual({ ok: false, error: "This template no longer exists. It may have just been deleted." })
  })

  it("rejects a malformed id", async () => {
    expect(await setDefaultTemplate({ id: "../x" })).toMatchObject({ ok: false })
    expect(await deleteTemplate({ id: "1 or 1=1" })).toMatchObject({ ok: false })
  })
})

describe("templatePreview", () => {
  it("formats sample data like a real contract, in each language", async () => {
    const preview = await templatePreview()
    for (const l of ["fa", "tr", "en"] as const) {
      const p = preview[l]
      expect(p.terms.brand).toBeTruthy()
      expect(p.contract.brand).toBe(p.terms.brand)
      expect(p.contractHeader.startsWith("# ")).toBe(true)
      expect(p.contractHeader).toContain(p.contract.instructor_name)
      expect(p.contractHeader).toContain(p.contract.fee_amount)
      expect(p.contract.decision_deadline).toBeTruthy()
    }
    expect(preview.en.contract.instructor_name).toBe("Ayşe Demir")
    expect(preview.fa.contract.min_participants).toBe("۴")
    expect(fillTemplate(defaultText("contract").en, preview.en.contract)).not.toMatch(/\{[a-z_]+\}/)
  })
})
