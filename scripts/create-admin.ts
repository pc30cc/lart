/**
 * Create a super admin (a business partner). Run with: pnpm admin:create
 *
 * Interactive: asks for email, name, password (hidden) and profit share.
 * At most three super admins exist. Input can also be piped, one answer per
 * line (email, name, password, password again, share), for automation.
 *
 * Standalone on purpose: it uses its own pg pool and never imports
 * "server-only" modules, so it runs outside Next.js.
 */
import "dotenv/config"

import { count, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import { stdin, stdout } from "node:process"
import { createInterface } from "node:readline/promises"
import { Pool } from "pg"
import { z } from "zod"

import { admins, auditLog } from "../src/db/schema"
import { hashPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../src/lib/auth/password"

const MAX_ADMINS = 3

// ─── Prompts ──────────────────────────────────────────────────────────────────

let piped: string[] | null = null

async function readPiped(): Promise<string[]> {
  if (!piped) {
    let text = ""
    for await (const chunk of stdin) text += chunk
    piped = text.split(/\r?\n/)
  }
  return piped
}

async function ask(question: string): Promise<string> {
  if (!stdin.isTTY) {
    stdout.write(question + "\n")
    return ((await readPiped()).shift() ?? "").trim()
  }
  const rl = createInterface({ input: stdin, output: stdout })
  try {
    return (await rl.question(question)).trim()
  } finally {
    rl.close()
  }
}

/** Read a line without echoing it (raw mode). */
async function askHidden(question: string): Promise<string> {
  if (!stdin.isTTY) {
    stdout.write(question + "\n")
    return (await readPiped()).shift() ?? ""
  }
  stdout.write(question)
  stdin.setRawMode(true)
  stdin.resume()
  stdin.setEncoding("utf8")
  return new Promise((resolve) => {
    let value = ""
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") {
          stdin.off("data", onData)
          stdin.setRawMode(false)
          stdin.pause()
          stdout.write("\n")
          resolve(value)
          return
        }
        if (ch === "\u0003") {
          stdin.setRawMode(false)
          stdout.write("\n")
          process.exit(130)
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1)
        else value += ch
      }
    }
    stdin.on("data", onData)
  })
}

/** Ask until `parse` returns a value; a returned string is the problem to show. */
async function askUntil<T extends number | string>(
  question: string,
  parse: (s: string) => { value: T } | string,
  hidden = false,
): Promise<T> {
  for (let tries = 0; tries < 5; tries++) {
    const answer = hidden ? await askHidden(question) : await ask(question)
    const result = parse(answer)
    if (typeof result !== "string") return result.value
    console.log(`  ${result}`)
    if (!stdin.isTTY) break
  }
  throw new Error("Too many invalid answers.")
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example).")
  const pool = new Pool({ connectionString: url, max: 1 })
  const db = drizzle({ client: pool })

  try {
    const existing = await db
      .select({ email: admins.email, name: admins.name, shareBp: admins.shareBp })
      .from(admins)
      .orderBy(admins.createdAt)
    if (existing.length >= MAX_ADMINS) {
      console.log(`There are already ${MAX_ADMINS} super admins (partners). A fourth one cannot be added.`)
      process.exitCode = 1
      return
    }

    console.log("\nNew super admin\n")
    if (existing.length) {
      console.log("Current partners:")
      for (const a of existing) console.log(`  • ${a.name} <${a.email}>: ${(a.shareBp / 100).toFixed(2)} %`)
      console.log("")
    }

    const takenEmails = new Set(existing.map((a) => a.email))
    const email = await askUntil("Email: ", (s) => {
      const parsed = z.email().max(254).safeParse(s.toLowerCase())
      if (!parsed.success) return "Please enter a valid email address."
      if (takenEmails.has(parsed.data)) return "A super admin with this email already exists."
      return { value: parsed.data }
    })

    const name = await askUntil("Full name: ", (s) =>
      s.length >= 1 && s.length <= 100 ? { value: s } : "Please enter a name (up to 100 characters).",
    )

    const password = await askUntil(
      `Password (at least ${PASSWORD_MIN_LENGTH} characters, hidden): `,
      (s) =>
        s.length < PASSWORD_MIN_LENGTH
          ? `Please use at least ${PASSWORD_MIN_LENGTH} characters.`
          : s.length > PASSWORD_MAX_LENGTH
            ? `Please use at most ${PASSWORD_MAX_LENGTH} characters.`
            : { value: s },
      true,
    )
    const again = await askHidden("Password again: ")
    if (again !== password) throw new Error("The passwords do not match. Nothing was created.")

    const usedBp = existing.reduce((sum, a) => sum + a.shareBp, 0)
    const freeBp = 10000 - usedBp
    const shareBp = await askUntil(`Profit share in % (0–${freeBp / 100}, default ${freeBp / 100}): `, (s) => {
      if (s === "") return { value: freeBp }
      const pct = Number(s.replace(",", ".").replace("%", ""))
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) return "Please enter a percentage between 0 and 100."
      const bp = Math.round(pct * 100)
      if (bp > freeBp) return `Only ${freeBp / 100} % is still free; the shares together cannot exceed 100 %.`
      return { value: bp }
    })

    const passwordHash = await hashPassword(password)
    const id = await db.transaction(async (tx) => {
      // Serialise concurrent runs so the three-partner limit always holds.
      await tx.execute(sql`lock table ${admins} in exclusive mode`)
      const [{ n }] = await tx.select({ n: count() }).from(admins)
      if (n >= MAX_ADMINS) throw new Error(`There are already ${MAX_ADMINS} super admins.`)
      const [row] = await tx.insert(admins).values({ email, name, passwordHash, shareBp }).returning({ id: admins.id })
      await tx.insert(auditLog).values({
        adminId: null,
        action: "admin.create",
        entity: "admin",
        entityId: row.id,
        data: { email, name, shareBp, via: "cli" },
      })
      return row.id
    })

    console.log(`\nCreated super admin ${name} <${email}> (${id}).`)
    const total = usedBp + shareBp
    if (total !== 10000) {
      console.log(`Note: partner shares now total ${total / 100} %. They should total 100 % (Money → Partners).`)
    }
  } finally {
    await pool.end()
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  const code = (e: unknown): unknown => (e && typeof e === "object" && "code" in e ? e.code : undefined)
  const cause = err && typeof err === "object" && "cause" in err ? err.cause : undefined
  const unique = code(err) === "23505" || code(cause) === "23505"
  console.error(`\n${unique ? "A super admin with this email already exists." : message}`)
  process.exitCode = 1
})
