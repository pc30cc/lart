import { timingSafeEqual } from "node:crypto"

import { handleTelegramUpdate } from "@/features/telegram/admin-notices"
import { errorForLog } from "@/lib/errors"
import { isMaintenance } from "@/lib/maintenance"
import { getSetting } from "@/lib/settings"

/** Updates are small: a message or a button press. */
const MAX_BYTES = 64 * 1024

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

/**
 * The admins' bot (Settings → Telegram → Admins): Telegram posts each update
 * here with the secret set by `connectBot` in X-Telegram-Bot-Api-Secret-Token;
 * anything else is refused. Always answers 200 to Telegram once accepted, so a
 * failed update is not sent again and again.
 */
export async function POST(request: Request) {
  const { secret } = await getSetting("telegramAdmins")
  const given = request.headers.get("x-telegram-bot-api-secret-token") ?? ""
  if (!secret || !same(given, secret)) return new Response(null, { status: 401 })
  // Maintenance: buttons pressed in Telegram change nothing (acknowledged, so Telegram does not send them again).
  if (await isMaintenance()) return new Response(null, { status: 200 })
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) return new Response(null, { status: 413 })
  const update = await request.json().catch(() => null)
  if (!update || typeof update !== "object") return new Response(null, { status: 400 })
  try {
    await handleTelegramUpdate(update)
  } catch (err) {
    console.error("[telegram webhook]", errorForLog(err))
  }
  return Response.json({ ok: true })
}
