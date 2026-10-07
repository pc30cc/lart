# Deployment checklist (Coolify)

Steps for installing Lart on the production server. The full Coolify setup
(Dockerfile, services, backups) is added when we deploy; this list grows with
it. Do every step marked **required**.

## Before the first deploy

- [ ] **Environment variables** in Coolify (never in the code): `DATABASE_URL`,
      `APP_URL` (https, no trailing slash), `ENCRYPTION_KEY` (32 bytes, base64:
      `openssl rand -base64 32`; keep a safe copy: without it encrypted ID
      numbers and signed contracts cannot be read), `RESEND_API_KEY`,
      `EMAIL_FROM`.
- [ ] **Resend:** verify the sending domain (SPF / DKIM) before the first email.

## Right after each deploy

- [ ] `pnpm db:migrate`

## Once, right after the first deploy (required)

- [ ] `pnpm db:seed` — default terms and contract templates.
- [ ] `pnpm admin:create` — the first super admin (at most 3 partners).
- [ ] **`pnpm contracts:encrypt`** — encrypts any signed contract text stored
      as plain text (it contains the instructor's ID number). First run
      `pnpm contracts:encrypt --dry-run`, then `pnpm contracts:encrypt`. It
      must run with the same `ENCRYPTION_KEY` as the app; it checks the key
      first and refuses a wrong one. Safe to run again. Details:
      [DEVELOPMENT.md → Encrypting older signed contract texts](DEVELOPMENT.md#encrypting-older-signed-contract-texts-once).

## Scheduled tasks (Coolify)

- [ ] `pnpm jobs` every 15 minutes (go / no-go decision reminders; more jobs
      are added in phase 2).

## In the super-admin panel after the first login

- [ ] Settings → brand name, default language, SEO.
- [ ] Settings → storage: Bunny or Cloudflare, then "Test connection".
- [ ] Settings → watermark: upload the logo (gallery photos are refused until
      there is one).
- [ ] Money → partners: profit shares add up to 100 %.
