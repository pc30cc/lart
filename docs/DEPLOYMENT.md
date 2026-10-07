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
- [ ] `pnpm admin:create` — the first super admin (at most 3 partners). The
      other partners are invited from the panel (Money → Partners).
- [ ] **`pnpm contracts:encrypt`** — encrypts any signed contract text stored
      as plain text (it contains the instructor's ID number). First run
      `pnpm contracts:encrypt --dry-run`, then `pnpm contracts:encrypt`. It
      must run with the same `ENCRYPTION_KEY` as the app; it checks the key
      first and refuses a wrong one. Safe to run again. Details:
      [DEVELOPMENT.md → Encrypting older signed contract texts](DEVELOPMENT.md#encrypting-older-signed-contract-texts-once).

## Once, when deploying the single storage (October 2026)

Until then uploads used two zones: a public one and a private one (gallery
originals, the watermark logo, partners' photos). Now there is one.

- [ ] Nothing to re-enter: the saved storage setting keeps working (its
      private zone fields are ignored, and dropped at the next save of
      Settings → storage).
- [ ] The watermark logo and any partner photos uploaded before are still in
      the **old private zone**, which the app no longer reads. Copy them to
      the same paths in the storage zone (the logo's path is
      `value->>'logoPath'` of the `watermark` row in `settings`, e.g.
      `brand/2026-10/….png`; partners' photos are `admins/…`), or upload the
      logo again (Settings → watermark) and the photos again (My profile).
      Until then gallery photo uploads are refused ("the watermark logo
      couldn't be loaded") and partners show their initials.
- [ ] The unwatermarked gallery originals (`originals/…` in the private
      zone) are no longer used: migration `0007_single_storage` drops their
      paths. Download them first if you want to keep them, then delete the
      private zone (Bunny) or bucket (R2).
- [ ] The migration runs when the new container starts, while the old one
      may still answer for a moment: a gallery or workshop save in that
      moment can fail once; saving again works.

## Scheduled tasks (Coolify)

- [ ] `pnpm jobs` every 15 minutes: go / no-go decision reminders to the
      admins, and the day-before reminders to everyone registered (with what
      is still to pay and how). Same image and environment as the app; exit
      code 1 means a job failed or did not finish (see
      [DEVELOPMENT.md → Jobs](DEVELOPMENT.md#jobs)).

## In the super-admin panel after the first login

- [ ] Settings → brand name, default language, SEO.
- [ ] Settings → storage: **Bunny** (one storage zone with a pull zone
      connected to it: zone name, its password from FTP & API Access, the
      pull zone's hostname) or **Cloudflare** (one R2 bucket with a custom
      domain, an R2 API token with read and write access to it), then "Test
      connection". Everything goes into that one zone / bucket, in folders
      per section (`workshops/…`, `instructors/…`, `partners/…`, `brand/…`).
      A private zone or bucket created for the earlier setup is no longer
      used: once the logo and partners' photos are copied out of it, it can
      be deleted (see
      [Once, when deploying the single storage](#once-when-deploying-the-single-storage-october-2026)
      above).
- [ ] Settings → watermark: upload the logo (gallery photos are refused until
      there is one).
- [ ] Settings → payments: switch on the ways students may pay (cash at the
      workshop, bank transfer, online payment link). For a transfer fill in
      the account holder, bank and IBAN (a transfer without an IBAN is not
      shown); for online payment, add each workshop's iyziLink / PayTR link on
      the workshop form. Every payment is then recorded by an admin in the
      workshop's registrations.
- [ ] Money → partners: invite the other partners ("Invite a partner"; each
      new partner starts at 0 %), then set the profit shares so they add up
      to 100 %.

## Production (limer.tr)

Moved on 2026-10-07 from `analyticsme.site` to the Coolify on **vps-50cc1602**
(`192.99.68.134`, Intel Haswell: sharp and photo uploads work there).

- Project **Limer**: application **LimerLanding** (Dockerfile build, port 3000,
  domains `limer.tr` and `www.limer.tr` behind Cloudflare, health check on
  `/` with curl: the home page in the main language, 200, read from the
  database) and database **LimerPostgres** (PostgreSQL 18, internal
  only). GitHub App "Limer" (the same app as on the old Coolify) gives access
  to `pc30cc/lart`.
- Environment variables, the `/app/.data` volume and the `pnpm jobs` task
  (every 15 minutes) are set in Coolify. `ENCRYPTION_KEY` is the one from the
  first install (checked equal by hash after the move): never change it.
- Emails: choose the provider in Settings → Email (Resend or SMTP). Both are
  saved there, so switching loses nothing; Resend is the active one.
- Own mail server (added 2026-10-07): Coolify service **LimerMail** in the
  Limer project, Postfix relay `boky/postfix:5.1.0` (pinned by digest) with
  DKIM signing (selector `mail`, key in volume `limer-mail-dkim`, queue in
  `limer-mail-spool`; its first log prints the DNS record). No port is
  published: only containers on the `coolify` network reach it, only with
  the SASL user `limer@limer.tr`, and only for `@limer.tr` senders. In
  Settings → Email (SMTP): host `postfix-ofdvg1kjdqrlvn4y1dmopxok`, port 587,
  security "none" (the traffic stays on the server), user `limer@limer.tr`.
  New password: change `SMTPD_SASL_USERS` (`limer@limer.tr:<password>`,
  letters and digits only) in the service, restart it, then enter the same
  password in Settings → Email.
- DNS for the own server (Cloudflare, "DNS only"): `limer.tr` TXT
  `v=spf1 ip4:192.99.68.134 ~all`, `mail._domainkey` TXT (the key above),
  `_dmarc` TXT `v=DMARC1; p=none`. Resend keeps its own records
  (`resend._domainkey`, `send`). Reverse DNS of `192.99.68.134` is OVH's
  `vps-50cc1602.vps.ovh.ca`, also the relay's HELO name (`MAIL_HOSTNAME` in
  the service). On 2026-10-07 the IP was on Barracuda's list (free removal
  at barracudacentral.org) and OVH's whole range on UCEPROTECT level 3, so
  check a message with mail-tester.com before making SMTP the active provider.
- The database was moved with `pg_dump -Fc` / `pg_restore --no-owner`. On the
  old server LimerLanding is stopped (auto-deploy and its task off); its
  LimerPostgres still runs as a backup, with the dump in `/root/limer-move/`.
- Deploys: the GitHub App's webhook must point to this Coolify
  (`http://192.99.68.134:8000/webhooks/source/github/events`) for a push to
  deploy here; otherwise use the Deploy button.
- Addresses follow the [URL rules](DEVELOPMENT.md#url-rules): the main
  language (Settings → General) has no prefix (`limer.tr/workshops`), the
  others are under `/fa` and `/en`. Links sent before (`/tr/…`,
  `/admin/accept-invite`, `/admin/login/reset`, `/instructor/accept-invite`)
  keep working with a permanent redirect (308, not cached). Changing the
  main language needs no redeploy (it applies within 30 seconds).
