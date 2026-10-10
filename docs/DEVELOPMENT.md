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

Checks: `pnpm typecheck`, `pnpm lint`, `pnpm test` (uses the `lart_test`,
`lart_test_dashboard` and `lart_test_reset` databases: `pnpm db:test:migrate`
migrates all three),
`pnpm build`. End-to-end: see `playwright.config.ts` (database `lart_e2e`).

## Stack

Next.js 16 (App Router, `proxy.ts` instead of middleware, async `params`),
React 19, TypeScript, Tailwind CSS 4, shadcn/ui (radix base, nova style,
ported into `src/components/ui`), Drizzle ORM + PostgreSQL, next-intl,
Zod, React Hook Form, Recharts, Resend + React Email, sharp.

Auth is our own code in `src/lib/auth`, not Auth.js: database sessions in
the `sessions` table (only the SHA-256 of the
256-bit cookie token is stored), Argon2id via `@node-rs/argon2`, per-account
lockout and per-IP rate limiting. Why: Auth.js Credentials sign-in only
supports JWT sessions (no server-side revocation, no sliding idle / absolute
expiry); one Auth.js session cookie per instance does not suit separate admin,
instructor and member logins; and lockout and rate limiting would be custom
code anyway. Phase 2 instructor and member logins reuse `startSession`,
`verifyCredentials` and the rest with their `kind` parameter; do not add
next-auth.

Next.js 16 differs from older versions: read the relevant guide in
`node_modules/next/dist/docs/` before using an API.

## Layout

```
src/
  app/
    icon.svg, favicon.ico, apple-icon.png   the site's icons, a white autumn leaf on clay (`pnpm icons` draws them again from scripts/favicons.ts)
    sitemap.ts, robots.ts       /sitemap.xml (home, workshops list + open workshop pages, /about, /story while a partner is on it, fa/tr/en with hreflang), /robots.txt (disallows only /admin, /<l>/admin and /api)
    og.png/route.tsx            /og.png: the site's share picture (its logo on paper, 1200×630) for pages without their own
    [locale]/                   every page (URL rules: the main language has no prefix, the proxy rewrites it here)
      (site)/                   the public site: the active theme's Frame (src/themes) around the page, the "confirm your email" banner and the notice toast
        page.tsx                the home page (/, /fa, /en): the active theme's Home with getHomeData
        workshops/              list, /[slug] page, /[slug]/register
        about/                  the About page (/about): the active theme's About with getAboutData(locale, "about") (the brand's own words, no partners)
        story/                  the Our story page (/story): the same theme's About with getAboutData(locale, "story") (the partners who chose to be on it)
        account/                My workshops (page.tsx), registrations/[id], signup, login, verify, forgot, reset
      instructor/(auth)/        instructor sign in, sign up, invite, forgot, reset, verify (no panel chrome)
      instructor/(panel)/       the instructor panel: home, contracts, workshops, earnings, profile
      admin/(auth)/             super-admin sign in, forgot, reset, invite (no panel chrome)
      admin/(panel)/<module>/   super-admin pages, one folder per module
    api/admin/…, api/instructor/uploads   route handlers (uploads, watermark preview, CSV exports)
  components/
    ui/                         shadcn/ui primitives (do not edit casually)
    admin/                      shared admin building blocks (shell, page header, forms, uploads)
    site/                       public-site parts every theme uses (account and language menus, banner, notice toast, workshop labels), the classic theme's header and footer, the member / instructor sign-in forms
    contract-document.tsx       a contract text as a printable document (admin and instructor panel)
    language-picker.tsx         teaching languages field (admin instructor form and instructor profile)
    impersonation-bar.tsx       "viewing as {name}" bar with End (instructor panel and site, while a super admin views as someone)
  db/
    schema.ts                   the whole schema (single source of truth)
    index.ts                    db client, Tx type
  emails/                       transactional emails (React Email): definitions, layout, samples, payment props
  features/<module>/            server logic of a module: queries, actions, schemas, tests
  i18n/                         languages, routing, the main language, links (paths, navigation, links), request config, namespaces
  lib/                          cross-cutting helpers (env, crypto, money, auth, audit, storage, email, routes, seo)
  themes/                       public-site themes (Settings → Appearance): the contract (types.ts), ids and fonts, registry, SiteRoot; default = Classic, atelier
scripts/                        admin:create, db:seed, jobs (scheduled), contracts:encrypt
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
  (`lib/crypto.ts`) and only decrypted for contracts and admins. So is the
  signed contract text that contains it: write and read it only through
  `sealSignedText` / `checkSignedText` (`features/contracts/signed-text.ts`);
  `pnpm contracts:encrypt` encrypts rows signed before that once
  ([runbook](#encrypting-older-signed-contract-texts-once)).
- Every super-admin mutation writes an audit entry (`lib/audit.ts`).
- Secrets only from `lib/env.ts` (environment) or encrypted settings.

### Money

- Integer kuruş everywhere (`lib/money.ts`). Parse user input with
  `parseLira`, display with `formatLira`. Never floats.
- Every movement of money is a balanced ledger transaction (double entry).
  The database rejects unbalanced transactions and any UPDATE/DELETE of
  ledger rows; a correction is a reversal transaction.
- Every cost is paid from the shared wallet: a partner never pays one
  personally (the ledger refuses a `partner_capital` line on an expense,
  advance or instructor payment). Settings → Money (`money` setting) names
  the one partner who records costs (`recordExpense`, `recordAdvance` paid,
  `payInstructor`: `assertSpender`; nobody while none is chosen) and opens
  or closes withdrawals (closed by default: `recordCapital` refuses one and
  the Withdraw buttons are hidden). The pages show a locked dialog
  (`blocked`, `spendBlockText`) to anyone else.
- Receipts: an expense keeps its files in `expense_files` (role `receipt`:
  a receipt or invoice, photo or PDF; `photo`: what was bought, furnishing
  only), uploaded with purpose `receipt` (`receipts/<random>.webp|pdf`: a
  photo is resized to 2400 px, a PDF is kept as it is, checked by its
  `%PDF-` header) and saved by `recordExpense` (only paths that exist in
  storage). Furnishing (`ledger_transactions.furnishing`, the "Furnishing
  expense" button) is a general expense from the wallet, kept apart in Money →
  Receipts (`listReceipts`, tabs All / Workshops (one workshop at a time) / General / Furnishing). The files go
  with their transaction only in a factory reset (cascade); the stored files
  stay.
- Closing a workshop credits each partner's share of its result to their
  capital. Money → Partners lists it per workshop on each card
  (`listPartnerAccounts` → `workshops`, latest first, a reversed closing
  netting out) and shows the profit not taken out yet (`owed` = profit
  shares − withdrawals): it stays in the shared wallet while withdrawals are
  closed.

### Lean code and database

- No new tables, columns or dependencies without a clear need.
- A value lives in one place. Workshop fields shared with the contract are
  stored on the workshop only.
- Translatable text is one `jsonb` column `{ fa, tr, en }` (`LocalizedText`).
- Schema changes: edit `src/db/schema.ts`, then `pnpm db:generate --name <what>`.
  When existing rows must be converted, hand-edit the generated SQL (e.g.
  `drizzle/0002_venue_localized.sql`: text → `{ "tr": … }` with `USING`).
  Then apply it to all four local databases: `pnpm db:migrate` (`lart`),
  `pnpm db:test:migrate` (`lart_test`, `lart_test_dashboard` and `lart_test_reset`) and
  `DATABASE_URL=postgres://lart:lart@127.0.0.1:5432/lart_e2e pnpm db:migrate`
  (end to end). A missed one does not always fail loudly (a jsonb value
  written into a column that is still `text` is accepted), so run all of them.

### Text and languages

- No hard-coded user-facing text: use next-intl messages, in all three
  languages (fa, tr, en). Each module owns `messages/<locale>/<ns>.json`.
- The brand name is never hard-coded: it comes from the `brand` setting and
  appears as `{brand}` in templates.
- Persian is RTL: use logical Tailwind classes (`ms-`, `me-`, `ps-`, `pe-`,
  `start-`, `end-`, `text-start`) instead of left/right.
- A number in a message is `{n, number}` (or `#` inside a plural), never a
  plain `{n}`: a plain argument prints Latin digits in Persian. Or pass an
  already formatted string (`formatNumber(n, locale)`).

### UX

Students and instructors are mostly non-technical. Screens are simple and
friendly: one main action, large buttons, short sentences, few fields,
helpful messages instead of technical errors, phone first. The super-admin
panel is premium and calm: clean cards, clear tables, beautiful charts.

## URL rules

