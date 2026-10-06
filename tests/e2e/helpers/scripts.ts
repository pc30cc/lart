import { execFileSync } from "node:child_process"
import path from "node:path"

import { MAIL_LOG } from "./app"
import { E2E_DATABASE_URL } from "./db"

const ROOT = path.resolve(__dirname, "../../..")

/** Run one of the helper scripts with tsx against the e2e database; returns its JSON output. */
function runScript<T>(script: string, args: string[]): T {
  const out = execFileSync(path.join(ROOT, "node_modules/.bin/tsx"), [path.join(__dirname, script), ...args], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_URL: E2E_DATABASE_URL,
      // Emails from the script go to the same fake Resend API as the server's, when it runs.
      ...(process.env.E2E_RESEND_BASE_URL !== "off"
        ? { RESEND_API_KEY: "re_e2e_fake", RESEND_BASE_URL: process.env.E2E_RESEND_BASE_URL ?? "http://127.0.0.1:3199", EMAIL_FROM: "Lart <noreply@lart.test>" }
        : {}),
      E2E_MAIL_LOG: MAIL_LOG,
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  const last = out.trim().split("\n").pop() ?? "null"
  return JSON.parse(last) as T
}

export type SignResult = { contractId: string; courseId: string; sha256: string; adminsNotified: number }

/** The instructor signs the contract (phase-2 instructor panel stand-in). */
export function signContract(contractId: string, signedName: string, locale = "en"): SignResult {
  return runScript<SignResult>("sign-contract.ts", [contractId, signedName, locale])
}

/** Post the payments of these registrations to the ledger (phase-2 payment stand-in). */
export function payRegistrations(ids: string[]): string[] {
  return runScript<string[]>("pay-registrations.ts", ids)
}
