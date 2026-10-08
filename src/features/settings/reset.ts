import "server-only"
import { sql } from "drizzle-orm"

import { db, type Tx } from "@/db"

/**
 * Settings → Danger zone, "Delete all transactions": what it removes.
 *
 * - every ledger transaction and line (the wallet, capital, advances, fees,
 *   registration payments and refunds, workshop closings: all back to zero);
 * - the contracts not yet signed, and every contract of a workshop that has
 *   not taken place (a workshop takes place once it is closed, or has ended
 *   while published or confirmed; a cancelled one never did). The signed
 *   contracts of held workshops stay, with their evidence;
 * - the activity log's money rows (`money.*`, registration payments and
 *   refunds, workshop closings) and the rows of the contracts removed.
 *
 * Nothing else changes: people, workshops, registrations, photos, templates
 * and settings stay as they are. A workshop left without a contract gets a
 * new one when it is next saved (`updateWorkshop`).
 */
const CONTRACTS_TO_DELETE = sql`
  select c.id from contracts c join courses w on w.id = c.course_id
  where c.status = 'sent'
     or not (w.status = 'closed' or (w.status in ('published', 'confirmed') and w.ends_at <= now()))`

const MONEY_AUDIT = sql`(action like 'money.%' or action in ('registration.payment', 'registration.refund', 'workshop.close'))`

export type ResetCounts = { transactions: number; contracts: number; auditRows: number }

/** How many rows "Delete all transactions" would remove now. */
export async function resetPreview(exec: Tx | typeof db = db): Promise<ResetCounts> {
  const [row] = (
    await exec.execute<{ transactions: number; contracts: number; audit_rows: number }>(sql`
      select
        (select count(*) from ledger_transactions)::int as transactions,
        (select count(*) from (${CONTRACTS_TO_DELETE}) d)::int as contracts,
        (select count(*) from audit_log
          where ${MONEY_AUDIT} or (entity = 'contract' and entity_id in (select id::text from (${CONTRACTS_TO_DELETE}) d)))::int as audit_rows`)
  ).rows
  return { transactions: row.transactions, contracts: row.contracts, auditRows: row.audit_rows }
}

/**
 * Remove them, in one database transaction (the caller's). The ledger and
 * workshops are locked first so no payment, closing or signature lands
 * half-way; the append-only triggers let these deletes through only here
 * (`lart.factory_reset`, drizzle/0013_factory_reset.sql).
 */
export async function runFactoryReset(tx: Tx): Promise<ResetCounts> {
  await tx.execute(sql`select set_config('lart.factory_reset', 'on', true)`)
  await tx.execute(sql`lock table ledger_transactions, ledger_lines, contracts, courses in share row exclusive mode`)
  // The contracts' log rows first, while the contracts are still there to be matched.
  const audits = await tx.execute(sql`
    delete from audit_log
    where ${MONEY_AUDIT} or (entity = 'contract' and entity_id in (select id::text from (${CONTRACTS_TO_DELETE}) d))`)
  await tx.execute(sql`delete from ledger_lines`)
  const transactions = await tx.execute(sql`delete from ledger_transactions`)
  const contracts = await tx.execute(sql`delete from contracts where id in (${CONTRACTS_TO_DELETE})`)
  await tx.execute(sql`select set_config('lart.factory_reset', 'off', true)`)
  return { transactions: transactions.rowCount ?? 0, contracts: contracts.rowCount ?? 0, auditRows: audits.rowCount ?? 0 }
}
