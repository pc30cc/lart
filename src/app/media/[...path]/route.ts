import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { Readable } from "node:stream"

import { getSetting } from "@/lib/settings"
import { isSafePath, mediaContentType } from "@/lib/storage"
import { IMMUTABLE } from "@/lib/storage/driver"
import { localDriver } from "@/lib/storage/local"

const notFound = () => new Response(null, { status: 404 })

/**
 * Files of the local (development) storage, ./.data/public. With Bunny or
 * Cloudflare the CDN serves them and this route answers 404.
 */
export async function GET(request: Request, ctx: RouteContext<"/media/[...path]">) {
  if ((await getSetting("cdn")).provider !== "local") return notFound()

  const path = (await ctx.params).path.join("/")
  const contentType = mediaContentType(path)
  if (!isSafePath(path) || !contentType) return notFound()
  const file = localDriver().file(path)
  const info = await stat(file).catch(() => null)
  if (!info?.isFile() || info.size === 0) return notFound()

  const headers = new Headers({
    "Content-Type": contentType,
    "Cache-Control": IMMUTABLE,
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
  })
  // One byte range at most, so videos can seek (Safari needs it to play at all).
  let start = 0
  let end = info.size - 1
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "")
  if (range && (range[1] || range[2])) {
    start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]))
    if (range[1] && range[2]) end = Math.min(Number(range[2]), end)
    if (start > end) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${info.size}` } })
    }
    headers.set("Content-Range", `bytes ${start}-${end}/${info.size}`)
  }
  headers.set("Content-Length", String(end - start + 1))
  const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream<Uint8Array>
  return new Response(body, { status: headers.has("Content-Range") ? 206 : 200, headers })
}
