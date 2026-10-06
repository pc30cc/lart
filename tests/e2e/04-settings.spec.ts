import sharp from "sharp"

import { expect, field, fillLocalized, RUN, test, toast } from "./helpers/app"
import { one, sql } from "./helpers/db"
import { makeLogo } from "./helpers/files"

const BRAND = { fa: `لارت ${RUN}`, tr: `Lart Atölye ${RUN}`, en: `Lart Studio ${RUN}` }

test.describe.serial("settings", () => {
  test("general: brand name, default language, SEO", async ({ page, browser }) => {
    await page.goto("/en/admin/settings")
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible()
    const save = page.getByRole("button", { name: "Save changes" })
    await expect(save).toBeDisabled()

    await fillLocalized(page, "Brand name", BRAND)
    await field(page, /^Language/).getByRole("radio", { name: "English" }).click()
    await fillLocalized(page, /^Title/, { fa: "کارگاه‌های هنری", tr: "Sanat atölyeleri", en: "Art workshops" })
    await fillLocalized(page, /^Description/, {
      fa: "کارگاه‌های هنری در استانبول.",
      tr: "İstanbul’da sanat ve el işi atölyeleri.",
      en: "Arts and crafts workshops in Istanbul.",
    })
    await expect(save).toBeEnabled()
    await save.click()
    await expect(toast(page, "Settings saved.")).toBeVisible()
    await expect(save).toBeDisabled()

    const rows = await sql<{ key: string; value: unknown }>("select key, value from settings where key in ('brand','defaultLocale','seo')")
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    expect(byKey.brand).toEqual(BRAND)
    expect(byKey.defaultLocale).toBe("en")
    expect(JSON.stringify(byKey.seo)).toContain("Arts and crafts workshops in Istanbul.")

    // The new brand shows in the panel and on the login page.
    await page.reload()
    await expect(page.getByText(BRAND.en).first()).toBeVisible()
    const fresh = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const anon = await fresh.newPage()
    await anon.goto("/tr/admin/login")
    await expect(anon.getByText(BRAND.tr).first()).toBeVisible()
    // "/" goes to the default language when there is no language cookie.
    const root = await anon.request.get("/", { maxRedirects: 0, headers: { cookie: "" } })
    expect(root.headers()["location"]).toMatch(/\/en\/?$/)
    await fresh.close()
  })

  test("storage: local provider and connection test", async ({ page }) => {
    await page.goto("/en/admin/settings/storage")
    await expect(page.getByRole("radio", { name: /This server/ })).toBeChecked()
    await expect(page.getByText("Files are kept in the .data folder on this server.")).toBeVisible()
    await page.getByRole("button", { name: "Test connection" }).click()
    await expect(page.getByText(/^Connected\./)).toBeVisible({ timeout: 30_000 })
  })

  test("watermark: logo upload, live preview, save", async ({ page }) => {
    const logo = await makeLogo()
    const existing = await sql("select 1 from settings where key = 'watermark' and value->>'logoPath' is not null")
    await page.goto("/en/admin/settings/watermark")
    // No on/off switch: every gallery photo is watermarked, and uploads wait for a logo.
    await expect(page.getByRole("switch")).toHaveCount(0)
    const noLogo = page.getByText("Add a logo: gallery photos can’t be uploaded until there is one.")
    if (!existing.length) {
      await expect(page.getByText("Add a logo to see the preview.")).toBeVisible()
      await expect(noLogo).toBeVisible()
    }

    const logoField = field(page, "Watermark logo")
    await logoField.locator('input[type="file"]').setInputFiles(logo)
    await expect(logoField.getByRole("img", { name: "Uploaded photo" })).toBeVisible({ timeout: 30_000 })
    await expect(noLogo).toHaveCount(0)

    // The preview appears and follows the controls.
    const preview = page.getByRole("img", { name: "A sample photo with the watermark" })
    await expect(preview).toBeVisible()
    await expect.poll(async () => (await preview.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)) || 0).toBeGreaterThan(0)
    const before = await preview.getAttribute("src")
    expect(before).toContain("/api/admin/media/watermark-preview?")

    await page.getByRole("radio", { name: "Bottom left" }).click()
    await field(page, /^Size/).locator('input[type="range"]').fill("30")
    await field(page, /^Opacity/).locator('input[type="range"]').fill("0.8")
    await expect.poll(() => preview.getAttribute("src")).toContain("position=bottom-left")
    await expect.poll(() => preview.getAttribute("src")).toContain("sizePct=30")
    const src = (await preview.getAttribute("src"))!
    const res = await page.request.get(src)
    expect(res.status()).toBe(200)
    expect(res.headers()["content-type"]).toMatch(/^image\//)
    expect((await sharp(await res.body()).metadata()).width).toBeGreaterThan(100)

    // Save: the gallery uploads in 07-gallery need this logo.
    await page.getByRole("button", { name: "Save changes" }).click()
    await expect(toast(page, "Settings saved.")).toBeVisible()

    const saved = await one<{ value: { position: string; sizePct: number; logoPath: string } }>(
      "select value from settings where key = 'watermark'",
    )
    expect(saved.value).toMatchObject({ position: "bottom-left", sizePct: 30 })
    expect(saved.value).not.toHaveProperty("enabled")
    expect(saved.value.logoPath).toMatch(/^brand\/\d{4}-\d{2}\/[\w-]+\.png$/)

    // The logo is private: not under /media.
    const publicTry = await page.request.get(`/media/${saved.value.logoPath}`)
    expect(publicTry.status()).toBe(404)

    // After a reload the saved logo is shown again.
    await page.reload()
    await expect(field(page, "Watermark logo").getByRole("img", { name: "Uploaded photo" })).toBeVisible()
    await expect(preview).toBeVisible()
  })
})

