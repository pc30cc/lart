import "server-only"

import { requireAdmin } from "@/lib/auth/admin"
import { getSetting } from "@/lib/settings"
import { privateUrl } from "@/lib/storage/shared"
import { cdnView } from "./cdn"
import { emailView } from "./email"
import type { CdnView, EmailView } from "./schema"

/** Brand, default language, SEO defaults and theme. */
export async function getGeneralSettings() {
  await requireAdmin()
  const [brand, defaultLocale, seo, theme] = await Promise.all([
    getSetting("brand"),
    getSetting("defaultLocale"),
    getSetting("seo"),
    getSetting("theme"),
  ])
  return { brand, defaultLocale, seo, theme }
}

/** The storage setting without any key (see `cdnView`). */
export async function getStorageSettings(): Promise<CdnView> {
  await requireAdmin()
  return cdnView(await getSetting("cdn"))
}

/** The watermark setting, with the admin-only URL of the logo. */
export async function getWatermarkSettings() {
  await requireAdmin()
  const watermark = await getSetting("watermark")
  return { ...watermark, logoUrl: watermark.logoPath ? privateUrl(watermark.logoPath) : null }
}

/** The email setting without any key or password (see `emailView`). */
export async function getEmailSettings(): Promise<EmailView> {
  await requireAdmin()
  return emailView(await getSetting("email"))
}
