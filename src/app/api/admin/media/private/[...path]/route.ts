import { requireAdminApi } from "@/lib/auth/admin"
import { isSafePath, mediaContentType, readPrivate } from "@/lib/storage"

/** A private file (unwatermarked original, watermark logo). Super admins only. */
export async function GET(request: Request, ctx: RouteContext<"/api/admin/media/private/[...path]">) {
  if (!(await requireAdminApi(request))) return new Response(null, { status: 401 })

  const path = (await ctx.params).path.join("/")
  const contentType = mediaContentType(path)
  if (!isSafePath(path) || !contentType) return new Response(null, { status: 404 })

  const file = await readPrivate(path)
  if (!file) return new Response(null, { status: 404 })
  const headers = new Headers({
    "Content-Type": contentType,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  })
  if (file.size !== null) headers.set("Content-Length", String(file.size))
  return new Response(file.body, { headers })
}
