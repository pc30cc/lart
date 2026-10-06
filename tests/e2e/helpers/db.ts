import { Pool } from "pg"

/** The database the server under test uses (lart_e2e by default). */
export const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgres://lart:lart@127.0.0.1:5432/lart_e2e"

let pool: Pool | undefined

/** A parameterised query against the e2e database (for looking up ids and seeding phase-2 data). */
export async function sql<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  pool ??= new Pool({ connectionString: E2E_DATABASE_URL, max: 2 })
  const result = await pool.query(text, params)
  return result.rows as T[]
}

export async function one<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T> {
  const rows = await sql<T>(text, params)
  if (rows.length !== 1) throw new Error(`expected one row, got ${rows.length}: ${text}`)
  return rows[0]
}

export async function closeDb() {
  await pool?.end()
  pool = undefined
}
