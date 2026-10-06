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

## Uploads and media

Files live on the CDN chosen in the `cdn` setting (`local` in development:
`./.data/public`, served by `/media/...`, and `./.data/private`). The
database stores only the storage path, e.g. `courses/2026-10/<random>.webp`.

- **Upload from a form** with the components in `components/admin/upload`:
  `<ImageUpload purpose="course_cover" {...field} previewUrl={url} />`,
  `<VideoUpload {...field} />` and `<MediaGrid value onChange />` (many
  photos and videos, reorder, remove). The value is the storage path.
- **Purposes** (`lib/storage/shared.ts`): `instructor_photo` (square 800),
  `course_cover` (2000 wide), `course_sample` (1600), `gallery_photo` (2400,
  watermarked, private unwatermarked original), `watermark_logo` (PNG,
  private), `gallery_video` (MP4 / MOV / WebM as they are, sent in 8 MB parts).
  Images are checked from their bytes, auto-rotated, stripped of all metadata
  (GPS) and re-encoded as WebP.
- **Validate a submitted path** with `isSafePath` (and the expected prefix)
  before saving it; never trust a path from the browser.
- **Show a file**: `(await getStorage()).publicUrl(path)` on the server.
  Private files (originals, logo) only through `privateUrl(path)`, which is
  the admin-only route `/api/admin/media/private/<path>`.
- **Replace or delete**: after saving the record, call `remove(oldPath)`
  (`remove(path, "private")` for originals) from `lib/storage`.
- **Settings page**: `testStorage(cdnConfig)` for "Test connection" (messages
  in `media.storageTest.<step>`), and
  `/api/admin/media/watermark-preview?position=&sizePct=&opacity=&marginPct=&logo=`
  as the live preview image.
- The proxy must not run on `/api/admin/uploads`: Next.js would buffer the
  body there and cut it at 10 MB.

## Building blocks

The core platform every module builds on. The **categories** module
(`src/features/categories`, `src/app/[locale]/admin/(panel)/categories`) uses
all of it: copy its shape for a new module.

```
src/features/<module>/schema.ts    Zod schemas (shared by form and action), table sort/filter lists
src/features/<module>/queries.ts   "server-only" reads; each starts with requireAdmin()
src/features/<module>/actions.ts   "use server"; only adminAction(...) exports
src/app/[locale]/admin/(panel)/<module>/page.tsx, new/page.tsx, [id]/page.tsx, _components/*
src/components/admin/nav.ts        add the module's sidebar entry (already listed for phase 1)
messages/<locale>/<module>.json    fa, tr, en
```

### Routing, layouts, security headers

- `src/app/layout.tsx` renders `<html lang dir>` (rtl for fa), the fonts and the
  theme. `src/app/[locale]/layout.tsx` validates the locale and adds next-intl,
  Radix direction, tooltips and toasts. `/` redirects to the `NEXT_LOCALE`
  cookie's language or the `defaultLocale` setting.
- `src/proxy.ts`: locale routing (`/fa`, `/tr`, `/en`, always prefixed), a
  strict CSP with a per-request nonce, `X-Robots-Tag: noindex` on
  `/<locale>/admin` and `/api/admin`, and an optimistic redirect to the login
  when there is no admin cookie. It skips `_next`, `/media/`,
  `/api/admin/uploads` and paths with a file extension. Static headers (HSTS in
  production, `X-Frame-Options`, nosniff, Referrer-Policy, Permissions-Policy)
  are in `next.config.ts`.
- CSP: scripts need the nonce (Next adds it to its own scripts; for a
  `<Script>` pass `(await headers()).get("x-nonce")`). Images and videos may
  come from any `https:` origin (the CDN); `connect-src`, `frame-src` and
  `form-action` are `'self'`. A module that needs another origin (e.g. a payment
  iframe) adds it in `contentSecurityPolicy()` in `src/proxy.ts`.
- Admin pages are `noindex` (panel layout metadata and the header above).

### Auth

```ts
import { getAdmin, requireAdmin, requireAdminApi, type AdminSession } from "@/lib/auth/admin"

const { admin } = await requireAdmin() // pages, queries, actions: redirects to the login when signed out

export async function POST(request: Request) { // route handlers
  const session = await requireAdminApi(request) // also refuses cross-origin POST/PUT/PATCH/DELETE
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 })
}
```

- Call `requireAdmin()` in **every** admin page and query, not only in the
  layout: layouts are not re-run on client navigation. It is cached per request.
- Sessions live in the `sessions` table (cookie = 256-bit token, database =
  its SHA-256), one cookie per kind (`__Host-admin_session` in production),
  sliding expiry (admin: 12 h idle, 7 days at most; see `sessionPolicy`).
