"use server"

import { and, eq } from "drizzle-orm"
import { z } from "zod"

import { uuid } from "@/components/admin/form/schemas"
import { db } from "@/db"
import { contracts } from "@/db/schema"
import { adminAction, UserError } from "@/lib/action"
import { sendContractReady } from "./notify"

/** Email the contract that is waiting for a signature to the instructor again. */
export const resendContract = adminAction(z.object({ courseId: uuid() }), async ({ courseId }, ctx) => {
  const [contract] = await db
    .select({ id: contracts.id, version: contracts.version })
    .from(contracts)
    .where(and(eq(contracts.courseId, courseId), eq(contracts.status, "sent")))
    .limit(1)
  if (!contract) throw new UserError("contracts.errors.nothingToResend")
  const sent = await sendContractReady(contract.id)
  if (!sent) throw new UserError("contracts.errors.emailFailed")
  await ctx.audit({
    action: "contract.resend",
    entity: "contract",
    entityId: contract.id,
    data: { courseId, version: contract.version },
  })
  return { version: contract.version }
})
