import "server-only"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"

import { env } from "@/lib/env"
import * as schema from "./schema"

const globalForDb = globalThis as unknown as { pool?: Pool }

// One small pool per process, kept on globalThis: reused across hot reloads in
// development, and shared by the proxy (the main language, src/i18n/main-locale)
// and the app, which Next bundles separately but runs in one process.
const pool = (globalForDb.pool ??= new Pool({ connectionString: env.DATABASE_URL, max: env.DATABASE_POOL_MAX }))

export const db = drizzle({ client: pool, schema })
export type Db = typeof db
/** A transaction handle, for helpers that must run inside `db.transaction`. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]
export { schema }