- Reusable for instructors and members (phase 2), all with a `kind` parameter:
  `startSession`, `currentSession`, `endSession`, `deleteSessionsOf`
  (`@/lib/auth/session`); `verifyCredentials(kind, email, password)` with
  lockout after 5 failures for 15 minutes and constant-time behaviour
  (`@/lib/auth/login`); `hashPassword`, `verifyPassword`,
  `PASSWORD_MIN_LENGTH` (`@/lib/auth/password`, Argon2id); `loginRateLimiter`,
  `createRateLimiter` (`@/lib/auth/rate-limit`, in memory, per IP);
  `clientIp(headers)`, `isSameOrigin(request)` (`@/lib/auth/request`). Store
  emails lower-case (`normalizeEmail`). Show one generic message for every
  failed login.
- Admin sign-in / sign-out: `adminLoginAction`, `adminLogoutAction`
  (`@/lib/auth/actions`). First admin: `pnpm admin:create` (at most 3).

### Server actions: `adminAction`

```ts
"use server"
import { revalidatePath } from "next/cache"
import { adminAction, UserError } from "@/lib/action"
import { changes } from "@/lib/audit"
import { PG, pgError } from "@/lib/errors"

export const updateThing = adminAction(thingUpdateSchema, async ({ id, ...input }, ctx) => {
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(things).where(eq(things.id, id)).for("update")
    if (!before) throw new UserError("things.errors.notFound")
    await tx.update(things).set(input).where(eq(things.id, id))
    await ctx.audit({ action: "thing.update", entity: "thing", entityId: id, data: changes(before, input) }, tx)
  }).catch((err) => {
    if (pgError(err)?.code === PG.uniqueViolation) throw new UserError("things.errors.slugTaken", { field: "slug" })
    throw err
  })
  revalidatePath("/[locale]/admin/things", "page")
  return { id }
})
```

- `adminAction(schema, handler)` checks the session, validates the input
  (object or `FormData`; `name.fa` keys become nested objects) and returns
  `ActionResult<T>` = `{ ok: true, data } | { ok: false, error, fieldErrors? }`,
  all text translated. Return only what the UI needs (it goes to the browser).
- `throw new UserError("<namespace>.<key>", { values?, field? })` for expected
  problems; `field` puts the message on that form field. Anything else is
  logged and shown as `common.errors.generic`. `redirect()` / `notFound()` pass through.
- `ctx` = the `AdminSession` plus `ctx.audit(entry, tx?)`.
- Revalidate: `revalidatePath("/[locale]/admin/<module>", "page")` for a page
  the user goes back to; `refresh()` from `next/cache` to re-render the
  current page in the same round trip.
- For phase 2, `runAction(schema, input, run)` is the same without the admin check.

### Audit

`audit({ adminId, action, entity, entityId?, data? }, tx?)` from `@/lib/audit`
writes `audit_log` (with the client IP). Inside actions use `ctx.audit`. Actions
are named `<entity>.<verb>` (`category.create`, `auth.login`). `changes(before,
after)` gives `{ field: { from, to } }` for updates. Never put secrets or
decrypted private data in `data`. The table is append-only.

### List pages: `PageHeader` + `DataTable`

```tsx
import { DataTable, type Column } from "@/components/admin/data-table/data-table"
import { likePattern, parseTableParams } from "@/components/admin/data-table/params"
import { EmptyState } from "@/components/admin/empty-state"
import { PageHeader } from "@/components/admin/page-header"
import { StatusBadge } from "@/components/admin/status-badge"

const params = parseTableParams(await searchParams, {
  sort: ["name", "startsAt"] as const, defaultSort: "startsAt", defaultDir: "desc",
  filters: { status: ["published", "closed"] }, // pageSize defaults to 20
})
// query: where ilike(column, likePattern(params.q)), orderBy params.sort/dir, limit params.pageSize, offset params.offset, plus a count
<PageHeader title={t("title")} description={t("description")} actions={<Button asChild>…</Button>} />
<DataTable columns={columns} rows={rows} total={total} params={params} rowKey={(r) => r.id}
  searchPlaceholder={t("table.search")}
  filters={[{ key: "status", label: t("table.status"), options: [{ value: "published", label: … }] }]}
  empty={<EmptyState icon={…} title={…} description={…} action={…} />} />
```

- `Column<Row>`: `{ key, header, cell: (row) => node, sortable?, align?: "start" | "end" | "center", hideBelow?: "sm" | "md" | "lg", className? }`.
  Search, filters, sort and page live in the URL (`?q=&sort=&dir=&page=&<filter>=`); the
  table fades while the next page loads; "no results" offers to clear filters.
- `PageHeader({ title, description?, actions?, back?: { href, label } })`. On
  pages below a nav item (new, edit) the title also becomes the last breadcrumb.
- `StatusBadge tone="neutral" | "success" | "warning" | "danger" | "info" | "brand"`
  with a translated label (never colour alone).
- `EmptyState({ icon?, title, description?, action? })`.
- `ConfirmAction` (client): an "are you sure" dialog that runs an action:
  `<ConfirmAction action={deleteThing} input={{ id }} title description confirmLabel successMessage trigger={<Button …/>} />`;
  in a dropdown, leave out `trigger` and control `open` / `onOpenChange`
  (see `categories/_components/row-actions.tsx`).
