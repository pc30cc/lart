import { createCipheriv, randomBytes } from "node:crypto"
import { and, eq, inArray } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { db } from "@/db"
import { auditLog, categories, contracts, courses, instructors } from "@/db/schema"
import { createAdmin, createCategory, createInstructor, defaultContractTemplate, runId } from "@/features/workshops/test-fixtures"
import { decrypt, isCiphertext, sha256 } from "@/lib/crypto"
import { getContractText } from "./queries"
import {
  checkSignedText,
  encryptLegacySignedTexts,
  keyDecryptsData,
  openSignedText,
  sealSignedText,
  SignedTextKeyError,
} from "./signed-text"

const session = vi.hoisted(() => ({ sessionId: "test", admin: { id: "", email: "", name: "Signed Text Tester", shareBp: 0 } }))
vi.mock("@/lib/auth/admin", () => ({ requireAdmin: async () => session, getAdmin: async () => session }))

const run = runId()
const courseIds: string[] = []
const extraInstructors: string[] = []
let categoryId: string
let instructorId: string
let templateId: string

/** A contract text as it is signed: Turkish, with the ID number in it. */
const PLAIN = "# Eğitmen sözleşmesi\nAtölye · Sürüm 1\n\n## Taraflar\nLart ile eğitmen Zeynep Yılmaz (kimlik numarası: 12345678901)\n"

beforeAll(async () => {
  const admin = await createAdmin(run, "Signed Text")
  Object.assign(session.admin, { id: admin.id, email: admin.email })
  const [category, instructor] = await Promise.all([createCategory(run), createInstructor(run)])
  categoryId = category.id
  instructorId = instructor.id
  templateId = await defaultContractTemplate()
})

afterAll(async () => {
  await db.delete(contracts).where(inArray(contracts.courseId, courseIds))
  await db.delete(courses).where(inArray(courses.id, courseIds))
  await db.delete(instructors).where(inArray(instructors.id, [instructorId, ...extraInstructors]))
  await db.delete(categories).where(eq(categories.id, categoryId))
})

/** `encrypt` output made with another key than the app's (same format). */
function foreignCiphertext(plain: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", randomBytes(32), iv)
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  return ["v1", iv, cipher.getAuthTag(), data].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".")
}

/**
 * A signed contract with `text` stored as it is in `signed_text` (plain text:
 * signed before the text was encrypted), its SHA-256 and, like `signContract`,
 * a `contract.sign` audit entry with the hash recorded at signing (`recorded`,
 * null for none).
 */
async function legacyContract(text: string, hash = sha256(text), recorded: string | null = hash) {
  const start = new Date(Date.now() + 20 * 86_400_000)
  const [course] = await db
    .insert(courses)
    .values({
      slug: `legacy-${run}-${crypto.randomUUID().slice(0, 8)}`,
      status: "published",
      categoryId,
      instructorId,
      title: { tr: "Atölye", en: "Workshop" },
      venue: { tr: "Atölye 5" },
      startsAt: start,
      endsAt: new Date(start.getTime() + 3_600_000),
      minCapacity: 1,
      maxCapacity: 5,
      price: 100_000,
      registrationDeadline: start,
      decisionAt: start,
      createdBy: session.admin.id,
    })
    .returning({ id: courses.id })
  courseIds.push(course.id)
  const [contract] = await db
    .insert(contracts)
    .values({
      courseId: course.id,
      instructorId,
      templateId,
      status: "signed",
      feeType: "fixed",
      feeAmount: 100_000,
      signedAt: new Date(),
      signedName: "Zeynep Yılmaz",
      signedLocale: "tr",
      signedText: text,
      signedTextSha256: hash,
    })
    .returning({ id: contracts.id })
  if (recorded !== null) {
    await db.insert(auditLog).values({
      adminId: null,
      action: "contract.sign",
      entity: "contract",
      entityId: contract.id,
      data: { courseId: course.id, version: 1, instructorId, locale: "tr", sha256: recorded },
    })
  }
  return contract.id
}

const stored = async (id: string) =>
  (await db.select({ text: contracts.signedText, hash: contracts.signedTextSha256 }).from(contracts).where(eq(contracts.id, id)))[0]

