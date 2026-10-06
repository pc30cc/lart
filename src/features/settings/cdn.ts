import "server-only"
import type { z } from "zod"

import { encrypt } from "@/lib/crypto"
import { UserError } from "@/lib/errors"
import { settingSchemas, type SettingValue } from "@/lib/settings"
import { cdnSecretFields, type CdnView, type cdnSettingsSchema } from "./schema"

type CdnConfig = SettingValue<"cdn">
type CdnInput = z.output<typeof cdnSettingsSchema>

/** Stored keys are named `<field>Enc` and hold lib/crypto ciphertext. */
const ENC = "Enc"

/**
 * The saved setting as the browser may see it: every plain field, and only
 * the names of the keys that are saved. Neither a key nor its ciphertext ever
 * leaves the server.
 */
export function cdnView(config: CdnConfig): CdnView {
  const values: Record<string, string> = {}
  const saved: string[] = []
  for (const [field, value] of Object.entries(config)) {
    if (field === "provider") continue
    if (field.endsWith(ENC)) {
      if (value) saved.push(field.slice(0, -ENC.length))
    } else values[field] = String(value)
  }
  return { provider: config.provider, values, saved }
}

/**
 * The setting to store for the submitted form: new keys are encrypted, an
 * empty key field keeps the saved key of the same provider. `replaced` lists
 * the key fields that were given a new value (names only, for the audit log).
 */
export function buildCdnConfig(input: CdnInput, current: CdnConfig): { config: CdnConfig; replaced: string[] } {
  if (input.provider === "local") return { config: { provider: "local" }, replaced: [] }

  const stored = current as Record<string, unknown>
  const secrets: readonly string[] = cdnSecretFields[input.provider]
  const config: Record<string, string> = {}
  const replaced: string[] = []
  for (const [field, value] of Object.entries(input) as [string, string][]) {
    if (!secrets.includes(field)) {
      config[field] = value
      continue
    }
    const enc = `${field}${ENC}`
    const kept = current.provider === input.provider ? stored[enc] : undefined
    if (value) {
      config[enc] = encrypt(value)
      replaced.push(field)
    } else if (typeof kept === "string" && kept) {
      config[enc] = kept
    } else {
      throw new UserError("settings.storage.errors.keyRequired", { field })
    }
  }
  return { config: settingSchemas.cdn.parse(config), replaced }
}

