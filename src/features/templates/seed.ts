/**
 * Default templates for a fresh database (`pnpm db:seed`, tests). No
 * "server-only" imports: this also runs from a plain Node script.
 */
import { readFileSync } from "node:fs"
import { eq, sql } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"

import type * as schema from "@/db/schema"
import { auditLog, settings, templates, type Locale } from "@/db/schema"
import type { TemplateKind } from "./placeholders"

const LOCALES = ["fa", "tr", "en"] as const

/** The default texts in `defaults/<name>.<locale>.md`. `consent` has no template kind (yet). */
export type DefaultText = TemplateKind | "consent"

/** A default text in all three languages. */
export function defaultText(name: DefaultText): Record<Locale, string> {
  const read = (l: Locale) => readFileSync(new URL(`./defaults/${name}.${l}.md`, import.meta.url), "utf8").trim()
  return { fa: read("fa"), tr: read("tr"), en: read("en") }
}

/** Template names are plain text, written in the site's default language. */
const names: Record<TemplateKind, Record<Locale, string>> = {
  terms: { fa: "شرایط ثبت‌نام و انصراف", tr: "Kayıt ve iptal koşulları", en: "Registration and cancellation terms" },
  contract: { fa: "قرارداد مدرس", tr: "Eğitmen sözleşmesi", en: "Instructor contract" },
}

/**
 * Insert the default terms and contract templates, each only when its kind
 * has no default template yet. Idempotent and safe to run concurrently: the
 * partial unique index (one default per kind) turns a second insert into a no-op.
 */
export async function seedDefaults(db: NodePgDatabase<typeof schema>): Promise<{ inserted: TemplateKind[] }> {
  const [setting] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "defaultLocale"))
  const locale = LOCALES.find((l) => l === setting?.value) ?? "tr"

  return db.transaction(async (tx) => {
    const inserted: TemplateKind[] = []
    for (const kind of ["terms", "contract"] as const) {
      const values = { kind, name: names[kind][locale], body: defaultText(kind), isDefault: true }
      const [row] = await tx
        .insert(templates)
        .values(values)
        .onConflictDoNothing({ target: templates.kind, where: sql`${sql.identifier("is_default")}` })
        .returning({ id: templates.id })
      if (!row) continue
      inserted.push(kind)
      await tx.insert(auditLog).values({
        adminId: null,
        action: "template.create",
        entity: "template",
        entityId: row.id,
        data: { ...values, seeded: true },
      })
    }
    return { inserted }
  })
}
