import type { Page } from "@playwright/test"

import { expect, fillLocalized, field, RUN, test, toast } from "./helpers/app"
import { one, sql } from "./helpers/db"
import { CATEGORIES } from "./helpers/data"

async function createCategory(page: Page, name: { fa: string; tr: string; en: string }) {
  await page.goto("/en/admin/categories/new")
  await expect(page.getByRole("heading", { level: 1, name: "New category" })).toBeVisible()
  await fillLocalized(page, "Category name", name)
  // The page address follows the Turkish name.
  await expect(field(page, "Page address").getByRole("textbox")).toHaveValue(new RegExp(`-${RUN}$`))
  await page.getByRole("button", { name: "Create category" }).click()
  await expect(toast(page, "Category created.")).toBeVisible()
  await expect(page).toHaveURL(/\/en\/admin\/categories$/)
}

test.describe.serial("categories", () => {
  test("empty form shows the required messages in every language", async ({ page }) => {
    await page.goto("/en/admin/categories/new")
    await page.getByRole("button", { name: "Create category" }).click()
    await expect(page.getByRole("alert").first()).toContainText("Please fill this in.")
    await expect(page).toHaveURL(/\/categories\/new$/)
  })

  test("create candle making, ceramics and a temporary one", async ({ page }) => {
    await createCategory(page, CATEGORIES.candles)
    await createCategory(page, CATEGORIES.ceramics)
    await createCategory(page, CATEGORIES.temp)
    for (const c of Object.values(CATEGORIES)) await expect(page.getByRole("link", { name: c.en })).toBeVisible()
    // Search in the table.
    await page.getByPlaceholder("Search categories…").fill(`Ceramics ${RUN}`)
    await expect(page).toHaveURL(/q=Ceramics/)
    await expect(page.getByRole("link", { name: CATEGORIES.candles.en })).toBeHidden()
    await expect(page.getByRole("link", { name: CATEGORIES.ceramics.en })).toBeVisible()
  })

  test("a duplicate page address is refused on the field", async ({ page }) => {
    await page.goto("/en/admin/categories/new")
    await fillLocalized(page, "Category name", { fa: "تکراری", tr: CATEGORIES.candles.tr, en: "Duplicate" })
    await page.getByRole("button", { name: "Create category" }).click()
    await expect(field(page, "Page address")).toContainText("Another category already uses this page address")
  })

  test("edit ceramics: names and order", async ({ page }) => {
    const { id } = await one<{ id: string }>("select id from categories where slug = $1", [CATEGORIES.ceramics.slug])
    await page.goto(`/en/admin/categories/${id}`)
    await expect(field(page, "Page address").getByRole("textbox")).toHaveValue(CATEGORIES.ceramics.slug)
    await fillLocalized(page, "Category name", { en: `Ceramics and pottery ${RUN}` })
    await field(page, "Order").getByRole("spinbutton").fill("5")
    await page.getByRole("button", { name: "Save changes" }).click()
    await expect(toast(page, "Changes saved.")).toBeVisible()
    await expect(page).toHaveURL(/\/en\/admin\/categories$/)
    await expect(page.getByRole("link", { name: `Ceramics and pottery ${RUN}` })).toBeVisible()
    const row = await one<{ sort: number; name: { en: string } }>("select sort, name from categories where id = $1", [id])
    expect(row.sort).toBe(5)
    expect(row.name.en).toBe(`Ceramics and pottery ${RUN}`)
  })

  test("delete the unused category from the row menu", async ({ page }) => {
    await page.goto(`/en/admin/categories?q=${encodeURIComponent(CATEGORIES.temp.en)}`)
    const row = page.getByRole("row").filter({ hasText: CATEGORIES.temp.en })
    await row.getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitem", { name: "Delete" }).click()
    const dialog = page.getByRole("alertdialog")
    await expect(dialog).toContainText(`Delete “${CATEGORIES.temp.en}”?`)
    await dialog.getByRole("button", { name: "Yes, delete" }).click()
    await expect(toast(page, "Category deleted.")).toBeVisible()
    await expect(row).toBeHidden()
    expect(await sql("select 1 from categories where name->>'en' = $1", [CATEGORIES.temp.en])).toHaveLength(0)
  })

  test("delete from the edit page danger zone", async ({ page }) => {
    await page.goto("/en/admin/categories/new")
    await fillLocalized(page, "Category name", { fa: "حذف", tr: `Silinecek ${RUN}`, en: `To delete ${RUN}` })
    await page.getByRole("button", { name: "Create category" }).click()
    await expect(page).toHaveURL(/\/en\/admin\/categories$/)
    await page.getByRole("link", { name: `To delete ${RUN}` }).click()
    await page.getByRole("button", { name: "Delete category" }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "Yes, delete" }).click()
    await expect(toast(page, "Category deleted.")).toBeVisible()
    await expect(page).toHaveURL(/\/en\/admin\/categories$/)
  })
})