Every address of the site follows these rules. `src/lib/routes.ts` is the
one list of routes (`ROUTES`); the [table below](#routes) mirrors it row by
row, and the guard test `src/lib/routes.test.ts` fails when the pages on
disk, the list and the table disagree, when a path breaks a rule, or when
code builds a language prefix by hand.

1. **The main language has no prefix.** The main language is the
   `defaultLocale` setting (Settings → General, `tr` by default). Its pages
   have no language in the address: `/`, `/workshops`,
   `/workshops/<slug>`, `/account/login`, `/admin`, `/instructor/login`. The
   other languages keep theirs: `/fa/…`, `/en/…` (their home page is `/fa`,
   never `/fa/`). The main language's prefixed address (`/tr/workshops?x=1`)
   is a permanent redirect (308, query kept) to the one without it. Changing
   the setting needs no redeploy: it applies at once in the process that
   saved it and within 30 seconds in the others (`getMainLocale()`,
   `src/i18n/main-locale.ts`: a per-process cache that serves the last value
   while it reads the new one, and never fails a request). `/` always shows
   the main language: nothing is guessed from Accept-Language or a cookie.
   The language switch is the way to another language; the address remembers
   it (`/fa/…`), and for a signed-in member or instructor it is also the
   language of their emails (`members.locale`, `instructors.locale`).
2. **The home page is a page.** `/` (and `/fa`, `/en`) is the home page
   (`src/app/[locale]/(site)/page.tsx`), never a redirect.
3. **Paths.** Lower-case English, kebab-case; plural nouns for lists
   (`/workshops`), a slug for a public item (`/workshops/<slug>`), an action
   as the last segment (`/register`, `/new`, `/edit`); no trailing slash, no
   file extension; no ids in public addresses (ids are fine inside `/admin`,
   `/instructor` and `/account`); at most three segments for a public page
   after the language. No public address starts with `admin` (robots.txt's
   `Disallow: /admin` matches by prefix).
4. **The same sign-in pages in every area.** `/account` (students),
   `/instructor` and `/admin` each have `/login`, `/forgot`, `/reset`, and
   where they exist `/signup`, `/verify`, `/invite`. These are the only
   pages of an area open without its session.
5. **One list.** Every page and localized route handler is in `ROUTES`. A
   page without its entry fails the guard test.
6. **Every generated link follows rule 1.** Links, redirects, canonical URLs
   and hreflang, the sitemap and email links are built with the helpers
   below, never by hand: no `` `/${locale}/…` ``, no `"/tr/…"` in the code.

### Building an address

Paths are written without a language, starting with `/` (they may carry a
`?query` or `#hash`). The helpers add the language when it is not the main one.

| Where | Use |
| --- | --- |
| Components (client and server) | `Link` (`href="/workshops"`, or `{ pathname, query }`), `useRouter()` (`push`, `replace`, `prefetch`; `{ locale }` switches the language), `usePathname()` (without the language), all from `@/i18n/navigation`; the main language comes from `MainLocaleProvider` in `[locale]/layout.tsx` |
| Server code: pages, actions, emails, the jobs script | `await localeHref(locale, path)`, `await absoluteLocaleUrl(locale, path)` (on `APP_URL`: emails, links to copy), `mainLocale()` (once per render) from `@/i18n/links`; `await localeRedirect(path, locale?)` from `@/i18n/redirect` |
| Pure code: the proxy, client helpers, tests, e2e | `localePath(locale, path, main)`, `splitLocale`, `stripLocale` from `@/i18n/paths` |
| SEO | `alternates(path, locale)` (canonical; hreflang fa, tr, en; x-default = the main language's address), `openGraphOf(locale, url, images?)` (og:url, og:locale and its alternates, the site's picture `/og.png` when a page has none; spread into each page's `openGraph`, which replaces the layout's whole), `absoluteUrl`, `ogLocale`, `jsonLdText` from `@/lib/seo`; a public page's `[locale]` through `pageLocale()` (`@/i18n/page-locale`) |
| "Where to go after signing in" | `safeNext(next, "member" \| "instructor" \| "admin", fallback, main)` (`@/lib/auth/safe-next`; on the server `main` is `await mainLocale()`): checks the path, without its language, against `ROUTES` and returns it at its address today (`/tr/workshops` → `/workshops` when tr is the main language, `/FA/x` → `/fa/x`), so a sign-in never ends on an old address |

Language choices are not URL decisions: the language of an email to the
admins may still come from `getSetting("defaultLocale")`, but every address
uses `getMainLocale()` / `mainLocale()`, so the proxy and the pages agree.

### Adding a page

1. Create `src/app/[locale]/…/page.tsx` with a path that follows the rules.
2. Add its entry to `ROUTES` in `src/lib/routes.ts` (area and access:
   `public`, `open` for a sign-in page, `private`) and its row to the table
   below, in the same place.
3. Run `pnpm test src/lib/routes.test.ts`.

The proxy lets `open` routes through its sign-in gate; a `private` route of
an area needs that area's session cookie (the page still checks the session
itself).

### Routes

Paths without a language: the main language's addresses. In the other
languages `/fa` or `/en` comes in front (`/` is `/fa`).

<!-- routes:start -->
| Path | Area | Access | Note |
| --- | --- | --- | --- |
| `/` | site | public | |
| `/workshops` | site | public | |
| `/workshops/[slug]` | site | public | |
| `/workshops/[slug]/register` | site | public | |
| `/about` | site | public | |
| `/story` | site | public | |
| `/[...rest]` | site | public | not-found page |
| `/account` | account | private | |
| `/account/login` | account | open | |
| `/account/signup` | account | open | |
| `/account/verify` | account | open | |
| `/account/forgot` | account | open | |
| `/account/reset` | account | open | |
| `/account/registrations/[id]` | account | private | |
| `/instructor/login` | instructor | open | |
| `/instructor/signup` | instructor | open | |
| `/instructor/verify` | instructor | open | |
| `/instructor/forgot` | instructor | open | |
| `/instructor/reset` | instructor | open | |
| `/instructor/invite` | instructor | open | |
| `/instructor` | instructor | private | |
| `/instructor/contracts` | instructor | private | |
| `/instructor/contracts/[id]` | instructor | private | |
| `/instructor/workshops` | instructor | private | |
| `/instructor/workshops/[id]` | instructor | private | |
| `/instructor/earnings` | instructor | private | |
| `/instructor/profile` | instructor | private | |
| `/instructor/[...rest]` | instructor | private | not-found page |
| `/admin/login` | admin | open | |
| `/admin/forgot` | admin | open | |
| `/admin/reset` | admin | open | |
| `/admin/invite` | admin | open | |
| `/admin` | admin | private | |
| `/admin/audit` | admin | private | |
| `/admin/categories` | admin | private | |
| `/admin/categories/new` | admin | private | |
| `/admin/categories/[id]` | admin | private | |
| `/admin/instructors` | admin | private | |
| `/admin/instructors/new` | admin | private | |
| `/admin/instructors/[id]` | admin | private | |
| `/admin/instructors/[id]/edit` | admin | private | |
| `/admin/money` | admin | private | |
| `/admin/money/partners` | admin | private | |
| `/admin/money/refunds` | admin | private | |
| `/admin/money/receipts` | admin | private | |
| `/admin/money/reports` | admin | private | |
| `/admin/money/transactions` | admin | private | |
| `/admin/profile` | admin | private | |
| `/admin/registrations` | admin | private | |
| `/admin/settings` | admin | private | |
| `/admin/settings/appearance` | admin | private | |
| `/admin/settings/home` | admin | private | |
| `/admin/settings/email` | admin | private | |
| `/admin/settings/payments` | admin | private | |
| `/admin/settings/money` | admin | private | |
| `/admin/settings/storage` | admin | private | |
| `/admin/settings/watermark` | admin | private | |
| `/admin/settings/backup` | admin | private | |
| `/admin/settings/danger` | admin | private | |
| `/admin/students` | admin | private | |
| `/admin/students/[id]` | admin | private | |
| `/admin/templates` | admin | private | |
| `/admin/templates/new` | admin | private | |
| `/admin/templates/[id]` | admin | private | |
| `/admin/templates/emails/[name]` | admin | private | |
| `/admin/workshops` | admin | private | |
| `/admin/workshops/new` | admin | private | |
| `/admin/workshops/[id]` | admin | private | |
| `/admin/workshops/[id]/edit` | admin | private | |
| `/admin/workshops/[id]/contract` | admin | private | |
| `/admin/workshops/[id]/finances` | admin | private | |
| `/admin/workshops/[id]/gallery` | admin | private | |
| `/admin/workshops/[id]/registrations` | admin | private | |
| `/admin/workshops/[id]/registrations/export` | admin | private | route handler (CSV) |
| `/admin/[...rest]` | admin | private | not-found page |
<!-- routes:end -->

Never localized (`UNLOCALIZED_HANDLERS`): `/api/admin/backups/[id]`,
`/api/admin/exports/[kind]`, `/api/admin/media/watermark-preview`,
`/api/admin/money/export/[report]`, `/api/admin/uploads`,
`/api/instructor/uploads`, `/media/[...path]`, `/og.png` (the site's share
picture), and the metadata routes `/sitemap.xml` and `/robots.txt`.

### Redirects

`src/proxy.ts` answers an old address of a GET or HEAD request with one
permanent redirect (`canonicalPath` in `src/lib/routes.ts`), before the
sign-in gate (so an emailed link keeps its token): `308`, the query kept,
`Cache-Control: no-store` (the main language can change, so the answer must
not be cached).

A redirect never rests on a guess. Until the main language has been read
once (a cold start with the database slow or down, when
`getMainLocaleState()` in `src/i18n/main-locale.ts` gives the fallback with
`known: false`), the proxy removes no prefix: `/tr/…` is served as it is, and
only a renamed page or a prefix in capitals gets its 308, keeping the
request's own prefix (`/tr/admin/accept-invite` → `/tr/admin/invite`).

| Request | Goes to (main language tr) |
| --- | --- |
| `/tr`, `/tr/<path>` | `/`, `/<path>` (`/tr/workshops?x=1` → `/workshops?x=1`) |
| `[/<l>]/admin/login/forgot` | `[/<l>]/admin/forgot` |
| `[/<l>]/admin/login/reset` | `[/<l>]/admin/reset` |
| `[/<l>]/admin/accept-invite` | `[/<l>]/admin/invite` (`/tr/admin/accept-invite?token=x` → `/admin/invite?token=x`) |
| `[/<l>]/instructor/accept-invite` | `[/<l>]/instructor/invite` |
| `/TR/…`, `/Fa/…` | the same with the language in lower case (none for the main language) |

Other methods are never redirected: a server action posted to the main
language's prefixed address (a page opened before the setting changed) is
served as it is. A signed-out GET of a private page gets the gate's `307` to
its area's login, in the same language, with `next`.

## Uploads and media

Files live in one storage space on the CDN chosen in the `cdn` setting
(`local` in development: `./.data/public`, served by `/media/...`; Bunny: one
storage zone behind a pull zone; Cloudflare: one R2 bucket with a custom
domain). Every file is served by the CDN under an unguessable name; there is
no private storage. The database stores only the storage path, e.g.
`workshops/<slug>/cover-<random>.webp`.

- **Upload from a form** with the components in `components/admin/upload`:
  `<ImageUpload purpose="course_cover" {...field} previewUrl={url} target={…} />`,
  `<VideoUpload {...field} />` (`purpose="site_video"` for the home page's
  video; `gallery_video` by default) and `<MediaGrid value onChange target={…} />`
  (many photos and videos, reorder, remove; `imagePurpose`, `allowVideos`,
  `videoPurpose`, `max`). The value is the storage path.
- **Purposes** (`lib/storage/shared.ts`) and where they are stored
  (`uploadPath` in `lib/storage/upload.ts`; `<random>` is 128 random bits):

  | Purpose | Processing | Path |
  | --- | --- | --- |
  | `course_cover` | 2000 wide | `workshops/<slug>/cover-<random>.webp` |
  | `course_sample` | 1600 | `workshops/<slug>/samples/<random>.webp` |
  | `gallery_photo` | 2400, watermarked; only that copy is stored; 409 `watermark_missing` until a logo is set | `workshops/<slug>/gallery/<random>.webp` |
  | `gallery_video` | MP4 / MOV / WebM as they are, sent in 8 MB parts | `workshops/<slug>/videos/<random>.<ext>` |
  | `instructor_photo` | square 800 | `instructors/<name>/photo-<random>.webp` |
  | `admin_photo` | a partner's photo, square 512 | `partners/<name>/photo-<random>.webp` |
  | `partner_portrait` | a partner's public portrait (Our story page), 1600, not cropped | `partners/<name>/portrait-<random>.webp` |
  | `watermark_logo` | PNG | `brand/watermark-logo-<random>.png` |
  | `site_image` | the home page's photos: 2560 wide, never watermarked | `site/img-<random>.webp` |
  | `site_video` | the home page's video: MP4 or WebM only (a MOV does not play by itself in Chromium or Firefox), up to 80 MB, sent in 8 MB parts | `site/video-<random>.<ext>` |

  Video purposes are listed in `videoPurposes`, the formats each one takes
  in `videoFormats` (checked from the content on the server, from the type
  or name in the browser) and their size in `maxUploadBytes`.

  Images are checked from their bytes, auto-rotated, stripped of all metadata
  (GPS) and re-encoded as WebP.
