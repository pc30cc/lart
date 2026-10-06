import sharp from "sharp"

import { expect, test } from "./helpers/app"
import { WORKSHOPS } from "./helpers/data"
import { one, sql } from "./helpers/db"
import { makePhoto, makeVideo } from "./helpers/files"

async function workshopId(slug: string) {
  return (await one<{ id: string }>("select id from courses where slug = $1", [slug])).id
}

/** Mean absolute difference of two equally sized raw RGB buffers inside a box (fractions of the size). */
function diffIn(a: Buffer, b: Buffer, width: number, height: number, box: { x0: number; y0: number; x1: number; y1: number }) {
  let sum = 0
  let n = 0
  for (let y = Math.floor(box.y0 * height); y < Math.floor(box.y1 * height); y++) {
    for (let x = Math.floor(box.x0 * width); x < Math.floor(box.x1 * width); x++) {
      const i = (y * width + x) * 3
      sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
      n += 3
    }
  }
  return sum / n
}

test.describe.serial("gallery", () => {
  test("upload watermarked photos and a video to the closed workshop", async ({ page }) => {
    const id = await workshopId(WORKSHOPS.held.slug)
    const photo1 = await makePhoto("gallery1.jpg", 3200, 2400, 50)
    const photo2 = await makePhoto("gallery2.jpg", 1800, 2700, 160)
    const video = makeVideo("clip.mp4")
    test.info().annotations.push({ type: "video", description: video ?? "no ffmpeg: video skipped" })

    await page.goto(`/en/admin/workshops/${id}/gallery`)
    await expect(page.getByRole("heading", { name: "Photos and videos" })).toBeVisible()
    // Consent reminder: Ayşe (photos + videos), Zeynep (photos), Mina (neither); Leyla never paid.
    await expect(page.getByText("2 of 3 agreed to photos, 1 of 3 to videos.")).toBeVisible()
    await expect(page.getByText("Leyla Demir")).toHaveCount(0)

    // 04-settings saved the watermark logo: without it every gallery photo upload is refused (watermark_missing).
    const logo = await one<{ path: string | null }>("select value->>'logoPath' as path from settings where key = 'watermark'")
    expect(logo.path, "run 04-settings first: gallery photos need a watermark logo").toBeTruthy()

    const input = page.locator('main input[type="file"]')
    await input.setInputFiles([photo1, photo2, ...(video ? [video] : [])])
    const grid = page.locator("main")
    await expect(grid.getByRole("img", { name: /^Photo \d$/ })).toHaveCount(2, { timeout: 90_000 })
    if (video) await expect(grid.locator("video[aria-label^='Video']")).toHaveCount(1, { timeout: 90_000 })
    await expect(page.getByText("All changes saved")).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText("Please add a watermark logo in Settings first.", { exact: false })).toHaveCount(0)

    const rows = await sql<{ kind: string; path: string; original_path: string | null; width: number; height: number; sort: number }>(
      "select kind, path, original_path, width, height, sort from media where course_id = $1 and kind <> 'sample' order by sort",
      [id],
    )
    expect(rows.filter((r) => r.kind === "gallery_photo")).toHaveLength(2)
    expect(rows.filter((r) => r.kind === "gallery_video")).toHaveLength(video ? 1 : 0)
    for (const r of rows.filter((r) => r.kind === "gallery_photo")) {
      expect(r.path).toMatch(/^gallery\/\d{4}-\d{2}\/[\w-]+\.webp$/)
      expect(r.original_path).toBeTruthy()
      expect(Math.max(r.width, r.height)).toBeLessThanOrEqual(2400)
    }
  })

  test("the public URL serves the watermarked photo; the original stays private", async ({ page, browser }) => {
    const id = await workshopId(WORKSHOPS.held.slug)
    const photo = await one<{ path: string; original_path: string; width: number; height: number }>(
      "select path, original_path, width, height from media where course_id = $1 and kind = 'gallery_photo' order by sort limit 1",
      [id],
    )
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    try {
      const pub = await anon.request.get(`/media/${photo.path}`)
      expect(pub.status()).toBe(200)
      expect(pub.headers()["content-type"]).toBe("image/webp")
      const published = await pub.body()
      const meta = await sharp(published).metadata()
      expect(meta.width).toBe(photo.width)
      expect(meta.exif).toBeUndefined()

      // The original: not public, not for strangers, but there for the admin.
      expect((await anon.request.get(`/media/${photo.original_path}`)).status()).toBe(404)
      expect((await anon.request.get(`/api/admin/media/private/${photo.original_path}`)).status()).toBe(401)
      const orig = await page.request.get(`/api/admin/media/private/${photo.original_path}`)
      expect(orig.status()).toBe(200)

      // The watermark is where the settings put it (bottom left, 30 % wide): the published
      // photo differs from the original there, and hardly anywhere else.
      const w = photo.width
      const h = photo.height
      const a = await sharp(published).resize(w, h).removeAlpha().raw().toBuffer()
      const b = await sharp(await orig.body()).rotate().resize(w, h).removeAlpha().raw().toBuffer()
      const corner = diffIn(a, b, w, h, { x0: 0.02, y0: 0.7, x1: 0.35, y1: 0.98 })
      const elsewhere = diffIn(a, b, w, h, { x0: 0.6, y0: 0.05, x1: 0.95, y1: 0.35 })
      test.info().annotations.push({ type: "watermark-diff", description: `bottom-left ${corner.toFixed(2)} vs top-right ${elsewhere.toFixed(2)}` })
      expect(corner).toBeGreaterThan(elsewhere * 3 + 2)

      const video = await sql<{ path: string }>("select path from media where course_id = $1 and kind = 'gallery_video'", [id])
      if (video.length) {
        const res = await anon.request.get(`/media/${video[0].path}`, { headers: { range: "bytes=0-99" } })
        expect(res.status()).toBe(206)
        expect(res.headers()["content-type"]).toMatch(/^video\//)
        expect(res.headers()["content-range"]).toMatch(/^bytes 0-99\/\d+$/)
      }
    } finally {
      await anon.close()
    }
  })

  test("reorder and remove are saved right away", async ({ page }) => {
    const id = await workshopId(WORKSHOPS.held.slug)
    const before = await sql<{ path: string }>("select path from media where course_id = $1 and kind <> 'sample' order by sort", [id])
    await page.goto(`/en/admin/workshops/${id}/gallery`)
    await page.getByRole("button", { name: "Move later: Photo 1" }).click()
    await expect(page.getByText("All changes saved")).toBeVisible()
    await expect
      .poll(async () => (await sql<{ path: string }>("select path from media where course_id = $1 and kind <> 'sample' order by sort", [id]))[0]?.path)
      .toBe(before[1].path)

    await page.getByRole("button", { name: /^Remove: / }).last().click()
    await expect(page.getByText("All changes saved")).toBeVisible()
    await expect.poll(async () => (await sql("select 1 from media where course_id = $1 and kind <> 'sample'", [id])).length).toBe(before.length - 1)
    // The removed file is gone from storage too.
    const after = new Set((await sql<{ path: string }>("select path from media where course_id = $1", [id])).map((r) => r.path))
    const gone = before.find((b) => !after.has(b.path))!
    await expect.poll(async () => (await page.request.get(`/media/${gone.path}`)).status()).toBe(404)

    await page.reload()
    await expect(page.locator("main").getByRole("img", { name: /^Photo \d$/ }).or(page.locator("main video"))).toHaveCount(before.length - 1)
  })
})

// Not part of the serial flow, so a failure here does not stop the rest.
test("a cancelled workshop has no gallery, even after it was closed on its finances page", async ({ page }) => {
  // The pottery workshop was cancelled, then closed from the wallet's "Ready to close" list (06-money).
  const id = await workshopId(WORKSHOPS.cancelled.slug)
  const row = await one<{ status: string; cancelled_at: Date | null }>("select status, cancelled_at from courses where id = $1", [id])
  test.info().annotations.push({ type: "status-after-closing", description: `${row.status}, cancelled_at ${String(row.cancelled_at)}` })
  await page.goto(`/en/admin/workshops/${id}/gallery`)
  await expect(page.getByText("No gallery for a cancelled workshop")).toBeVisible()
  await expect(page.locator('main input[type="file"]')).toHaveCount(0)
})
