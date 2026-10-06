/**
 * Post registration payments to the ledger the way phase 2's payment flow
 * will, with the money module's own `postRegistrationPayment` (wallet ↔
 * revenue, amount taken from the registration).
 *
 *   DATABASE_URL=postgres://lart:lart@127.0.0.1:5432/lart_e2e \
 *     pnpm exec tsx tests/e2e/helpers/pay-registrations.ts <registrationId> [...]
 *
 * Prints the ledger transaction ids as JSON.
 */
import "dotenv/config"

import Module, { createRequire } from "node:module"

const load = createRequire(__filename)
const marker = load.resolve("server-only")
load.cache[marker] = Object.assign(new Module(marker), { filename: marker, loaded: true, exports: {} })

async function main() {
  const ids = process.argv.slice(2)
  if (!ids.length) throw new Error("usage: pay-registrations.ts <registrationId> [...]")
  const { postRegistrationPayment, today } = await import("../../../src/features/money/ledger")
  const { db } = await import("../../../src/db")
  try {
    const out: string[] = []
    for (const registrationId of ids) {
      const txId = await db.transaction((tx) =>
        postRegistrationPayment(tx, { registrationId, occurredOn: today(), description: "e2e: online payment" }),
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