- `<Money value={kurus} tone?="signed" />` shows lira in the current language
  (server or client).
- Drizzle gotcha: in a single-table `select`, columns inside a raw `sql`
  subquery are printed unqualified. Qualify them by hand for correlated
  subqueries (see `workshops` in `features/categories/queries.ts`).

### Forms

```tsx
"use client"
import { DateTimeFields } from "@/components/admin/form/date-time-fields"
import { Form, FormActions, FormField, FormSection, SubmitButton, TextField, TextareaField } from "@/components/admin/form/form"
import { LocalizedInput, LocalizedTextarea } from "@/components/admin/form/localized-input"
import { MoneyInput } from "@/components/admin/form/money-input"
import { useActionForm } from "@/components/admin/form/use-action-form"

const { form, submit, pending } = useActionForm({
  schema: thingSchema, action: createThing,
  defaultValues: { title: { fa: "", tr: "", en: "" }, price: undefined, startsAt: "", endsAt: "" },
  successMessage: t("toast.created"), onSuccess: () => router.push("/admin/things"),
})

<Form form={form} onSubmit={submit}>
  <FormSection title={…} description={…}>
    <LocalizedInput name="title" label={…} required={["fa", "tr", "en"]} />
    <FormField name="price" label={…} required>{(field) => <MoneyInput {...field} />}</FormField>
    <DateTimeFields label={…} startName="startsAt" endName="endsAt" required />
    <TextField name="venue" label={…} description={…} />
  </FormSection>
  <FormActions><SubmitButton pending={pending}>{tc("actions.save")}</SubmitButton></FormActions>
</Form>
```

Matching schema helpers (`@/components/admin/form/schemas`, usable on the server):

```ts
const thingSchema = z.object({
  title: localizedText({ required: ["fa", "tr", "en"], max: 120 }), // → LocalizedText, empty optional locales dropped
  price: kurus(),                                                    // integer kuruş; .nullable() when optional
  startsAt: isoDateTime(), endsAt: isoDateTime(),                    // → Date
  slug: slug(), id: uuid(),
}).refine((v) => v.endsAt > v.startsAt, { path: ["endsAt"], error: "common.validation.endAfterStart" })
```

- The hook validates on the client with the same schema, sends the raw values
  to the action (which validates again), shows toasts, and puts server
  `fieldErrors` on the fields. Generic messages come from `common.validation`;
  a custom schema message must be a full message key (`"things.errors.x"`).
- `LocalizedInput` / `LocalizedTextarea`: FA / TR / EN tabs, `*` on required
  locales, a filled / missing / error mark per tab, jumps to the tab with an error.
- `MoneyInput`: lira text (`1.250,50`, `1,250.50`, Persian digits) ⇄ kuruş.
- `DateTimeFields`: date picker showing the weekday, start (and optional end)
  time, Istanbul time, writes ISO strings into `startName` / `endName`.
- `FormField` render prop gives `{ id, name, value, onChange, onBlur, ref, aria-* }`
  for any control; `SubmitButton` shows a spinner (pass `pending`, or it follows
  a native `<form action>`).

### Formatting (`@/lib/format`)

`formatDate(value, locale, "short" | "medium" | "long" | "full")` (full adds the
weekday), `formatTime`, `formatDateTime`, `formatWeekday`, `formatTimeRange`,
`formatNumber`, `formatPercent(fraction)` (shares: `bp / 10000`), all in
`Europe/Istanbul`; Persian uses the Gregorian calendar with Persian digits.
`localized(text, locale)` picks a `LocalizedText` with a tr → en → fa fallback.
`slugify` (Turkish-aware), `zonedToIso(date, time)` / `zonedParts(iso)`,
`normalizeDigits`. Money: `formatLira` / `parseLira` (`@/lib/money`).

### Look and feel

- Tokens in `src/app/globals.css` (light and dark): `primary` is the clay
  accent; `success`, `warning`, `info` for states; `chart-1`…`chart-5` is a
  colour-blind-checked set: assign series in that order, never cycle.
- Fonts: IRANSans for Persian, Inter (latin + latin-ext) otherwise, chosen by
  `<html lang>` through `font-sans`.
- RTL: logical classes only (`ms-`, `pe-`, `start-`, `text-start`); flip
  direction icons with `rtl:rotate-180`. shadcn components that still use
  `text-left` take a `text-start` override via `className`.
- `ThemeToggle` (`@/components/theme-toggle`) and `LocaleSwitcher`
  (`@/components/locale-switcher`) work anywhere.
- Messages shared by all modules: `common` (actions, toast, errors,
  validation, table, form, date, theme, locales), `auth`, `admin` (nav, shell).

### Tests

Server logic is tested with Vitest against the test database. For actions,
mock `next-intl/server` (a `createTranslator` over the real messages),
`@/lib/auth/admin` (a fixed `AdminSession` with a real admin row, needed by
`audit_log`) and `next/cache`: see `src/features/categories/actions.test.ts`.
`audit_log` is append-only, so test admins referenced by it stay in the test database.