describe("sealSignedText / openSignedText", () => {
  it("round-trips through AES-256-GCM, with the SHA-256 of the plain text", () => {
    const sealed = sealSignedText(PLAIN)
    expect(isCiphertext(sealed.signedText)).toBe(true)
    expect(sealed.signedText).not.toContain("12345678901")
    expect(sealed.signedTextSha256).toBe(sha256(PLAIN))
    expect(sealed.signedTextSha256).not.toBe(sha256(sealed.signedText))
    expect(openSignedText(sealed.signedText)).toBe(PLAIN)
    // A fresh IV every time: the same text never gives the same ciphertext.
    expect(sealSignedText(PLAIN).signedText).not.toBe(sealed.signedText)
  })

  it("reads legacy plain text as it is, but never accepts tampered ciphertext", () => {
    expect(openSignedText(PLAIN)).toBe(PLAIN)
    // Plain text that merely starts like the format is still plain text.
    expect(openSignedText("v1. Sürüm notu")).toBe("v1. Sürüm notu")
    const sealed = sealSignedText(PLAIN).signedText
    const [v, iv, tag, data] = sealed.split(".")
    const flipped = `${v}.${iv}.${tag[0] === "A" ? "B" : "A"}${tag.slice(1)}.${data}`
    expect(isCiphertext(flipped)).toBe(true)
    expect(() => openSignedText(flipped)).toThrow()
  })
})

describe("legacy signed contracts", () => {
  it("are shown as they are until encrypted, then encrypted once (idempotent), hash and text unchanged", async () => {
    const id = await legacyContract(PLAIN)
    expect(await getContractText(id, "en")).toEqual({ text: PLAIN, locale: "tr", signed: true, check: "unencrypted" })

    const first = await encryptLegacySignedTexts()
    expect(first.found).toBeGreaterThanOrEqual(1)
    expect(first.encrypted).toBe(first.found)
    const after = await stored(id)
    expect(isCiphertext(after.text!)).toBe(true)
    expect(after.text).not.toContain("12345678901")
    expect(decrypt(after.text!)).toBe(PLAIN)
    expect(after.hash).toBe(sha256(PLAIN))
    expect(await getContractText(id, "en")).toEqual({ text: PLAIN, locale: "tr", signed: true, check: "ok" })

    const [entry] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "contract.encrypt"), eq(auditLog.entityId, id)))
    expect(entry).toMatchObject({ adminId: null, entity: "contract", data: { sha256: sha256(PLAIN), hashMatches: true } })
    expect(JSON.stringify(entry.data)).not.toContain("12345678901")

    // Again: nothing left to do, the ciphertext stays as it is.
    expect(await encryptLegacySignedTexts()).toEqual({ found: 0, encrypted: 0, hashMismatch: [] })
    expect((await stored(id)).text).toBe(after.text)
  })

  it("reports a stored text that does not match its hash, and encrypts it all the same", async () => {
    const id = await legacyContract(PLAIN, sha256("something else"))
    const result = await encryptLegacySignedTexts()
    expect(result.hashMismatch).toContain(id)
    const after = await stored(id)
    expect(decrypt(after.text!)).toBe(PLAIN)
    expect(after.hash).toBe(sha256("something else"))
  })

  it("leaves contracts signed with the encrypted text alone", async () => {
    const sealed = sealSignedText(PLAIN)
    const id = await legacyContract(sealed.signedText, sealed.signedTextSha256)
    expect(await encryptLegacySignedTexts()).toMatchObject({ found: 0, encrypted: 0 })
    expect(await stored(id)).toEqual({ text: sealed.signedText, hash: sha256(PLAIN) })
  })
})

