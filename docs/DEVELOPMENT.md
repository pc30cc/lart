# Development guide

How the code is organised and the rules every change follows. The product
brief is the [README](../README.md).

## Local setup

```sh
pnpm install
cp .env.example .env            # fill ENCRYPTION_KEY: openssl rand -base64 32
pnpm db:migrate                 # needs a local PostgreSQL (DATABASE_URL)
pnpm admin:create               # first super admin (interactive)
pnpm dev
```

Checks: `pnpm typecheck`, `pnpm lint`, `pnpm test` (uses the `lart_test`
database: `pnpm db:test:migrate` first), `pnpm build`.

## Stack

Next.js 16 (App Router, `proxy.ts` instead of middleware, async `params`),
React 19, TypeScript, Tailwind CSS 4, shadcn/ui (radix base, nova style,
ported into `src/components/ui`), Drizzle ORM + PostgreSQL, next-intl,
Zod, React Hook Form, Recharts, Resend + React Email, sharp.

Next.js 16 differs from older versions: read the relevant guide in
`node_modules/next/dist/docs/` before using an API.

## Layout

```
src/
  app/
    page.tsx                    root: redirects to the default language (setting)
    [locale]/
      admin/login/              super-admin login (no panel chrome)
      admin/(panel)/<module>/   super-admin pages, one folder per module
  components/
    ui/                         shadcn/ui primitives (do not edit casually)
    admin/                      shared admin building blocks (shell, page header, forms)
  db/
    schema.ts                   the whole schema (single source of truth)
    index.ts                    db client, Tx type
  features/<module>/            server logic of a module: queries, actions, schemas, tests
  i18n/                         routing, request config, namespaces
  lib/                          cross-cutting helpers (env, crypto, money, auth, audit, storage, email)
messages/<locale>/<ns>.json     translations, one file per module namespace
drizzle/                        SQL migrations (generated + custom guards)
```

## Rules

### Security (first, always)

- Every server action and route handler starts with an authorization check
  (`requireAdmin()` for the super-admin panel). Never rely on the UI hiding
  something. Never trust ids, amounts or roles sent by the browser.
- Validate every input with Zod on the server.
- Only Drizzle query builders or `sql` template tags (parameterised). No
  string-built SQL.
- Private instructor data (official name, ID number, mobile, email) never
  reaches the public site. The ID number is stored encrypted
  (`lib/crypto.ts`) and only decrypted for contracts and admins.
- Every super-admin mutation writes an audit entry (`lib/audit.ts`).
- Secrets only from `lib/env.ts` (environment) or encrypted settings.

### Money

- Integer kuruş everywhere (`lib/money.ts`). Parse user input with
  `parseLira`, display with `formatLira`. Never floats.
- Every movement of money is a balanced ledger transaction (double entry).
  The database rejects unbalanced transactions and any UPDATE/DELETE of
  ledger rows; a correction is a reversal transaction.

### Lean code and database

- No new tables, columns or dependencies without a clear need.
- A value lives in one place. Workshop fields shared with the contract are
  stored on the workshop only.
- Translatable text is one `jsonb` column `{ fa, tr, en }` (`LocalizedText`).
- Schema changes: edit `src/db/schema.ts`, then `pnpm db:generate`.

### Text and languages

- No hard-coded user-facing text: use next-intl messages, in all three
  languages (fa, tr, en). Each module owns `messages/<locale>/<ns>.json`.
- The brand name is never hard-coded: it comes from the `brand` setting and
  appears as `{brand}` in templates.
- Persian is RTL: use logical Tailwind classes (`ms-`, `me-`, `ps-`, `pe-`,
  `start-`, `end-`, `text-start`) instead of left/right.

### UX

Students and instructors are mostly non-technical. Screens are simple and
friendly: one main action, large buttons, short sentences, few fields,
helpful messages instead of technical errors, phone first. The super-admin
panel is premium and calm: clean cards, clear tables, beautiful charts.
