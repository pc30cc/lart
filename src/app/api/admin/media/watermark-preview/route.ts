import type { NextRequest } from "next/server"
import { z } from "zod"

import { requireAdminApi } from "@/lib/auth/admin"
import { renderWatermarkPreview } from "@/lib/images"
import { getSetting, settingSchemas } from "@/lib/settings"
import { isSafePath, read } from "@/lib/storage"

const shape = settingSchemas.watermark.shape
const querySchema = z.object({
  position: shape.position.optional(),
  sizePct: z.coerce.number().pipe(shape.sizePct).optional(),
  opacity: z.coerce.number().pipe(shape.opacity).optional(),
  marginPct: z.coerce.number().pipe(shape.marginPct).optional(),
  /** Storage path of a logo not saved yet (just uploaded with purpose watermark_logo). */
  logo: z.string().refine(isSafePath).optional(),
})

/**
 * Live preview for the watermark settings: a sample photo with the logo.
 * Query values override the saved setting, e.g.
 * /api/admin/media/watermark-preview?position=tiled&sizePct=20&opacity=0.6&marginPct=3
 */
export async function GET(request: NextRequest) {
  if (!(await requireAdminApi(request))) return new Response(null, { status: 401 })
  const query = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams))
  if (!query.success) return new Response(null, { status: 400 })

  const saved = await getSetting("watermark")
  const { logo: logoPath = saved.logoPath, ...overrides } = query.data
  const settings = { ...saved }
  for (const [key, value] of Object.entries(overrides)) if (value !== undefined) Object.assign(settings, { [key]: value })

  const file = logoPath ? await read(logoPath).catch(() => null) : null
  const logo = file ? Buffer.from(await new Response(file.body).arrayBuffer()) : null
  const image = await renderWatermarkPreview(settings, logo).catch(() => renderWatermarkPreview(settings, null))
  return new Response(new Uint8Array(image), {
    headers: { "Content-Type": "image/webp", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  })
}
