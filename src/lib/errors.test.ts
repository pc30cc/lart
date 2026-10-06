import { DrizzleQueryError } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { errorForLog } from "./errors"

const pgCause = (message: string, fields: Record<string, unknown>) => Object.assign(new Error(message), fields)

describe("errorForLog", () => {
  it("keeps the SQL and PostgreSQL code of a failed query, never its values or detail", () => {
    const err = new DrizzleQueryError(
      'insert into "instructors" ("official_name", "mobile", "email")\nvalues ($1, $2, $3)',
      ["Ali Rezaei", "+905551112233", "ali@example.com"],
      pgCause("canceling statement due to statement timeout", {
        code: "57014",
        detail: "Key (email)=(ali@example.com) already exists.",
        table: "instructors",
      }),
    )
    const logged = errorForLog(err)
    const json = JSON.stringify(logged)
    expect(json).not.toMatch(/Ali Rezaei|905551112233|ali@example\.com|Key \(email\)/)
    expect(logged).toMatchObject({
      kind: "query",
      query: expect.stringContaining('insert into "instructors"'),
      code: "57014",
      table: "instructors",
      cause: "canceling statement due to statement timeout",
    })
    expect(String(logged.stack)).toMatch(/^\s+at /)
  })

  it("drops a quoted input value from a PostgreSQL message", () => {
    const err = new DrizzleQueryError(
      "select 1 where id = $1",
      ["12345678901"],
      pgCause('invalid input syntax for type uuid: "12345678901"', { code: "22P02" }),
    )
    const logged = errorForLog(err)
    expect(JSON.stringify(logged)).not.toContain("12345678901")
    expect(logged).toMatchObject({ code: "22P02", cause: 'invalid input syntax for type uuid: "…"' })
  })

  it("keeps the unique constraint name of a duplicate key", () => {
    const err = new DrizzleQueryError(
      "insert into admins (email) values ($1)",
      ["boss@example.com"],
      pgCause('duplicate key value violates unique constraint "admins_email_unique"', {
        code: "23505",
        constraint: "admins_email_unique",
        detail: "Key (email)=(boss@example.com) already exists.",
      }),
    )
    const logged = errorForLog(err)
    expect(JSON.stringify(logged)).not.toContain("boss@example.com")
    expect(logged).toMatchObject({ code: "23505", constraint: "admins_email_unique" })
  })

  it("logs ordinary errors with their message and stack", () => {
    const logged = errorForLog(new TypeError("cannot read x"))
    expect(logged).toMatchObject({ name: "TypeError", message: "cannot read x" })
    expect(String(logged.stack)).toContain("cannot read x")
  })

  it("does not log thrown non-errors", () => {
    expect(errorForLog({ secret: "x" })).toEqual({ value: "object" })
  })
})
