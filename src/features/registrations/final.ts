import "server-only"
import { sql } from "drizzle-orm"

import type { Tx } from "@/db"
import { courses, registrations } from "@/db/schema"

/**
 * A workshop on several days registers people for its later days also after
 * the go decision (`daySeatsLeft`), so its final number (the participants
 * the books and a per-participant fee count) follows: never below its active
 * registrations. Run after a registration is added, in its transaction. One
 * day, or not decided yet: nothing changes (one day stays capped at its
 * final number, `seatLimit`).
 */
export async function followFinal(tx: Tx, courseId: string) {
  await tx
    .update(courses)
    .set({
      finalParticipants: sql`greatest(${courses.finalParticipants}, (select count(*) from ${registrations} r where r.course_id = ${courseId} and r.status in ('pending', 'confirmed')))`,
    })
    .where(
      sql`${courses.id} = ${courseId} and ${courses.finalParticipants} is not null
        and jsonb_typeof(${courses.days}) = 'array' and jsonb_array_length(${courses.days}) > 1`,
    )
}
