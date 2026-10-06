/**
 * Post the refunds of cancelled registrations to the ledger the way phase 2's
 * payment flow will, with the money module's own `postRegistrationRefund`
 * (revenue ↔ wallet). The amount is the registration's `refund_amount`, which
 * the cancellation set.
 *
 *   DATABASE_URL=postgres://lart:lart@127.0.0.1:5432/lart_e2e \
 *     pnpm exec tsx tests/e2e/helpers/refund-registrations.ts <registrationId> [...]
 *
 * Prints the ledger transaction ids as JSON (registrations without a refund are skipped).
 */
import "dotenv/config"

import Module, { createRequire } from "node:module"

const load = createRequire(__filename)
const marker = load.resolve("server-only")
load.cache[marker] = Object.assign(new Module(marker), { filename: marker, loaded: true, exports: {} })

async function main() {
  const ids = process.argv.slice(2)
  if (!ids.length) throw new Error("usage: refund-registrations.ts <registrationId> [...]")
  const { postRegistrationRefund, today } = await import("../../../src/features/money/ledger")
  const { db } = await import("../../../src/db")
  const { registrations } = await import("../../../src/db/schema")
  const { eq } = await import("drizzle-orm")
  try {
    const out: string[] = []
    for (const registrationId of ids) {
      const [reg] = await db.select({ refund: registrations.refundAmount }).from(registrations).where(eq(registrations.id, registrationId))
      if (!reg?.refund) continue
      const txId = await db.transaction((tx) =>
        postRegistrationRefund(tx, { registrationId, amount: reg.refund!, occurredOn: today(), description: "e2e: refund to card" }),
      )
      out.push(txId)
    }
    console.log(JSON.stringify(out))
  } finally {
    await db.$client.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