- **Folder names**: `folderName(candidates, fallback)` (`lib/storage/shared.ts`,
  client-safe) is `slugify` of the first name that has Latin letters or
  digits, at most 60 characters (`ç` → `c`, `ı` → `i`), else `unnamed`; never
  more than one plain path segment. The upload route decides the folder
  (`folderOf` in `app/api/admin/uploads/route.ts`): from the database when
  the record exists (`target={{ courseId }}`: the workshop's slug;
  `{ instructorId }`: the instructor's English, else Turkish, display name),
  from the session for a partner's photo (the name if it has Latin letters,
  not just digits, else the email's local part) and on the instructor route
  (the instructor's name), and for a workshop or instructor not saved yet
  from the form's `target={{ folder }}` hint (the slug field, the English
  name), sanitized again, else `new`. An unknown id is refused (400), and so
  is any `courseId`, `instructorId` or `folder` sent with the watermark logo,
  a partner's photo or the home page's files (`brand/`, `partners/<name>/`
  from the session, `site/`). Renaming a record never moves its files (the paths are stored). Paths
  from before the named folders (`courses/<yyyy-mm>/…`, `gallery/<yyyy-mm>/…`,
  `admins/…`, `brand/<yyyy-mm>/…`) stay valid.
- **Validate a submitted path** with `isSafePath` and the layout of its kind
  (e.g. the cover, sample and gallery checks in `features/workshops/schema.ts`,
  which also take the older paths) before saving it; never trust a path from
  the browser.
- **Show a file**: `(await getStorage()).publicUrl(path)` on the server, or
  `const url = await publicUrls()` then `url(path)`, which gives null instead
  of failing when the `cdn` setting cannot be used (the panel layout, the
  partners' photos, the watermark logo).
- **Read a file on the server** (the watermark logo, for watermarking and
  the preview): `read(path)` from `lib/storage`, through the storage API with
  the key, never through the CDN.
- **Replace or delete**: after saving the record, call `remove(oldPath)` from
  `lib/storage`.
- **Settings page**: `testStorage(cdnConfig)` for "Test connection" (writes,
  reads, opens through the CDN and deletes one probe file; messages in
  `settings.storage.test.<step>`), and
  `/api/admin/media/watermark-preview?position=&sizePct=&opacity=&marginPct=&logo=`
  as the live preview image. The `cdn` setting's field names (`publicZone`,
  `publicZoneKeyEnc`, `publicBucket`, `publicHost`) date from when there was
  a second, private zone; they stay, so the saved setting still parses (the
  old private fields are dropped). Never rename them or make the schema
  strict: a stored value that does not parse falls back to local storage
  without any error.
- The proxy must not run on `/api/admin/uploads` or `/api/instructor/uploads`:
  Next.js would buffer the body there and cut it at 10 MB (see the matcher in
  `src/proxy.ts`).
- **Another upload route**: `uploadFile(file, purpose, { endpoint })` and
  `<ImageUpload endpoint="/api/instructor/uploads" … />` send to it instead of
  `/api/admin/uploads` (the instructor panel's profile photo; its `PhotoField`
  uses `uploadFile` with its own round preview and wording).

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
  Radix direction, tooltips, toasts and the main language for client links.
  `/` is the home page in the main language ([URL rules](#url-rules)).
- `src/proxy.ts`: the [URL rules](#url-rules) (the 308s of old addresses,
  then next-intl: an address without a prefix is the main language, `/fa`
  and `/en` theirs; nothing guessed from the browser), a strict CSP with a
  per-request nonce, `X-Robots-Tag: noindex` on the admin, instructor and
  account areas (with or without a prefix) and their APIs, and an optimistic
  redirect to the area's login when there is no session cookie. It skips `_next`, `/media/`,
  `/api/admin/uploads`, `/api/instructor/uploads` and paths with a file
  extension (so `/sitemap.xml` and `/robots.txt` too). Static headers (HSTS in
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
  The one exception is a super admin's session as an instructor or member
  ("Enter their panel", `sessions.impersonated_by` = the admin): it ends one
  hour after it was created (`IMPERSONATION_MS`) and never slides; it ends
  at once when that admin is inactive or deleted (`validateSession` joins
  `admins`; the foreign key is `ON DELETE CASCADE`, so a deleted admin never
  leaves an ordinary session behind), and a database CHECK refuses one of
  kind `admin`. `startImpersonation(kind, subjectId, adminId, audit?)`
  (replaces this browser's session of that kind and runs `audit(tx,
  replaced)` in the same transaction, then sets the cookie, `maxAge` one
  hour, only after the commit; never touches the admin cookie) and `deleteImpersonationsBy(adminId, tx?)` are
  in `@/lib/auth/session`; ending one (End, logout, admin sign-out) is
  `@/lib/auth/impersonation` ([Students and viewing as someone](#students-and-viewing-as-someone)).
- Reusable for instructors and members (phase 2), all with a `kind` parameter:
  `startSession`, `currentSession`, `endSession`, `deleteSessionsOf`
  (`@/lib/auth/session`); `verifyCredentials(kind, email, password)` with
  lockout after 5 failures for 15 minutes and constant-time behaviour
  (`@/lib/auth/login`; race-safe: each try is claimed in the database before
  the password is checked, so concurrent requests get no extra guesses);
  `hashPassword`, `verifyPassword` (`@/lib/auth/password`, Argon2id);
  `PASSWORD_MIN_LENGTH` and the password form schemas (`@/lib/auth/schemas`,
  client-safe); `loginRateLimiter`, `createRateLimiter`, `rateLimitClient(ip)`
  (`@/lib/auth/rate-limit`, in memory; key by `rateLimitClient`, which groups
  IPv6 addresses by /64); `clientIp(headers)`, `isSameOrigin(request)`
  (`@/lib/auth/request`). `clientIp` (`@/lib/auth/client-ip`) is the address
  that connected to Traefik (`X-Real-IP`; Traefik replaces whatever the client
  sent), or `CF-Connecting-IP` when that address is one of Cloudflare's
  published ranges: behind Cloudflare every visitor would otherwise share an
  edge's address, and a direct visitor cannot pick an address by sending the
  header. Store emails lower-case (`normalizeEmail`). Show one
  generic message for every failed login.
- Admin sign-in / sign-out: `adminLoginAction`, `adminLogoutAction`
  (`@/lib/auth/actions`). First admin: `pnpm admin:create`; the others are
  invited from the panel ([Partners](#partners-super-admins)), at most 3 in all.
- Admin passwords (`@/lib/auth/actions`, logic in `@/lib/auth/account`):
  `changeAdminPasswordAction` (user menu → "Change password": needs the
  current password, signs out other devices); "Forgot your password?"
  (`/admin/forgot`, `requestAdminPasswordResetAction`: same answer and
  timing for any address, the `password_reset` email is sent after the
  response) and the link's page `/admin/reset?token=…`
  (`resetAdminPasswordAction`: one-time `email_tokens` row, 30 minutes, only
  its SHA-256 stored; ends every session). Audited as `auth.password_change`,
  `auth.password_reset_request`, `auth.password_reset`. The proxy lets the
  `/admin/login`, `/admin/forgot`, `/admin/reset` and `/admin/invite` pages
  through without a session (the `open` routes); the old
  `/admin/login/forgot`, `/admin/login/reset` and `/admin/accept-invite`
  addresses redirect to them.

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
  logged (through `errorForLog`) and shown as `common.errors.generic`.
  `redirect()` / `notFound()` pass through.
- Logging an unexpected error yourself: `console.error("[module] …", errorForLog(err))`
  (`@/lib/errors`). It keeps the SQL text and PostgreSQL code / constraint
  but drops bound values and `detail`, so no personal data reaches the logs.
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

When a member or instructor action writes an audit entry, it goes through
`ctx.audit` of `memberAction` / `instructorAction`: `adminId` null and
`data.by` = `"member"` / `"instructor"`. A person's own action needs none
(a member's profile save or cancel writes nothing), but an instructor's
profile edit and uploads keep one. While a super admin views as them,
every change to the person's data (profile, a cancelled registration,
uploads) writes one, as that admin: `adminId` = that admin (the audit
page's "Who", marked "while viewing as them") and `data.impersonatedBy` =
their id, so whatever is done there is the admin's. Code that writes
audit entries for a person outside these wrappers (the instructor upload
route) does the same by hand from `session.impersonatedBy`. Instructor uploads are recognised by
`data.by = "instructor"` (not by a null `adminId`).

### Emails

```ts
import { sendEmail } from "@/lib/email"
await sendEmail({ to, template: "contract_ready", props: { … }, locale }) // never throws: { ok } | { ok: false, error }
```

- Each email is defined in `src/emails/templates.ts` (props as a Zod schema;
  links must be on `APP_URL`); the list of emails and of their texts is in
  `src/emails/names.ts`. The texts are in `messages/<locale>/emails.json`
  (`subject`, `preview`, `heading`, `intro`, `intro2?`, `cta`, `note?`, ICU
  format) and may use the props, computed `values` (list them in `valueKeys`)
  and `{brand}` as placeholders (`emailPlaceholders(template)`).
- Admins can replace any of these texts per language on `/admin/templates`
  (the `emailTexts` setting). `renderEmail` lays them over the bundled texts;
  if one cannot be used, the email goes out with the bundled texts and the
  problem is logged. `checkEmailText` checks a text (braces, unknown
  placeholders) before it is saved.
- **How they are sent** is the `email` setting (Settings → Email,
  `features/settings/email.ts`): **Resend** (API key) or **SMTP** (our own
  mail server, a mail container on the server's network, or a service such
  as Brevo), the sender address (the display name is always the brand) and
  an optional reply-to. Both providers' values are kept, so switching back
  loses nothing; the key and password are stored encrypted and never sent to
  the browser. "Send a test email" sends the form's values (not saved) to the
  signed-in admin. While nothing is saved there (`provider: "env"`), the
  server's `RESEND_API_KEY` / `EMAIL_FROM` are used, as before. `emailConfig()`
  resolves the setting, `deliver()` sends one message (`lib/email`). The
  idempotency key only exists with Resend.

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

- `Column<Row>`: `{ key, header, cell: (row) => node, sortable?, align?: "start" | "end" | "center", hideBelow?: "sm" | "md" | "lg", primary?, className? }`.
  Mark one column `primary` (usually the name): it takes the remaining width
  and gives way on phones, so its content must truncate (`block truncate`,
  `min-w-0`). The `actions` column stays as narrow as its button.
  Search, filters, sort and page live in the URL (`?q=&sort=&dir=&page=&<filter>=`); the
  table fades while the next page loads; "no results" offers to clear filters.
- `PageHeader({ title, description?, actions?, back?: { href, label } })`. On
  pages below a nav item (new, edit) the title also becomes the last breadcrumb;
  a page outside the navigation (My profile) shows only its title there (an
  `exact` nav item is never a parent).
- `StatusBadge tone="neutral" | "success" | "warning" | "danger" | "info" | "brand"`
  with a translated label (never colour alone).
- `EmptyState({ icon?, title, description?, action? })`.
- `ConfirmAction` (client): an "are you sure" dialog that runs an action:
  `<ConfirmAction action={deleteThing} input={{ id }} title description confirmLabel successMessage trigger={<Button …/>} />`;
  in a dropdown, leave out `trigger` and control `open` / `onOpenChange`
  (see `categories/_components/row-actions.tsx`).
- `<Money value={kurus} tone?="signed" />` shows lira in the current language
  (server or client). `className` goes on a wrapper that follows the page
  direction, so `className="block …"` lines up with its label in Persian too.
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
    <LocalizedInput name="venue" label={…} required={["tr"]} />
    <TextField name="slug" label={…} description={…} />
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
weekday; its English and Turkish punctuation differs between ICU builds, so a
client component that server-renders it puts `suppressHydrationWarning` on the
element), `formatTime`, `formatDateTime`, `formatWeekday`, `formatTimeRange`,
`formatMonth`, `formatMonthYear`, `formatYear`, `formatNumber`,
`formatPercent(fraction)` (shares: `bp / 10000`), all in `Europe/Istanbul`.

Calendars: each language shows dates in its own calendar (`calendarOf`).
Persian is Solar Hijri (Jalali) with Persian digits ("۱۶ مهر ۱۴۰۵", built from
ICU's parts in day-month-year order, the same on the server and in browsers);
Turkish and English are Gregorian ("16 Ekim 2026", "16 Oct 2026"). Show dates
only through these helpers, never with `Intl.DateTimeFormat(intlLocale(…))`
directly (ICU's Persian patterns put the year first). Stored values, URLs,
`<time dateTime>`, JSON-LD, sitemaps and CSV file names stay Gregorian ISO.
Periods (a month, a quarter, a year) follow the viewer's calendar:
`@/lib/calendar` (`periodStart`, `periodEnd`, `addPeriods`, `periodStarts`,
`calendarFields`, over ISO days; date-fns / date-fns-jalali) gives their
bounds, so "this month" in Persian runs from 1 Mehr and a year from Nowruz.
Postgres has no Jalali calendar: sum per day (`occurred_on`) in SQL and fold
the days into periods in TypeScript (dashboard `monthly`, money
`profitAndLoss`). A Jalali quarter is a season (Farvardin–Khordad is spring;
the reports name it "بهار ۱۴۰۵"). The date picker (`components/ui/calendar`)
shows Jalali months for Persian with weeks from Saturday, and returns ordinary
Dates. CSV exports write Persian dates as "1405/07/16" (`csvDate`: year first,
Latin digits, so the column sorts) and ISO days otherwise; a profit-and-loss
period by its first day ("1405/07/01" is Mehr 1405). The activity log's
summaries show stored dates the same way as the page, each value in bidi
isolates (`isolate`) so a Persian date keeps its order after a Latin key. A signed contract
keeps the exact text signed, with the dates as they were written then.
`localized(text, locale)` picks a `LocalizedText` with a tr → en → fa fallback.
`slugify` (Turkish-aware), `zonedToIso(date, time)` / `zonedParts(iso)`,
`normalizeDigits`. Money: `formatLira` / `parseLira` (`@/lib/money`).

### Look and feel

- Tokens in `src/app/globals.css` (light and dark): `primary` is the clay
  accent; `success`, `warning`, `info` for states; `chart-1`…`chart-5` is a
  colour-blind-checked set: assign series in that order, never cycle.
- Fonts: IRANSans for Persian, Inter (latin + latin-ext) otherwise, chosen by
  `<html lang>` through `font-sans` (the panels; the public site's fonts are
  a setting, see the next section).
- RTL: logical classes only (`ms-`, `pe-`, `start-`, `text-start`); flip
  direction icons with `rtl:rotate-180`. shadcn components that still use
  `text-left` take a `text-start` override via `className`.
- `ThemeToggle` (`@/components/theme-toggle`) and `LocaleSwitcher`
  (`@/components/locale-switcher`) work anywhere.
- Messages shared by all modules: `common` (actions, toast, errors,
  validation, table, form, date, theme, locales), `auth`, `admin` (nav, shell).

### Settings → Appearance: logo, theme and fonts

- `theme` is the public site's theme, an id of `src/themes/ids.ts`
  (`themeIds`; an unknown id shows the classic theme). `fonts` holds, **per
  theme id**, the heading and text font with its weight for Latin (Turkish,
  English) and Persian. A theme without an entry uses its own fonts
  (`themeDefaultFonts`), and so does a script whose saved choice is not in
  the registry any more (`resolveSiteFonts`).
- The page (`settings/appearance/`): one card per theme with a small picture
  of it (`theme-pictures.tsx`: a picture and a preview look per theme id,
  so a new theme needs one there), the chosen theme's four fonts and a live
  preview. Choosing another theme shows that theme's saved fonts (or its
  own); "Use the template's own fonts" puts the theme's own back.
- `saveAppearanceSettings` (`features/settings/appearance-actions.ts`)
  validates with `appearanceSettingsSchema` (registry themes, each row only
  its script's fonts, a weight the font has), writes only `theme` and/or
  `fonts` when they changed (one transaction, one `setting.update` audit
  entry each), and touches only the chosen theme's entry in `fonts`; fonts
  equal to the theme's own remove that entry, so a theme's defaults keep
  following the code. `getAppearanceSettings()` gives the theme, the saved
  map and every theme's resolved fonts.
- The site writes only the chosen fonts' `@font-face` and variables
  (`siteFontCss`, in `SiteRoot`); the settings page declares the whole pool
  (`fontPoolCss`) for its preview, with the same family names. Both write
  registry values only, never text from the database.
- **Adding a font**: its woff2 files in `public/fonts/<id>/`, named
  `<id>-<subset>-v<version>.woff2` (a Latin font: `latin` and `latin-ext`,
  for Turkish; a Persian font: `arabic`), with the font's `LICENSE.txt`
  (OFL), and one entry in `src/themes/fonts.ts` (id, the font's own name,
  script, serif or sans, the weights to offer, the file's weight range, the
  files with their unicode-range). Bump the version in the names whenever a
  file changes: fonts are cached for a year. Nothing else changes: the page
  lists it, the schema accepts it, the site loads it once it is chosen.
- **Logo**: the `logo` setting (`lib/logo.ts`, `logoSchema`) is a one-colour
  logo as SVG path data (viewBox, paths with their fill rule and transform),
  or null: the brand's name then shows. The admin uploads an SVG file; the
  browser reads it (`features/settings/logo-svg.ts`: filled shapes as paths,
  `<style>` class rules in sheet order, DOCTYPE entities, transforms as one
  matrix; a white or transparent background left out; text, pictures (also as
  a pattern fill), `<use>`, clipping masks and masks, and stroked lines
  refused with what to do; linear in the file's size whatever it holds) and
  crops it to its ink (`getBBox` per shape, within the file's own box: what
  the browser would not draw is left out), and `saveSiteLogo` / `removeSiteLogo` store it
  with a `setting.update` audit entry. The server never reads the file:
  `logoSchema` lets through only numbers and path commands. `SiteRoot` puts
  the shapes once in the page as `<symbol id="site-logo">`; themes draw it
  with `BrandLogo` (`src/themes/logo.tsx`, `fill: currentColor`, so it takes
  the text colour of where it shows, light or dark), sized by
  `SiteFrameProps.logo` (its width and height). A page draws it from
  `HomeData.logo` (its shapes) with `LogoPicture` instead: after a logo
  change, a visitor moving around the site gets new pages inside the layout
  rendered before it.
- Limer's own logo is in `public/brand/` (`limer-logo.svg`, and transparent
  PNGs in white and brown for Settings → Watermark). Migration
  `0009_site_logo` sets it as the `logo` setting once, on a database whose
  brand is "Limer" and that has no logo yet (with a `setting.update` audit
  entry without an admin); other databases are left alone. After that it is
  an ordinary setting: replacing or removing it in Appearance sticks.

### Settings → Home page: the home page's content

- The `home` setting (`lib/settings.ts`) holds what the home page shows, for
  every theme: the hero (`media`: `theme` = the theme's own photos, `images`
  = up to six photos shown in turn, `video` = one video with an optional
  cover photo; title, subtitle, button), the story, "explore by craft", past
  workshops and "how it works" sections (each with `show`, its texts and,
  except past workshops, a photo; up to four steps) and the footer (about
  text, Instagram, email, phone). Texts are per language; an empty one uses
  the bundled text of `messages/<locale>/home.json`, an empty photo the
  theme's own (`getHomeData`, `getSiteFrame`). Four empty steps are stored
  as none (the theme's four steps); fewer steps show only those, each empty
  field falling back to the bundled step of its place. The files of the
  background not chosen stay saved, so switching back needs no new upload.
- The page (`settings/home/`): `HomeSettingsForm` with the bundled texts of
  all three languages as placeholders (`getHomeDefaults()`), the saved value
  with its files' URLs (`getHomeSettings()`, `features/site/home-settings.ts`)
  and, while the classic theme is active (it shows only the tagline and the
  workshops), a note with a link to Appearance.
- **Files**: photos are uploaded as `site_image`, the video as `site_video`
  (MP4 or WebM, up to 80 MB; see [Uploads](#uploads-and-media)), both under
  `site/`. `homeSettingsSchema` (`features/site/home-schema.ts`, client-safe)
  takes only such paths (`isSiteImagePath`: `site/….webp`,
  `isSiteVideoPath`: `site/….mp4|webm`), the stored setting's text limits
  (500, paragraphs 1500), an Instagram address `https://instagram.com/<name>`
  or `https://www.instagram.com/<name>` (a shared link's `?igsh=…` is
  dropped), an email, and a phone of digits, spaces and a leading `+`
  (Persian digits are converted); the chosen background must have its
  photos or video.
- `saveHomeSettings` (`features/site/home-actions.ts`) reads the setting
  under a lock and writes it with one `setting.update` audit entry
  (`entityId` "home", the changes per field: `"hero.title": { from, to }`)
  in one transaction; nothing is written when nothing changed. The form
  sends the version of the value it was loaded with (`homeFormSchema`:
  the row's `updated_at` in microseconds from `readHome`, "" before the
  first save); a save from a page opened before another save (another tab,
  another admin) is refused with "reload the page" (`homeEditor.errors.pageChanged`),
  since its photos may be files that save removed, and a file the stored
  value does not use yet must still be in storage (`exists`, refused on its
  field). The action returns the new version, which the form keeps. After the
  commit it removes the `site/` files the old value used and the new one
  does not (a file that cannot be removed is only logged). A file uploaded
  but never saved stays in storage.

### Tests

Server logic is tested with Vitest against the test database. For actions,
mock `next-intl/server` (a `createTranslator` over the real messages),
`@/lib/auth/admin` (a fixed `AdminSession` with a real admin row, needed by
`audit_log`) and `next/cache`: see `src/features/categories/actions.test.ts`.
`audit_log` is append-only, so test admins referenced by it stay in the test database.
The main language is mocked as `tr` for every test (`src/test/setup.ts`), so
links come out without a prefix in Turkish and with `/fa`, `/en` otherwise;
`main-locale.test.ts` and `settings.test.ts` use the real cache
(`vi.unmock("@/i18n/main-locale")`).

### Settings → Home page → About page, and Settings → Danger zone

**About page.** `home.aboutPage.text` (fa/tr/en, up to 4000 characters each)
is the About page's (/about) own text; empty, the page shows the footer's
short "About us" text, which stays the footer's. `drizzle/0014_about_page_text.sql`
set Limer's (only while it had none).

**Danger zone** (`/admin/settings/danger`, `features/settings/reset*.ts`):
"Delete all transactions" empties the ledger (the wallet and every account
back to zero), deletes the contracts not signed and every contract of a
workshop not held (held: closed, or ended while published or confirmed), and
the activity log's money rows (`money.*`, registration payments and refunds,
workshop closings, the deleted contracts' rows). People, workshops,
registrations, media, templates and settings stay; a workshop left without a
contract gets a new one when it is saved again. It needs the admin's password
and the phrase typed out, runs in one transaction with the tables locked, and
is logged as `setting.factory_reset` with the counts. The ledger and the log
stay append-only: `forbid_change()` lets a DELETE through only inside a
transaction that set `lart.factory_reset` (`drizzle/0013_factory_reset.sql`),
and TRUNCATE is refused on those tables (`drizzle/0015_ledger_truncate_guard.sql`).
A registration is paid once in the database too (`ledger_tx_one_payment`, a
partial unique index). `reverseEntry` counts as a payment when the mirror
takes money out of the wallet: only the spender may make it.
Its test runs on a database of its own (`lart_test_reset`).

## Operations

### Encrypting older signed contract texts (once)

Contracts signed before signed texts were encrypted still hold the plain
text, with the instructor's ID number, until `pnpm contracts:encrypt` runs.
Run it once after deploying, in the app's own environment (in Coolify, a
terminal in the app's container), so it has the app's `DATABASE_URL` and
`ENCRYPTION_KEY`:

1. `pnpm contracts:encrypt --dry-run` counts the plain texts and checks the
   key: it must decrypt data the app already encrypted (instructor ID
   numbers, newer signed texts). Another key (for example the development
   key from `.env`, used when the variable is missing) stops it with exit
   code 1 before anything changes; a wrong-key run could not be repaired by
   running it again. With nothing encrypted to check against it refuses
   unless `--unverified-key` is given.
2. `pnpm contracts:encrypt` encrypts them (each audited as
   `contract.encrypt`, with the hash, never the text), then runs
   `VACUUM (FULL, ANALYZE) contracts`: an UPDATE keeps the old row version,
   plain text included, in the table's files until the table is rewritten.
   If the database user does not own the table, it says so (exit code 1):
   run that command as the owner. A second run finds nothing to do.
3. Exit code 1 with "does not match its SHA-256": those contracts were
   encrypted all the same, but their text differs from the fingerprint taken
   when they were signed. Their contract page flags them; look into them.

What was copied before the run still holds the plain texts: database
backups, WAL archives (point-in-time recovery) and standby copies. They stay
until they expire under the backup retention; to be rid of them sooner, take
a new full backup after the run and delete the older backups and their WAL
archives.

Until it runs, the admin contract page shows such a contract with a "Not
encrypted yet" notice. Every signed text is checked when it is shown
(`checkSignedText`): against its SHA-256 and the hash in the audit log's
`contract.sign` entry. One that doesn't match (or has no such entry) is
flagged as possibly changed, and one that can't be decrypted is not shown.

## Partners (super admins)

The super admins are the business partners: the business has two, so
`MAX_PARTNERS` is 2 (counting active admins and invitations that still
work), and the panel no longer offers invitations: Money → Partners shows
the two partners' accounts only. The invitation code (actions, accept page,
email) stays for a later change of partners
(`src/features/partners/limits.ts`, import-free so `scripts/create-admin.ts`
shares it). Logic in `src/features/partners` (`invites.ts`: the invitation
rules; `actions.ts`; `queries.ts`; `schema.ts`: the form schemas, client-safe).

- **Inviting** (Money → Partners, any partner): `invitePartner({ name, email,
  locale })` stores an `admin_invites` row (only the SHA-256 of the link's
  token; 7 days; one per email), emails `partner_invite` in the chosen
  language (not the default one) and returns `{ id, inviteUrl, emailed }`:
  the absolute link is shown once to copy (WhatsApp, or when no email could
  be sent). `resendPartnerInvite({ id })` gives a new link (the old one stops
  working; an expired invitation needs a free place again),
  `cancelPartnerInvite({ id })` deletes it. `listPartnerInvites()` gives the
  list (expired ones too) and the places left (`slots.canInvite`). Audited as
  `admin.invite`, `admin.invite_resend`, `admin.invite_cancel` (entity
  `admin_invite`, never the token).
- **Accepting**: `/admin/invite?token=…` (open in the proxy,
  `noindex`); `partnerInviteDetails(token)` for the page (names, email, no
  use of the link), `acceptPartnerInviteAction({ token, password })` (admin
  password rules, 10 per network per 15 minutes). In one transaction: the
  link must work, the limit is checked again (active admins only: the
  invitation's place is its own) and so is the email; the admin is created
  (active, `share_bp` 0), the invitation deleted and `admin.accept_invite`
  audited as the new admin. Then any admin session of that browser ends, the
  new partner is signed in and lands on `/admin?notice=welcome`
  (`adminNotices`, messages `partners.notices.<notice>`).
- **Admin rows are created only on acceptance**, so every query that lists
  admins (money, dashboard, audit, emails to every admin) stays as it is. The
  new partner's 0 % share is fixed on the shares form.
- **Locking**: inviting, sending again, cancelling, accepting, changing one's
  email and `pnpm admin:create` all take `pg_advisory_xact_lock(hashtext(
  'admins:partners'))` first (`lockPartners`), never a lock on the `admins`
  table (it deadlocked with audit entries and ledger lines).
- **Shares** are fixed (50 / 50) and locked: the panel shows them in
  Settings → Money and has no way to change them (`admins.share_bp`).
  Capital goes in from both partners at once, the same amount each
  (`recordContribution` → `postJointContribution`: one transaction, one
  `partner_capital` line per partner with a share).
- **My profile** (`/admin/profile`, `updateMyProfile`, `getMyProfile`):
  name (2 to 80 characters), photo and email. A new email needs the current
  password (5 tries per 15 minutes), must be free among admins (letter case
  aside) and open invitations, is stored lower-case, ends the partner's other
  sessions (this one stays), drops reset links sent to the old address and
  deletes an expired invitation of the new one (it could never be sent
  again; `pnpm admin:create` does the same). The photo (`admin_photo`
  upload, `partners/<name>/photo-<random>.webp`) must be one this partner
  uploaded (the upload route's `media.upload` audit entry) and still be
  stored (a form left open on another device may hold a photo a later save
  there removed); the old file is removed from storage. Audited as
  `admin.profile_update` with the changed field names (and the name's
  change), never the password. `AdminSession.admin` carries an optional
  `photoPath` (read it as `photoPath ?? null`); its URL is the normal public
  one (`publicUrls()`), and the partners and dashboard queries return
  `photoUrl`.
- **On the Our story page** (My profile, `updateMyAbout`, `getMyAbout`; columns
  `about_shown`, `about_name`, `about_role`, `about_bio`, `portrait_path` on
  `admins`): each partner chooses to be on the public Our story page (/story)
  and writes their name (optional, per language), role and a few words in
  fa, tr and en (the words are needed in all three while shown; a hidden
  entry may be a draft), with a public portrait (`partner_portrait`, checked
  like the photo: uploaded by them, still stored; the old file removed),
  never the panel's photo. Only their own entry. Audited as
  `admin.about_update` with the changed fields (and shown, role).
  `listAboutPartners(locale)` gives the page each text in its own language
  only (never another's); with nobody on it the page is `noindex` and out of
  the sitemap. The About page (/about) is separate: only the brand's own
  words (the footer's "About us" text), always indexed.
- **Pages and components** (before invitations were closed): Money → Partners had "Invite a partner"
  (`money/partners/_components/invite-dialog.tsx`; disabled with a note when
  every place is taken, which asks to cancel an invitation only while a
  working one holds a place: `invite.full` and `errors.limit` get
  `{ max, invited }`; after sending, `InviteSent` shows the link once with a
  Copy button and the 0 % reminder) and one dashed tile per open invitation
  next to the partners' cards (`invite-card.tsx`: "Send again", "Cancel";
  not an `<article>`, those are the partners). A calm note says when a
  partner is at 0 % while the others already make 100 %. The invitation page
  is `app/[locale]/admin/(auth)/invite` (outside `(panel)`, `AuthShell`, its
  own `noindex`; a working link never sends a signed-in visitor away, a dead
  one takes them to the panel). "My profile" is in
  the user menu (`app/[locale]/admin/(panel)/profile`). `PersonAvatar`
  (`components/admin/person-avatar.tsx`, photo or initials, decorative) is
  used by the user menu, the partners' cards, the shares form, the dashboard
  and the instructors. `AdminNoticeToast` (`components/admin/notice-toast.tsx`,
  in the panel layout) shows `?notice=` values from `adminNotices` once.
  `PasswordField` (`components/admin/form/password-field.tsx`) is a password
  input with a "show" eye. Texts: `messages/<l>/partners.json`.
- **Tests**: the shared test database holds many active admins, so the
  limit is tested in `invites.test.ts` inside rolled-back repeatable-read
  transactions with a `max` relative to that snapshot; `actions.test.ts`
  lifts `MAX_PARTNERS` with a mock.

## Accounts

Members (students) and instructors sign in with the same code as the super
admins (`src/lib/auth`, one cookie per kind). Their flows live in
`src/features/accounts` (`accounts.ts`: the logic; `actions.ts`: the server
actions with rate limits, cookies and redirects; `schema.ts`: the form
schemas, client-safe).

### In pages, queries and actions

```ts
import { getMember, requireMember, requireMemberApi } from "@/lib/auth/member"
import { getInstructor, requireInstructor, requireInstructorApi } from "@/lib/auth/instructor"

const { member } = await requireMember()         // { id, email, name, phone, locale, emailVerified }
const { instructor } = await requireInstructor() // { id, email, displayName, locale, emailVerified }
const { impersonatedBy } = await requireMember() // { id, name } of the super admin viewing as them, or null
```

- `requireMember(next?)` redirects a visitor to `/account/login?next=…` (in the page's language)
  (default `next`: the current page, from the proxy's `x-pathname`), and
  `requireInstructor(next?)` to `/instructor/login` (comes back only to
  a page of the panel). Both are cached per request. Call them in **every**
  page and query: layouts are not re-run on client navigation.
- `get…()` returns null instead of redirecting (e.g. "You are registered" on a
  public page). A deactivated instructor has no session (it is ended on the
  next request); members have no `active` flag.
- `impersonatedBy` (optional on `MemberSession` / `InstructorSession`; read
  it as `impersonatedBy ?? null`) is set while a super admin views as the
  person. Server code only: pages pass the admin's name to the bar, never
  the id. Hide what the person alone may do (the sign form, the register
  form, "Change password") and show why instead.
- Route handlers: `requireMemberApi(request)` / `requireInstructorApi(request)`
  return null for no session or a cross-site POST/PUT/PATCH/DELETE (answer 401).
- **Scope every query to the signed-in person** (`ctx.member.id`,
  `ctx.instructor.id`): never trust an id from the browser (no IDOR).

```ts
"use server"
import { instructorAction, memberAction, publicAction } from "@/lib/action"

export const cancelRegistration = memberAction(idSchema, async ({ id }, ctx) => {
  // … where(and(eq(registrations.id, id), eq(registrations.memberId, ctx.member.id)))
})
export const register = memberAction(registerSchema, handler, { verified: true }) // unconfirmed email: friendly refusal
export const saveProfile = instructorAction(profileSchema, async (input, ctx) => { /* ctx.instructor.id */ })
export const contactForm = publicAction(contactSchema, handler, { rateLimit: { limit: 5, windowMs: 15 * 60_000 } })
```

- `memberAction` / `instructorAction` are `adminAction` with the member or
  instructor as `ctx`, plus `ctx.audit` (see [Audit](#audit): a person's
  own action needs no entry, though an instructor's profile edit and
  uploads keep one; a change a super admin makes while viewing as them is
  always audited, as that admin).
  `{ verified: true }` refuses a member whose email is not confirmed yet
  (`account.errors.unverified`); registering needs it (README §4).
  `{ notImpersonated: true }` refuses while a super admin views as the
  person (`common.errors.impersonationBlocked`, checked first): signing a
  contract and registering (terms and consents) use it. Any future action
  that changes the person's own email or password, or deletes the account,
  must use it too. Side effects that belong to the person are skipped
  instead of refused: the language switch does not change their
  `locale` while an admin views as them.
- `publicAction` is for forms open to visitors: `rateLimit` counts every call
  per client network (IPv4 address or IPv6 /64) before the input is read;
  over the limit it answers `rateLimitMessage` (default
  `auth.errors.rateLimited`). Add per-address limits in the handler
  (`createRateLimiter`). `runAction` alone has no limit: do not use it for
  public forms.

### Pages and flows

Paths are written without a language ([URL rules](#url-rules)).

| Page | What happens |
| --- | --- |
| `/account/signup` | name, email, password (≥ 10), optional phone; language = the page's. New email: account, signed in, `welcome_verify` (24 h link). Existing email: nothing changes, the owner gets `member_exists`. Both go straight back to `next` (or `/workshops`) with the same "check your inbox" notice |
| `/account/login` | back to `next` or the workshops; one message for every failure; lockout after 5 tries for 15 min |
| `/account/verify?token=` | confirms the email from the page's script (a mail scanner fetching the link does not use it up); a used link of a confirmed email still says "confirmed" |
| `/account/forgot`, `/reset?token=` | same answer for any address; 30-minute one-time link; the reset ends every other session, confirms the email and signs this device in |
| `/instructor/signup` | an instructor's own sign-up (`instructorSignupAction`, 5 per network per hour): the admins' instructor fields minus the photo, plus password and "my details are correct"; the display name may not carry a link, address or number (it greets the emails). Stored with `approved_at` null (audit `instructor.signup`), signed in, into the panel; `welcome_verify` to the instructor and `instructor_signup` to every active admin. An email that already has an instructor account is refused with a pointer to log in |
| `/instructor/invite?token=` | the invitation (`features/instructors`, 7 days): password, email confirmed, link used, one transaction; signed in, into the panel |
| `/instructor/login`, `/forgot`, `/reset`, `/verify` | as for members; inactive instructors and instructors without a password never get in |

**Approval.** `instructors.approved_at` is null while a self-registered
instructor waits: they can use the panel (banner "waiting for approval",
`InstructorSession.instructor.approved`), but the workshop form does not
offer them and `createWorkshop` / `updateWorkshop` refuse them, like an
inactive instructor. Instructors added by an admin are approved on creation
(migration 0005 approved every existing row). `approveInstructor`
(`features/instructors/actions`, audit `instructor.approve`) needs a confirmed
email address (anyone could sign up with someone else's), sets it once and
emails `instructor_approved`; `signContractAction` also needs a confirmed address; the list filter `status=pending` and
`countPendingInstructors()` show who waits.

The member's language (`members.locale`, the language of their emails)
follows the site's language switch (header and account menu) while signed in
(`setMemberLocaleAction`). Instructors: `setInstructorLocaleAction`. The
instructor panel's "Please confirm your email" banner sends the link again
with `resendInstructorVerifyAction` (the link opens `/instructor/verify`),
and its "Sign out" is `instructorLogoutAction` (`features/accounts/actions`).

Member names (sign-up and "My details") use `personName()`
(`features/accounts/schema`): 2 to 80 characters, no digits, links, email
addresses or `@ / \ : < >`. The name is the greeting of the emails we send,
so it must not carry someone's own link or phone number to any address.

Not found: an unknown address under a language is the catch-all
`(site)/[...rest]`, so the public site's not-found page (`(site)/not-found.tsx`,
`components/site/not-found-view.tsx`: a large 404 in the language's digits,
the ways back, a workshop's own words under `/workshops/…`, "My workshops"
under `/account`) shows inside the theme's frame; the panels have their own
(`admin/(panel)` and `instructor/(panel)`: `[...rest]` and `not-found.tsx`,
inside the sidebar, back to the panel's start). `[locale]/not-found.tsx` is
the plain fallback, `src/app/not-found.tsx` the last one (an address with a
dot, which the proxy leaves alone). A not-found page sets its title and
`noindex, follow`, never a canonical or language links; the catch-alls and
the public workshop pages call `notFound()` in `generateMetadata` too, so the
title is the not-found page's (the panels' record pages keep their own
title). The language layout refuses a request the proxy did not see (an
address with a dot, e.g. /fa/nope.php: no page has one), so it gets the last
not-found page instead of a frame in mixed languages. Next renders a not-found boundary with every page below
it, so they read nothing of their own. Never put a `loading.tsx` or a
`<Suspense>` around a page above a `notFound()`: the response would stream
with status 200 (a soft 404).

Errors: the `(site)` and `instructor/(auth)` groups have their own
`error.tsx`, both built on `src/components/site/page-error.tsx` (a friendly
message, "Try again" = `retry()`, one way on). A failure in those groups'
layouts (brand, signed-in member) is caught by `src/app/[locale]/error.tsx`
(full page, back to the home page); one in the root or language layout by
`src/app/global-error.tsx`. Error boundaries use `retry()` (fetches the page
again), not `reset()`.

Actions that change the session cookie end with a server-side `redirect`, so
the next page renders with the new session. To say something on that page,
redirect with `withNotice(path, "checkEmail" | "signedOut" | "passwordSaved")`
(`features/accounts/schema`): the site layout shows `site.notices.<notice>` as
a toast and removes `?notice=` from the address. Only those values are shown.

### The public site shell

`src/app/[locale]/(site)/layout.tsx` frames every public page (the home
page, workshops, the member's account pages) with the active theme's `Frame`
inside `SiteRoot` (the chosen fonts, `data-site-theme`): the header with the
"viewing as" bar as its `top`, the "Please confirm your email" banner (with
"Send it again") for a signed-in member whose email is not confirmed as its
`banner`, the page in one `<main>`, the footer; then the notice toast. Pages
in the group render inside that `<main>`: do not add another. The classic
theme's Frame is `SiteHeader` (brand wordmark → the home page, "Workshops",
language, account button: "Log in / Sign up" coming back to the page, or the
member's first name with My workshops → `/account`, language, log out; below
`sm` the language and account buttons show only their icon or initial, so
the brand keeps its room) and `SiteFooter`; Atelier has its own header and
footer (`src/themes/atelier`) around the same account and language menus.
Small centred forms use `AuthCard` (`@/components/site/auth-card`). Nothing
on the public site links to the instructor pages.

**Themes and their data.** Pages and the layout read the data and hand the
active theme (`getActiveTheme()`, Settings → Appearance) plain props; a theme
only decides how things look and never reads the database. The layout renders
`theme.Frame` (menu and footer: `getSiteFrame`, `src/features/site/frame.ts`;
the header's menu is `nav`, the footer's links `footer.links`: Workshops,
About us, Our story),
the home page `theme.Home` with `getHomeData(locale)`
(`src/features/site/home.ts`: the `home` setting, with the bundled texts of
`messages/<locale>/home.json` where a field is empty; a section is null when
the admin hid it or it has nothing to show), and every list of workshops
`theme.WorkshopCard` with the cards of `listOpenWorkshops`.
`src/themes/types.ts` is the contract, accessibility rules included. Public
reads live in `src/features/registrations/public.ts` (open workshops, one
workshop, seats, terms) and `src/features/site/public.ts`:
`listPublicCategories(locale)` (the categories of the open workshops, in the
admin's order, with how many; "open" is `openWorkshopsWhere`, the one rule of
the list, its categories and the sitemap) and `listPastWorkshops(locale,
{ limit })` (closed, never cancelled, workshops with a cover or gallery
photos, newest first, each with its cover and first six gallery photos: the
gallery is what the admins chose to publish). Both are cached per request
and return public fields only: never an instructor's private fields.

**Craft filter.** `/workshops?category=<categories.slug>` lists one
category's workshops (`listOpenWorkshops(locale, { category })`; each card
also carries its `categorySlug`). Above the grid a row of links, All and
each category with open workshops (only when there are two or more), marks
the current one with `aria-current="page"`; it uses the design tokens, so
each theme gives it its own colours. A malformed slug, an unknown one or one
without open workshops shows the whole list, without an error. A filtered
view is `noindex, follow` with no canonical or language links (Google reads
a noindex next to a canonical to another page as contradicting itself); the
sitemap lists only `/workshops`.

The home page is `(site)/page.tsx` (`/`, `/fa`, `/en`). The classic theme
(`src/themes/default`) shows two sections: `HomeHero` (the brand, the
tagline: the SEO description setting in the page's language or
`site.home.tagline`, "See all workshops" only when a workshop is open) and
`UpcomingWorkshops` (the first six of `upcoming` as `WorkshopCard`s with `h3`
titles, "All workshops", or the "coming soon" empty state). Its title and
description come from the SEO setting in the page's own language (never
another language's text), else `site.home.metaTitle · brand` and
`site.home.metaDescription`; the title is used as it is, so it carries the
brand (`drizzle/0010_seo_texts.sql` set Limer's). The page also carries the
site's JSON-LD (`Organization` at the main language's address, with its
Instagram as `sameAs`, and this language's `WebSite`).

**Languages and search engines.** Each language has its own address, the
canonical is always the page's own language, and hreflang (fa, tr, en,
x-default = the main language) is in the HTML and the sitemap. The footers
of both themes link the same page in the other languages
(`components/site/language-links.tsx`, plain `<a hreflang>` keeping the
query; the header's menu is a button crawlers cannot follow). A text shown from another language
because this one has none (a workshop's intro, venue, an instructor's bio:
`fallbackLanguage`, `textLang`) is marked with its `lang` and `dir`, and meta
descriptions and JSON-LD use only the page's own language (`ownText`,
`ownIntro`), never a fallback. Changing the main language moves every
address (the setting's hint says so).

**Contact details.** The footer's email and phone (Settings → Home page) are
never in a page's HTML or data as text: `getSiteFrame` conceals them
(`lib/conceal`, letters only) and `ProtectedContact` writes the `mailto:` /
`tel:` link in the browser on the first sign of a person (scroll, pointer,
touch, key, focus), or when its stand-in ("Show email address", one element
with the link, so focus stays and the press that shows it never dials) is
pressed; without JavaScript neither shows. Keep real addresses out of the messages too: all of them reach the
browser (examples use example.com).

The proxy sends `X-Robots-Tag: noindex` for `/admin/**`, `/instructor/**`,
`/account/**` (with or without a language prefix) and
`/api/{admin,instructor,account}`,
and redirects a signed-out GET of a private page to that area's login (except
the sign-in pages themselves). It also passes the requested path and query to
the page as `x-pathname` (overwriting any value the client sent).
The instructor panel and the account pages rely on that noindex (and the
pages' meta noindex), not on a robots.txt Disallow: `src/app/robots.ts` does
not name them, so crawlers can fetch them and see the noindex (a blocked page
can still be indexed as a bare URL), and robots.txt does not publish the
instructor panel's private address (README §5). Do not add them there.

### Themes

The public site's look is a theme (`src/themes`, chosen in Settings →
Appearance): `default` (shown as "Classic", the original look) and
`atelier`. Pages and layouts fetch the data and hand the active theme plain
props; a theme only decides how things look. The contract is
`src/themes/types.ts`: a `Theme` has a `Frame` (header, the page in one
`<main>`, footer), a `Home` (the home page's sections from `HomeData`,
`src/features/site/home.ts`; a hidden section is `null`), an `About` (the
About page and the Our story page from `AboutData`,
`src/features/site/about.ts`: on /about the footer's "About us" text and no
partners, on /story a short intro and the partners who chose to be on it), a `WorkshopCard`
(home page and `/workshops`), its `themeColor` and its default `fonts`. Its
header lists what every theme keeps: one `h1` on the home page, the brand;
the brand as the first link of the first `<header>`; a header at most 80px
tall on a phone; `top` (the "viewing as" bar) above it and `banner` under it;
the logo (`logo`, when set) instead of the brand's name wherever a theme
shows the name as a wordmark, the name staying the accessible text.

A new theme is a folder `src/themes/<id>/` exporting its `Theme`, its id and
fonts in `ids.ts`, one line in `registry.ts`, and its `theme.css` imported in
`src/app/globals.css`. Its colour tokens go under `[data-site-theme="<id>"]`
and `html[data-site-theme="<id>"]` (dark: `.dark [data-site-theme="<id>"]`,
`html.dark[data-site-theme="<id>"]`), never on bare `:root` or `body` (the
panels share them): `SiteRoot` puts the attribute on the site's wrapper and
`HtmlTheme` on `<html>` while a site page is open, so dialogs and toasts at
the end of `<body>` get them too. The chosen fonts arrive as
`--site-font-heading`, `--site-font-heading-weight` and `--site-font-body`
(`font-serif` and `font-sans` follow them on the site, `<html>` included, so
menus, dialogs and toasts use them; on a Persian page
`html[data-site-theme]:lang(fa)` outranks the panels' IRANSans rule).

Atelier (`src/themes/atelier`, after throttlehaus.ca) maps the owner's
palette (cream `#F2E9E5`, beige `#C5AA8E`, brick `#8B4A2E`, dark brown
`#5B311E`, earthy brown `#9D816B`) onto the shadcn tokens in `theme.css`, so
the shared pages (a workshop, registering, the account, dialogs, toasts)
follow it, and adds the palette as colours (`bg-at-paper`, `text-at-cream`,
`bg-at-deep`…) and the utilities `at-container` (1280px of content with 80px
sides, 20px on a phone), `at-heading` and `at-caps`. Its headings use the
heading font, Latin ones in capitals with a little letter-spacing (Persian
never). Its own photos are in `public/themes/atelier/` (versioned names: they
are cached for a year) and are named only in `photos.ts` (the hero's
slideshow, the story, crafts and steps bands, the card fallback), with their
descriptions in `home.atelier.photos`: swapping a photo is an edit of that
file. Sections fade up into view through `data-reveal` (`reveal.tsx`, one
observer; with reduced motion everything simply shows).

### Emails of phase 2

| Email | Sent by | When |
| --- | --- | --- |
| `welcome_verify`, `password_reset`, `member_exists` | accounts | sign-up, "send again", forgot password |
| `registration_received` | registrations | registered, not paid yet: "your place is reserved; please pay {amount}", one block per payment way switched on in the `payment` setting (`cash: true`, `transfer: { accountHolder, bankName, iban, note }`, `paymentUrl`: the workshop's `courses.payment_url`) |
| `payment_received` | registrations | an admin recorded the payment (`method`: cash, transfer, online): paid, place confirmed |
| `registration_confirmed` | registrations | a registration that needs no payment (a free workshop); kept for that and for admins' saved texts |
| `registration_cancelled` | registrations | a registration was cancelled; `refundPercent` 100 / 50 / 0; leave out `refundAmount` when nothing was paid; `byUs: true` when an admin cancelled it (neutral wording instead of "as you asked") |
| `refund_due` | registrations | to every super admin: a refund must be paid back by hand |
| `refund_sent` | registrations | an admin marked the refund as paid back |
| `workshop_cancelled` | workshops (`cancelWorkshop`) | to everyone registered, one per member: with `refundAmount` (refunded in full) when they had paid, without it ("please don't come to the venue") when not |
| `workshop_reminder` | jobs (day before) | one per member and workshop per batch of registrations (a registration added after the reminder gets its own); with `amount` (still to pay), `participantName` and the payment ways (as `registration_received`) while something is unpaid |
| `instructor_signup` | accounts (`instructorSignupAction`) | to every active super admin, in the default language: a new instructor waits for approval, link to their profile |
| `instructor_approved` | instructors (`approveInstructor`) | in the instructor's language, link to the panel |
| `password_changed_by_team` | accounts (`setPasswordAsAdmin`) | to the member or instructor in their language: a super admin set a new password (never in the email), log in again, contact us if unexpected |
| `contract_ready` | workshops / contracts | in the instructor's language (`instructors.locale`: the invitation language the admin chose when creating the instructor or resending the invitation, then the invitation page's and the panel's language switch), sign link in that language |

`paymentWays(await getSetting("payment"), course.paymentUrl, locale)`
(`@/emails/payment`) builds the payment props of `registration_received`: only
the ways that are on and usable (a transfer needs an IBAN, online payment the
workshop's link), with the admin's notes in the email's language.

Links in emails must be on `APP_URL`, with one exception: `paymentUrl` of
`registration_received` may be any `https` link without user name or password
(iyzico / PayTR payment links). The IBAN is shown in groups of four. The
templates page previews these emails with `accountEmailSamples`
(`src/emails/samples.ts`).

### Tests

`src/features/accounts/actions.test.ts` shows the mocks for actions that use
cookies, headers and `after()`: `next/headers` (a cookie map and a fresh client
IP per test, as the public actions are rate limited per network),
`next/server`, `next/cache`, `next-intl/server` and `@/lib/email`. Sign a
person in with `createSession(kind, id)` and put the token in the cookie map.

## Instructor panel

`src/app/[locale]/instructor/(panel)`, reads in `src/features/instructor-panel`
(`queries.ts`, `actions.ts`, `earnings.ts`, `schema.ts`). No link to it from the
site; every page is `noindex` (layout metadata and the proxy header).

| Page | What it shows |
| --- | --- |
| `/instructor` | contracts waiting for a signature, next workshops |
| `/instructor/contracts`, `/contracts/[id]` | every contract version; one contract's text (`ContractDocument`, print view) and the sign form |
| `/instructor/workshops`, `/workshops/[id]` | my workshops with seats taken (everyone registered, paid or not yet); participants by name and photo / video consent only (contract 8.1: no contact details, no payment status) |
| `/instructor/earnings` | per workshop: fee, received (advance, payments), owed or to return (`workshopEarnings`); only money booked since this instructor's first contract for the workshop (a workshop taken over from another instructor does not show theirs) |
| `/instructor/profile` | public profile in three languages, teaching languages (`LanguagePicker`), photo (`PhotoField` → `/api/instructor/uploads`) |

- Every query starts with `requireInstructor()` and reads only the signed-in
  instructor's rows; someone else's id is "not found".
- **Signing** (`signContractAction` → `signContract` in
  `features/contracts/sign.ts`): the typed name must be the official name
  (spacing and case aside); the form sends the SHA-256 of the text the
  instructor read (`textSha256`), and `signContract(…, expectedSha256)` renders
  the text again under the workshop and contract locks and refuses
  (`contracts.errors.textChanged`) if it differs. The exact text is stored
  encrypted with its SHA-256 and the evidence; the workshop is published (or
  confirmed again after a re-issued contract).
- **Profile photo**: `/api/instructor/uploads` (purpose `instructor_photo`
  only, 20 per hour, audited with the instructor's id); saving the profile
  accepts only a photo that instructor uploaded.
- **A super admin viewing as the instructor** sees the "viewing as" bar on
  top of every page; the contract page shows a notice instead of the sign
  form and `signContractAction` refuses (an e-signature is the
  instructor's own). Profile edits and uploads are audited as the admin.
- The per-participant fee before the go decision is an estimate from everyone
  registered (paid or not yet), the number the go decision fixes.

## Students and viewing as someone

Students are the `members` table. **Students** (`/admin/students`, in the
Teaching group) lists them (search by name, email or phone, the phone
through `normalizePhone` and also by its national part, so "0532…",
"0090 532…" and "+90 532…" find the same student; registrations
counted in every state; joined date; "Email not confirmed"), and
`/admin/students/[id]` shows the details, the account, every registration
(linked to the workshop's Registrations tab, searched by the participant)
and the account access below. Logic in `src/features/students`
(`queries.ts`, `actions.ts`, `schema.ts`). The admin registration lists and
refunds link a member's name to their student page.

Both an instructor's and a student's admin page end with **account access**
(`components/admin/account-access.tsx`; logic in
`features/accounts/admin-access.ts`, actions `setInstructorPassword` /
`impersonateInstructor` in `features/instructors/actions`,
`setStudentPassword` / `impersonateMember` in `features/students/actions`):

- **Change password** (`SetPasswordDialog`): typed (the person's own
  rules, 10 to 256 characters) or generated on the server (16 characters
  from 55 unambiguous ones in groups of four, about 92 bits) and shown once
  with Copy. `setPasswordAsAdmin` hashes before its transaction, then under
  the row lock: refuses a deactivated instructor, sets the hash, clears the
  lockout, deletes the person's unused reset links and invitation (an
  invited instructor's account is then complete; a confirmation link stays
  and the email is not marked confirmed), ends every session of theirs
  (also an admin viewing as them) and audits `<kind>.password_set`
  (`generated`, `inviteCompleted`; never the password). Then
  `password_changed_by_team` is emailed; the answer says whether it went
  out. 10 per admin per 15 minutes. The password is only ever in the
  action's answer for a generated one; never logged or stored.
- **Enter their panel / their account**: `impersonate(kind, id, ctx)` starts
  a one-hour session of that kind in this browser (`startImpersonation`;
  refused for a deactivated instructor) and audits `<kind>.impersonate`
  (and a replaced viewing's end) in the same transaction, so a failed
  audit leaves no session and no cookie; the action redirects to `/instructor` or `/account`. The admin keeps their
  own session. `ImpersonationBar` (`components/impersonation-bar.tsx`) is
  the first row of the sticky header of the instructor panel
  (`PanelShell`) and of the site (the theme Frame's `top`): "You are viewing
  as {name} — signed in as {admin}" and **End**.
- A viewing session ends, with an `<kind>.impersonate_end` entry (`reason`)
  as the admin, when: End is pressed (`endImpersonationAction`,
  authenticated by the viewing session itself, so it works without the
  admin cookie, then back to the person's admin page, or the admin login
  with `next`); the person's "Log out" is used (it acts as End); the admin
  signs out (`adminLogoutAction` ends every viewing session of that admin,
  in every browser); another viewing replaces it (`replaced`). It also ends
  without an entry after one hour, when the admin is deactivated or
  deleted, when the admin's own password changes, or when the person's
  password is set, the instructor deactivated or deleted.
- Never possible for admin accounts (`ImpersonableKind`, `createSession`
  throws, the database CHECK), and an instructor or member session never
  opens `/admin` (another cookie and kind).

## Registrations and payments

No payment gateway yet: students pay cash, by bank transfer or through the
workshop's online payment link (iyziLink / PayTR "Link ile Ödeme"), and an
admin records every payment. `registrations.status`: `pending` = registered,
holds a seat, not paid yet; `confirmed` = paid (or a free workshop);
`cancelled`.

| Where | What |
| --- | --- |
| `/workshops`, `/workshops/[slug]` | open workshops (published or confirmed, not started), seats left, "You are registered" (`features/registrations/public.ts`) |
| `/workshops/[slug]/register` | participant name, terms (SHA-256 of the text shown), photo / video consent; confirmed email needed (`registerAction`) |
| `/account`, `/account/registrations/[id]` | My workshops: payment status, how to pay (`PaymentInstructions`), cancel with the refund preview (`features/registrations/member.ts`, `actions.ts`) |
| `/admin/workshops/[id]/registrations` | record a payment, cancel, change refund, CSV export (`features/registrations/admin`) |
| `/admin/registrations` | every workshop's registrations: tabs not paid yet (default) / paid / cancelled / all, search by participant / member / email / phone, record a payment, cancel, change refund |
| `/admin/money/refunds` | refunds owed / paid back; "Change refund", "Mark as refunded" |
| `/admin/money/receipts` | the receipts gallery: every file kept with an expense (receipts, invoices, item photos), tabs All / Workshops / General / Furnishing |
| `/admin/settings/payments` | which ways are on (cash, transfer with holder / bank / IBAN / note, online with a note) |

- **Counting.** "Registered" is everyone with an active registration, paid or
  not yet (`activeStatuses`): `seatsTaken(courseId)` / `seatsLeft(limit, taken)`
  on the site, the fill columns and meters of the admin and the dashboard, the
  instructor panel, the go decision (`final_participants`) and, until that is
  fixed, the participant number of money/closing.ts and reports.ts. "Paid" is
  shown beside it where it helps (dashboard, workshop overview, finances): a
  confirmed registration with an amount above 0, so a free registration never
  counts as paid. The dashboard's upcoming meters use the live registered
  count, also after the go decision, with `final_participants` beside it.
- **Places after the go decision** are capped at `final_participants`
  (`seatLimit(course)` in `features/registrations/schema.ts`, used by
  `registerForWorkshop` and the site's seats left). A cancelled place can be
  taken again; more people only once the instructor agreed (contract 5.2) and
  an admin raised the number on the workshop's overview
  (`raiseFinalParticipants`: confirmed and not started, higher than now, at
  most the maximum; audited `workshop.raiseFinal` with `{ from, to }`).
- **How to pay.** `paymentWays(await getSetting("payment"), safePaymentUrl(course.paymentUrl), locale)`
  (`@/emails/payment`) gives the ways that are on and usable (a transfer needs
  an IBAN, online payment the workshop's link); `PaymentInstructions` shows
  them on the site, and `registration_received` / `workshop_reminder` email them.
- **Lock order: workshop, then registration.** Registering, the member's
  cancel, `recordPayment`, `cancelRegistration`, `setRefund`, `recordRefund`
  (`features/registrations/admin/payments.ts`), `cancelWorkshop` and every
  ledger posting lock the `courses` row first (`lockCourse`, FOR NO KEY
  UPDATE, or FOR UPDATE), then the registration. A seat count read under that
  lock cannot be raced, and a payment recorded while the workshop is being
  cancelled is either refunded or refused.
- **Free workshops** (price 0): the registration is `confirmed` at once,
  nothing to pay or refund; `registration_confirmed` instead of
  `registration_received`.
- **`recordPayment(tx, { registrationId, method, amount, paidAt, createdBy })`
  is the single entry point for a payment**: it checks the state under the
  locks, sets `confirmed`, `paid_at`, `payment_method` and posts
  `registration_payment` to the ledger in the caller's transaction. A future
  gateway calls it with its own amount and time and `createdBy: null`.
- **Refunds.** Cancelling (the member, an admin, or the whole workshop) stores
  the amount owed as `refund_amount` (terms: 100 / 50 / 0 % by the time left,
  `refund-policy.ts`; full when the workshop is cancelled or the admin
  chooses). An admin confirms or changes the stored refund before it is paid
  back (`setRefund`, 0 up to what was paid, audited `registration.refundChange`;
  the member is emailed the new amount), e.g. a full refund when the date,
  venue or instructor changed. It is paid back by hand, then "Mark as refunded"
  (`recordRefund`) posts `registration_refund` and sets `refunded_at`.
  Registration payments and refunds are never reversed in the ledger
  (`reverseTransaction` refuses them, `money.errors.registrationEntry`): a
  payment is undone by cancelling the registration. A workshop's books cannot
  be closed while refunds are still owed (`refundsOwed` closing issue), nor
  while an active registration with an amount above 0 is still not paid
  (`unpaidRegistrations`): record each payment (often cash at the venue) or
  cancel the registration of anyone who didn't come first, because after
  closing `recordPayment` and `cancelRegistration` refuse
  (`money.errors.workshopClosed`). The finances page counts as "paid" only
  confirmed registrations with an amount above 0.

## Jobs

`pnpm jobs` (`scripts/jobs.ts`) runs every 15 minutes as a scheduled task
(same image and environment as the app). Each job is idempotent and runs even
when another failed; exit code 1 when one failed or did not finish.

- `decision_due` (`features/workshops/decisions.ts`): once a published
  workshop's go / no-go time has passed, every active super admin gets
  `decision_due` once (`decision_notified_at`).
- `workshop_reminder` (`features/registrations/admin/reminders.ts`): the day
  before, everyone with an active registration in a workshop starting within
  24 hours gets one email per member and workshop per batch of registrations,
  in their language, with what is still to pay and how while something is
  unpaid. Marked per registration (`reminder_sent_at`, reset when the start
  time changes) only when the email went out; members are locked one run at
  a time (`SKIP LOCKED`). The Resend idempotency key names the start time and
  the registrations it covers (a short sha256 of their ids), so a retry is
  deduplicated, a registration added later gets its own reminder, and a
  reminder for a new date is not blocked by the one for the old date.
- `backup` (`features/backup/backup.ts`): see [Backups and exports](#backups-and-exports).

## Backups and exports

Settings → Backup (`/admin/settings/backup`, `features/backup/`):

- **Database backups.** `pg_dump --format=custom` of the whole database plus a
  restore README, kept in the storage at
  `backup/<Istanbul day>/<db-daily|db-manual|month>-<HHMM>-<random>.zip` and
  listed in the `backups` table. The random part makes the name unguessable
  (the CDN is public). Several on one day share
  the day's folder. Restore with
  `pg_restore --no-owner --no-privileges --dbname <url> limer.dump`, then run
  the site with the same `ENCRYPTION_KEY`. The image installs
  `postgresql-client-18` (pg_dump must not be older than the server).
- **Schedule.** `runScheduledBackups` makes the day's backup from 03:00
  Istanbul time and, once a Solar Hijri month is over, that month's Excel report
  (`kind = monthly`), while automatic backups are on. It is idempotent and holds
  a transaction-scoped advisory lock, so it runs from both the site's own timer
  (`src/instrumentation.ts` → `features/backup/timer.ts`, every 15 minutes in
  production; `BACKUP_TIMER=off` stops it) and `pnpm jobs` without doubling up.
- **Downloads** (`/api/admin/exports/[kind]`, audited `backup.export`):
  Persian right-to-left Excel files (exceljs; Solar Hijri dates, lira amounts,
  totals rows): `expenses`, `finance` (wallet, partners, workshops, expenses,
  journal), `workshop?id=`, `month?m=<first day of a Solar Hijri month>`; and
  `invoices`, every file kept with an expense as a ZIP streamed as it is made,
  in folders `ورکشاپ‌ها/<start> - <title>/`, `هزینه‌های عمومی/`, `اثاثیه/`.
  A backup itself downloads through `/api/admin/backups/[id]` (audited
  `backup.download`), read from the storage with its key.
