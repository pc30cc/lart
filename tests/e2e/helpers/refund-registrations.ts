/**
 * Mark the refunds of cancelled registrations as paid back the way the admin's
 * "Mark as refunded" does, with `recordRefund` (features/registrations/admin/
 * payments.ts): posts `registration_refund` (revenue ↔ wallet) for the
 * registration's `refund_amount`, which the cancellation set, and sets
 * `refunded_at` (a workshop's books close only once no refund is owed).
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
  const { recordRefund } = await import("../../../src/features/registrations/admin/payments")
  const { db } = await import("../../../src/db")
  const { registrations } = await import("../../../src/db/schema")
  const { eq } = await import("drizzle-orm")
  try {
    const out: string[] = []
    for (const registrationId of ids) {
      const [reg] = await db.select({ refund: registrations.refundAmount }).from(registrations).where(eq(registrations.id, registrationId))
      if (!reg?.refund) continue
      const refunded = await db.transaction((tx) => recordRefund(tx, { registrationId, refundedAt: new Date(), createdBy: null }))
      out.push(refunded.transactionId)
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
