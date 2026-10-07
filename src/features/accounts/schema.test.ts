import { describe, expect, it } from "vitest"

import { looksLikeContact, personName, signupSchema } from "./schema"

describe("personName", () => {
  it.each([
    "Ayşe",
    "Ayşe Yılmaz",
    "Çağrı Öztürk-Şahin",
    "Mary-Jane O'Neil",
    "J.R. Smith",
    "J.R.R. Tolkien",
    "A. Yılmaz",
    "Dr. Smith",
    "سارا",
    "محمد‌رضا احمدی", // with a zero-width non-joiner, as Persian names are often typed
    "زهرا سادات",
  ])("accepts the name %s", (name) => {
    expect(looksLikeContact(name)).toBe(false)
    expect(personName().safeParse(name).success).toBe(true)
  })

  it.each([
    "Visit evil.example",
    "evil.example",
    "go to www.x",
    "WWW.X",
    "a@b",
    "Call +90 555 123 45 67",
    "http://",
    "Ayşe https://x",
    "۰۵۳۲ ۱۲۳",
    "٠٥٣٢",
    "Agent 007",
    "<b>Ayşe</b>",
    "back\\slash",
    "Ali.Veli",
    "سایت.کام",
  ])("refuses %s, with the friendly message key", (name) => {
    expect(looksLikeContact(name)).toBe(true)
    const result = personName().safeParse(name)
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.message)).toContain("account.signup.errors.name")
  })

  it("keeps the length rules and trims", () => {
    expect(personName().safeParse("  Ayşe  ").data).toBe("Ayşe")
    expect(personName().safeParse("A").success).toBe(false)
    expect(personName().safeParse("A".repeat(81)).success).toBe(false)
  })

  it("is the sign-up form's name", () => {
    const values = { email: "a@b.co", password: "a long password", phone: "" }
    expect(signupSchema.safeParse({ ...values, name: "Ayşe" }).success).toBe(true)
    expect(signupSchema.safeParse({ ...values, name: "Your order failed, see evil.example" }).success).toBe(false)
  })
})