describe("the key check before encrypting", () => {
  it("accepts the app's key: it decrypts the instructor ID numbers and signed texts already encrypted", async () => {
    expect(await keyDecryptsData()).toBe(true)
  })

  it("refuses another key before changing anything, so a wrong-key run never happens", async () => {
    const id = await legacyContract(PLAIN)
    // Data the app encrypted with a key this process does not have (the newest instructor).
    const [other] = await db
      .insert(instructors)
      .values({
        email: `foreign-key-${run}@test.local`,
        officialName: "Foreign Key",
        idNumberEnc: foreignCiphertext("98765432109"),
        mobile: "+905000000000",
        displayName: { tr: "Foreign" },
        teachingField: { tr: "Test" },
        updatedAt: new Date(Date.now() + 365 * 86_400_000),
      })
      .returning({ id: instructors.id })
    extraInstructors.push(other.id)
    try {
      expect(await keyDecryptsData()).toBe(false)
      const error = await encryptLegacySignedTexts().catch((err: unknown) => err)
      expect(error).toBeInstanceOf(SignedTextKeyError)
      expect(error).toMatchObject({ reason: "mismatch" })
      expect(await encryptLegacySignedTexts(db, { dryRun: true }).catch((err: unknown) => err)).toBeInstanceOf(SignedTextKeyError)
      expect((await stored(id)).text).toBe(PLAIN)
    } finally {
      await db.delete(instructors).where(eq(instructors.id, other.id))
    }
    expect(await keyDecryptsData()).toBe(true)
  })

  it("only counts and checks in a dry run", async () => {
    const id = await legacyContract(PLAIN, sha256("something else"))
    const result = await encryptLegacySignedTexts(db, { dryRun: true })
    expect(result.found).toBeGreaterThanOrEqual(1)
    expect(result.encrypted).toBe(0)
    expect(result.hashMismatch).toContain(id)
    expect((await stored(id)).text).toBe(PLAIN)
    expect(await db.select().from(auditLog).where(and(eq(auditLog.action, "contract.encrypt"), eq(auditLog.entityId, id)))).toEqual([])
  })
})

describe("checking a signed text before it is shown", () => {
  it("proves an encrypted text against its SHA-256 and the hash recorded at signing", () => {
    const sealed = sealSignedText(PLAIN)
    expect(checkSignedText(sealed.signedText, sealed.signedTextSha256, [sha256(PLAIN)])).toEqual({ text: PLAIN, check: "ok" })
    expect(checkSignedText(PLAIN, sha256(PLAIN), [sha256(PLAIN)])).toEqual({ text: PLAIN, check: "unencrypted" })
    expect(checkSignedText(foreignCiphertext(PLAIN), sha256(PLAIN), [sha256(PLAIN)])).toEqual({ text: null, check: "unreadable" })
    // No signing record, a second record that disagrees, or a column hash that does not match: not proven.
    expect(checkSignedText(sealed.signedText, sealed.signedTextSha256, []).check).toBe("mismatch")
    expect(checkSignedText(sealed.signedText, sealed.signedTextSha256, [sha256(PLAIN), sha256("x")]).check).toBe("mismatch")
    expect(checkSignedText(sealed.signedText, sha256("x"), [sha256(PLAIN)]).check).toBe("mismatch")
  })

  it("flags a forged plain text, even with a matching SHA-256 column (no key needed to write it)", async () => {
    const forged = PLAIN.replace("12345678901", "11111111111")
    const id = await legacyContract(forged, sha256(forged), sha256(PLAIN))
    expect(await getContractText(id, "en")).toEqual({ text: forged, locale: "tr", signed: true, check: "mismatch" })
  })

  it("flags a valid ciphertext copied from another contract with its hash", async () => {
    const original = await legacyContract(PLAIN)
    const other = "# Başka bir sözleşme\n"
    const sealed = sealSignedText(other)
    await db.update(contracts).set(sealed).where(eq(contracts.id, original))
    expect(await getContractText(original, "en")).toMatchObject({ text: other, check: "mismatch" })
  })

  it("flags a signed text without a signing record, and one that can't be decrypted (without failing the page)", async () => {
    const sealed = sealSignedText(PLAIN)
    const unrecorded = await legacyContract(sealed.signedText, sealed.signedTextSha256, null)
    expect((await getContractText(unrecorded, "en")).check).toBe("mismatch")
    const unreadable = await legacyContract(foreignCiphertext(PLAIN), sha256(PLAIN))
    expect(await getContractText(unreadable, "en")).toEqual({ text: "", locale: "tr", signed: true, check: "unreadable" })
  })
})
