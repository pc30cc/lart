/**
 * Seed what a fresh database needs. Run with: pnpm db:seed
 *
 * Adds the default registration terms and the default instructor contract
 * (Persian, Turkish and English, from src/features/templates/defaults) when
 * there is no default template of that kind yet. Idempotent: running it again
 * changes nothing. Settings need no seed: every setting has a built-in default.
 *
 * Standalone on purpose: its own pg pool, no "server-only" modules.
 */
import "dotenv/config"

import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"

import * as schema from "../src/db/schema"
import { seedDefaults } from "../src/features/templates/seed"

export { seedDefaults }

async function main() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error("[seed] DATABASE_URL is not set.")
    process.exitCode = 1
    return
  }
  const pool = new Pool({ connectionString, max: 1 })
  try {
    const { inserted } = await seedDefaults(drizzle({ client: pool, schema }))
    console.info(
      inserted.length
        ? `[seed] Added the default template(s): ${inserted.join(", ")}.`
        : "[seed] Nothing to do: the default templates already exist.",
    )
  } finally {
    await pool.end()
  }
}

// Run only when started directly (pnpm db:seed), not when imported.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("[seed] failed", err)
    process.exitCode = 1
  })
}
