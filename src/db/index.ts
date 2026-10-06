import "server-only"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"

import { env } from "@/lib/env"
import * as schema from "./schema"

const globalForDb = globalThis as unknown as { pool?: Pool }

// One small pool per process, reused across hot reloads in development.
const pool =
  globalForDb.pool ??
  new Pool({ connectionString: env.DATABASE_URL, max: env.DATABASE_POOL_MAX })
if (process.env.NODE_ENV !== "production") globalForDb.pool = pool

export const db = drizzle({ client: pool, schema })
export type Db = typeof db
/** A transaction handle, for helpers that must run inside `db.transaction`. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]
export { schema }