test.describe.serial("templates", () => {
  test("list shows both kinds with their default", async ({ page }) => {
    await page.goto("/en/admin/templates")
    await expect(page.getByRole("heading", { name: "Registration terms" }).first()).toBeVisible()
    await expect(page.getByRole("heading", { name: "Instructor contract" }).first()).toBeVisible()
    await expect(page.getByText("Default", { exact: true })).toHaveCount(2)
  })

  test("edit the default terms, preview with the brand name", async ({ page }) => {
    const { id } = await one<{ id: string }>("select id from templates where kind = 'terms' and is_default")
    await page.goto(`/en/admin/templates/${id}`)
    const save = page.getByRole("button", { name: "Save changes" })
    await expect(save).toBeDisabled()
    const en = field(page, /^Text/).locator('textarea[lang="en"]')
    await field(page, /^Text/).getByRole("tab", { name: "English" }).click()
    const original = await en.inputValue()
    expect(original).toContain("{brand}")
    await en.fill(`${original}\n\n- Please bring a smile. (${RUN})`)
    await expect(save).toBeEnabled()

    await page.getByRole("button", { name: "Preview" }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toContainText(BRAND.en)
    await expect(dialog).not.toContainText("{brand}")
    await expect(dialog).toContainText(`Please bring a smile. (${RUN})`)
    await page.keyboard.press("Escape")

    await save.click()
    await expect(toast(page, "Changes saved.")).toBeVisible()
    const row = await one<{ body: { en: string } }>("select body from templates where id = $1", [id])
    expect(row.body.en).toContain(`Please bring a smile. (${RUN})`)
  })

  test("email texts: change one, see it in the preview, save, then go back to the default", async ({ page }) => {
    await page.goto("/en/admin/templates")
    await expect(page.getByRole("heading", { name: "Emails" })).toBeVisible()
    await page.getByRole("link", { name: "Contract ready to sign" }).click()
    await expect(page).toHaveURL(/\/en\/admin\/templates\/emails\/contract_ready$/)
    await expect(page.getByRole("heading", { level: 1, name: "Contract ready to sign" })).toBeVisible()
    await expect(page.getByText("{instructorName}", { exact: true })).toBeVisible()

    const heading = field(page, /^Heading/)
    await heading.getByRole("tab", { name: "English" }).click()
    const input = heading.locator('input[lang="en"]')
    // An empty field shows the default text it falls back to.
    await expect(input).toHaveAttribute("placeholder", /\S/)
    await input.fill(`Ready for you, {instructorName} (${RUN})`)
    // Read from the srcdoc: looking inside the sandboxed frame makes the browser log blocked scripts.
    const preview = page.locator('iframe[title="Preview of the email"]')
    await expect.poll(async () => (await preview.getAttribute("srcdoc")) ?? "", { timeout: 15_000 }).toContain(`Ready for you, Ayşe Demir (${RUN})`)

    // An unknown placeholder is explained, and not saved.
    const button = field(page, /^Button/)
    await button.getByRole("tab", { name: "English" }).click()
    await button.locator('input[lang="en"]').fill("{signLink}")
    await expect(page.getByText("{signLink} isn’t a placeholder of this email.", { exact: false }).first()).toBeVisible({ timeout: 15_000 })
    await button.locator('input[lang="en"]').fill("")

    await page.getByRole("button", { name: "Save changes" }).click()
    await expect(toast(page, "Email texts saved.")).toBeVisible()
    const saved = await one<{ value: Record<string, unknown> }>("select value from settings where key = 'emailTexts'")
    expect(saved.value).toEqual(expect.objectContaining({ contract_ready: { heading: { en: `Ready for you, {instructorName} (${RUN})` } } }))

    await page.goto("/en/admin/templates")
    await expect(page.getByRole("listitem").filter({ hasText: "Contract ready to sign" })).toContainText("Edited · English")

    // Back to the default texts (the workshop specs check the real contract emails).
    await page.getByRole("link", { name: "Contract ready to sign" }).click()
    await page.getByRole("button", { name: "Use the default texts" }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "Yes, use the default texts" }).click()
    await expect(toast(page, "The default texts are used again.")).toBeVisible()
    const after = await one<{ value: Record<string, unknown> }>("select value from settings where key = 'emailTexts'")
    expect(after.value).not.toHaveProperty("contract_ready")
    await expect(page.getByText("Default texts", { exact: true })).toBeVisible()
  })

  test("an unknown placeholder is flagged", async ({ page }) => {
    const { id } = await one<{ id: string }>("select id from templates where kind = 'contract' and is_default")
    await page.goto(`/en/admin/templates/${id}`)
    await field(page, /^Text/).getByRole("tab", { name: "English" }).click()
    const en = field(page, /^Text/).locator('textarea[lang="en"]')
    await en.fill(`${await en.inputValue()}\n{instructor_nmae}`)
    await expect(page.getByText("Some placeholders aren’t recognised")).toBeVisible()
    await page.getByRole("button", { name: "Save changes" }).click()
    // Not saved.
    const row = await one<{ body: { en: string } }>("select body from templates where id = $1", [id])
    expect(row.body.en).not.toContain("{instructor_nmae}")
  })

  test("copy a template, make it the default, switch back, delete the copy", async ({ page }) => {
    const { id } = await one<{ id: string }>("select id from templates where kind = 'terms' and is_default")
    await page.goto(`/en/admin/templates/new?from=${id}`)
    await field(page, /^Name/).getByRole("textbox").fill(`Summer terms ${RUN}`)
    await page.getByRole("button", { name: "Create template" }).click()
    await expect(toast(page, "Template created.")).toBeVisible()
    const copy = await one<{ id: string }>("select id from templates where name = $1", [`Summer terms ${RUN}`])

    await page.goto(`/en/admin/templates/${copy.id}`)
    await page.getByRole("button", { name: "Make default" }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "Yes, make default" }).click()
    await expect(toast(page, "The default has been changed.")).toBeVisible()
    expect((await one<{ id: string }>("select id from templates where kind = 'terms' and is_default")).id).toBe(copy.id)

    // Back to the original default from the list menu.
    await page.goto("/en/admin/templates")
    const card = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: "Kayıt ve iptal koşulları" }) })
    await card.getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitem", { name: "Make default" }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "Yes, make default" }).click()
    await expect(toast(page, "The default has been changed.")).toBeVisible()
    expect((await one<{ id: string }>("select id from templates where kind = 'terms' and is_default")).id).toBe(id)

    await page.goto(`/en/admin/templates/${copy.id}`)
    await page.getByRole("button", { name: "Delete template" }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "Yes, delete" }).click()
    await expect(toast(page, "Template deleted.")).toBeVisible()
    expect(await sql("select 1 from templates where id = $1", [copy.id])).toHaveLength(0)
  })
})
