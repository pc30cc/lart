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
      **Required before inviting instructors:** an instructor can only get into
      the panel through the invitation email (and later the contract emails),
      and students need the "confirm your email" link to register. Without a
      working `RESEND_API_KEY` nothing is sent in production (each email fails
      and is logged).

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

- [ ] `pnpm jobs` every 15 minutes: go / no-go decision reminders to the
      admins, and the day-before reminders to everyone registered (with what
      is still to pay and how). Same image and environment as the app; exit
      code 1 means a job failed or did not finish (see
      [DEVELOPMENT.md → Jobs](DEVELOPMENT.md#jobs)).

## In the super-admin panel after the first login

- [ ] Settings → brand name, default language, SEO.
- [ ] Settings → storage: Bunny or Cloudflare, then "Test connection".
- [ ] Settings → watermark: upload the logo (gallery photos are refused until
      there is one).
- [ ] Settings → payments: switch on the ways students may pay (cash at the
      workshop, bank transfer, online payment link). For a transfer fill in
      the account holder, bank and IBAN (a transfer without an IBAN is not
      shown); for online payment, add each workshop's iyziLink / PayTR link on
      the workshop form. Every payment is then recorded by an admin in the
      workshop's registrations.
- [ ] Money → partners: profit shares add up to 100 %.

## Production (limer.tr), set up on 2026-10-07

- Coolify on the `analyticsme.site` server: application **LimerLanding** (id 32,
  Dockerfile build, port 3000, domains `limer.tr` and `www.limer.tr` behind
  Cloudflare) and database **LimerPostgres** (PostgreSQL 18, internal only).
- Environment variables, the `/app/.data` volume and the `pnpm jobs` task
  (every 15 minutes) are set in Coolify. `RESEND_API_KEY` is **not set yet**:
  until it is, no email is sent (invitations, email confirmation, password
  reset). The brand setting is Limer / لیمر.
- Done on the first deploy: migrations, `pnpm db:seed`, and
  `pnpm contracts:encrypt` (dry run and run: 0 contracts, nothing to encrypt).
- First super admin: in Coolify open LimerLanding → Terminal, then
  `pnpm admin:create` (email, name, password of at least 12 characters, profit
  share). Sign in at `https://limer.tr/fa/admin/login`.
- **The server's CPU** is a generic `QEMU Virtual CPU 2.5+` without SSE4.1/4.2,
  so sharp (image processing) cannot run there: photo uploads answer
  "processing unavailable" until the VPS CPU type is changed (e.g. to "host")
  or the app moves to a server with a modern CPU. Everything else works.
