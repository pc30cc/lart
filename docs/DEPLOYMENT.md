# Deployment checklist (Coolify)

Steps for installing Lart on the production server. The full Coolify setup
(Dockerfile, services, backups) is added when we deploy; this list grows with
it. Do every step marked **required**.

## Before the first deploy

- [ ] **Environment variables** in Coolify (never in the code): `DATABASE_URL`,
      `APP_URL` (https, no trailing slash), `ENCRYPTION_KEY` (32 bytes, base64:
      `openssl rand -base64 32`; keep a safe copy: without it encrypted ID
      numbers and signed contracts cannot be read). Optional:
      `RESEND_API_KEY`, `EMAIL_FROM` (used only while Settings → Email is
      not saved).
- [ ] **Email:** in **Settings → Email** choose Resend (verify the sending
      domain there: SPF / DKIM) or an SMTP server (SPF, DKIM, DMARC and a
      matching reverse DNS for the server's IP), enter the sender address,
      then **Send a test email**. **Required before inviting instructors:**
      an instructor can only get into the panel through the invitation email
      (or sign up on their own and confirm their email), and students need
      the "confirm your email" link. Without a working provider nothing is
      sent in production (each email fails and is logged).

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

## Production (limer.tr)

Moving on 2026-10-07 from `analyticsme.site` to the Coolify on **vps-50cc1602**
(`192.99.68.134`, Intel Haswell: sharp and photo uploads work there).

- Project **Limer**: application **LimerLanding** (Dockerfile build, port 3000,
  domains `limer.tr` and `www.limer.tr` behind Cloudflare) and database
  **LimerPostgres** (PostgreSQL 18, internal only). GitHub App "Limer" (the
  same app as on the old Coolify) gives access to `pc30cc/lart`.
- Environment variables, the `/app/.data` volume and the `pnpm jobs` task
  (every 15 minutes) are set in Coolify. `ENCRYPTION_KEY` is the one from the
  first install (checked equal by hash after the move): never change it.
  No email provider is set yet: until one is saved in Settings → Email (or
  `RESEND_API_KEY` is set), no email is sent.
- The database was moved with `pg_dump -Fc` / `pg_restore --no-owner`; the
  old server keeps its copy until the move is confirmed.
- Done on the first deploy: migrations, `pnpm db:seed`, and
  `pnpm contracts:encrypt` (dry run and run: 0 contracts).
- Cutover: point the Cloudflare A records of `limer.tr` and `www.limer.tr` to
  `192.99.68.134` (proxied, SSL mode "Full" until the new server has its
  certificate), then enable the `jobs` task here (created disabled, so
  reminders are not sent twice) and stop LimerLanding on the old server. The GitHub App's webhook still points to the old
  Coolify, so a push does not deploy here by itself: use the Deploy button
  (or point the app's webhook to this Coolify).
