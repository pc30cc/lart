import { z } from "zod"

import { recordView } from "@/features/analytics/record"
import { clientIp } from "@/lib/auth/client-ip"
import { createRateLimiter } from "@/lib/auth/rate-limit"
import { isSameOrigin } from "@/lib/auth/request"
import { errorForLog } from "@/lib/errors"

const report = z.object({
  path: z.string().max(400),
  locale: z.string().max(5),
  referrer: z.string().max(1000).optional(),
})

/** A browsing person sees far fewer pages than this; a script sending more is cut off. */
const views = createRateLimiter({ limit: 120, windowMs: 60_000 })
const done = () => new Response(null, { status: 204 })

/**
 * A page of the public site was seen (the site's beacon, `ViewBeacon`):
 * JSON { path, locale, referrer? } from this site only. Counted by
 * `recordView` (no cookie, no IP kept). Always answers 204, so a page never
 * waits on it or learns anything from it.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return done()
  if (!views.consume(clientIp(request.headers) ?? "unknown").ok) return done()
  if (Number(request.headers.get("content-length") ?? 0) > 2048) return done()
  try {
    const body = report.safeParse(JSON.parse((await request.text()).slice(0, 2048)))
    if (body.success) await recordView(body.data, request.headers)
  } catch (error) {
    if (!(error instanceof SyntaxError)) console.error("[analytics] view not counted", errorForLog(error))
  }
  return done()
}
