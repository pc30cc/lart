import "server-only"
import { z } from "zod"

/** Server environment, validated once at startup. Secrets live only here. */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(20).default(5),
  /** Public base URL of the site, e.g. https://example.com (no trailing slash). */
  APP_URL: z.string().url(),
  /** 32 bytes, base64. Encrypts private fields and stored provider keys. */
  ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64"),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
})

export const env = schema.parse(process.env)
