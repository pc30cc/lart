/**
 * Sign a workshop contract as its instructor would in the instructor panel
 * (phase 2), by calling the app's own `signContract`.
 *
 *   DATABASE_URL=postgres://lart:lart@127.0.0.1:5432/lart_e2e \
 *     pnpm exec tsx tests/e2e/helpers/sign-contract.ts <contractId> "<typed name>" [locale]
 *
 * Prints the SignResult as JSON. The instructor is the contract's own.
 */
import "dotenv/config"

import Module, { createRequire } from "node:module"

// App server modules import "server-only", which throws outside React Server
// Components; mark it as loaded (empty), as scripts/jobs.ts does.
const load = createRequire(__filename)
const marker = load.resolve("server-only")
load.cache[marker] = Object.assign(new Module(marker), { filename: marker, loaded: true, exports: {} })

async function main() {
  const [contractId, signedName, locale = "en"] = process.argv.slice(2)
  if (!contractId || !signedName) throw new Error("usage: sign-contract.ts <contractId> <signedName> [locale]")
  const { signContract } = await import("../../../src/features/contracts/sign")
  const { db } = await import("../../../src/db")
  const { contracts } = await import("../../../src/db/schema")
  const { eq } = await import("drizzle-orm")
  try {
    const [row] = await db.select({ instructorId: contracts.instructorId }).from(contracts).where(eq(contracts.id, contractId))
    if (!row) throw new Error(`no contract ${contractId}`)
    const result = await signContract(contractId, row.instructorId, signedName, "203.0.113.7", "Mozilla/5.0 (e2e instructor)", locale)
    console.log(JSON.stringify(result))
  } finally {
    await db.$client.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
