# Lart

Lart is a professional website for **arts and educational workshops**.
Visitors browse the latest workshops, create an account and register for a
class. Instructors work in their own private panel, and a separate
super-admin panel runs the business: workshops, instructors, contracts,
course finances, a shared partner wallet and full accounting.

> **Status:** phase 1 (the super-admin panel) is built and tested; phase 2
> (instructor panel, student accounts, registration with payments recorded by
> admins, refunds and reminders) is built. Phase 3 has begun: the public site
> runs on the theme system, with Classic (the original look) and Atelier
> (after the throttlehaus.ca reference), the theme and its fonts chosen in
> Settings → Appearance, the home page's content in Settings → Home page, and
> a craft filter on the workshops list. Next: the rest of phase 3
> (instructors, past workshops, about, FAQ and contact pages, editable
> menus). How to run it: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Contents

1. [Principles](#1-principles)
2. [Design](#2-design)
3. [Public site](#3-public-site)
4. [Students](#4-students)
5. [Instructors](#5-instructors)
6. [Super-admin panel](#6-super-admin-panel)
7. [Workshop lifecycle](#7-workshop-lifecycle)
8. [Money: course finances, wallet and accounting](#8-money-course-finances-wallet-and-accounting)
9. [Emails](#9-emails)
10. [Media, CDN and watermark](#10-media-cdn-and-watermark)
11. [Security](#11-security)
12. [Technology](#12-technology)
13. [Data model](#13-data-model)
14. [Build order](#14-build-order)

Related document: [instructor contract, fixed clauses](docs/CONTRACT_TEMPLATE.md).

---

## 1. Principles

- **Security comes first, always.** Every feature is reviewed for security
  before it ships ([Security](#11-security)).
- **Minimal code.** No unnecessary code, dependencies or abstractions; the
  simplest solution that is correct and secure wins.
- **A lean database.** Only the tables and columns that are needed, no
  duplicated data, no premature features. A value is entered once and used
  everywhere it is needed.
- **Simple and friendly for everyone.** Almost all students and instructors
  are women, many of them not technical. Every screen must be simple, warm
  and obvious:
  - one clear action per screen, large buttons, short plain sentences,
  - as few form fields and steps as possible,
  - friendly messages that say what to do next, never technical errors,
  - works perfectly on a phone.
- **Three languages everywhere.** Persian (RTL), Turkish and English: every
  menu, page, email and panel label. The **main language** is one setting
  in the super-admin panel.
- **Short addresses that follow fixed rules** ([URL rules](docs/DEVELOPMENT.md#url-rules)).
  The main language lives at the root with no language in the address
  (`limer.tr/`, `/workshops`, `/workshops/<slug>`); the other languages are
  under `/fa` and `/en`. `/` is the home page, never a redirect. Paths are
  lower-case English (plural lists, a slug for a public item, the action
  last, no ids on public pages), and every area has the same sign-in pages
  (`/account`, `/instructor`, `/admin` with `/login`, `/forgot`, `/reset`,
  `/signup`, `/verify`, `/invite` where they exist). Old addresses (the
  main language's `/tr/…`, renamed pages) redirect permanently. One list in
  the code holds every address, and a test keeps pages, list and rules in
  step.
- **Best-possible SEO, always.** Server rendering, per-language URLs
  (the main language at the root, `/fa`, `/en`) with `hreflang`, translated metadata and Open Graph,
  structured data (`Course`, `Event`, `Person`, `Organization`), sitemap,
  canonical URLs, fast Core Web Vitals and optimized images.
- **Everything is editable, nothing is hard-coded.** Content, menus, terms,
  contract text, emails and the brand name all come from the database.
- **Brand name from settings.** The brand name is stored once and set in
  the super-admin settings (per language if needed). Everywhere it appears
  (terms, contracts, emails, pages, SEO titles, menus, footer) it is written
  as `{brand}` and filled in automatically, so renaming the brand changes it
  across the whole site at once.

## 2. Design

### Reference

The look and feel follows the owner's previous project,
**[throttlehaus.ca](https://throttlehaus.ca/)**: the same layout, the same
premium feel and an animated (video) hero, rebuilt for Lart in three
languages. Premium, mobile-first, with polished navigation.

### Typography

All fonts are **self-hosted** (served from the site / CDN, never from Google
Fonts or any third party), subset and preloaded for speed.

The panels always use these:

| Language | Font | Notes |
| --- | --- | --- |
| Persian | **IRANSans** | Persian digits, RTL; font files taken from the owner's other repositories |
| Turkish | **Inter** | full Turkish set (ç ğ ı İ ö ş ü), excellent on screen |
| English | **Inter** | same family as Turkish for a consistent look |

The public site's fonts are chosen **per theme** in Settings → Appearance:
a heading font and a text font, each with its weight, for Turkish & English
and for Persian, from a short list of self-hosted fonts. Each theme starts
with its own fonts (Atelier: Cormorant Garamond and Montserrat, Noto Naskh
Arabic and IRANSans), and "Use the template's own fonts" goes back to them.

### Swappable landing theme

The public site is built so its **theme can be replaced quickly**, for
example when a new design reference is given:

- **Data and logic are separate from design.** Content, courses, SEO and
  forms live in a shared core; a theme only decides how they look.
- A theme is one folder (`themes/<name>`) with its layout, sections and
  design tokens (colours, fonts, spacing). The rest of the code never
  changes when a theme is added.
- Every home-page section (hero, latest workshops, instructors, past
  workshops, ...) has a fixed data contract, so a new theme just implements
  the same sections in a new style.
- The active theme is chosen in the super-admin settings (Settings →
  Appearance), with a picture of each theme.
- The instructor and super-admin panels keep their own design and are not
  affected by a theme change.

## 3. Public site

| Page | Content |
| --- | --- |
| **Home** | refined menu, animated hero, **latest workshops**, instructors, past workshops |
| **Workshops** | list and detail pages: instructor, date, time, venue, seats left, price, registration |
| **Instructors** | photo, name and introduction, with their workshops |
| **Past workshops** | elegant gallery of finished workshops (photos and videos) |
| **About, FAQ, Contact** | editable pages |

- A **language switcher** (FA / TR / EN) on every page.
- A workshop appears on the home page only after its instructor has signed
  the contract.

### Editable from the super-admin panel

- **Hero** (Settings → Home page): the theme's own photos, up to six of
  your own shown one after another, or a short video (MP4 or WebM) with a
  cover photo; headline, subtitle and button text in FA / TR / EN.
- **Home-page sections** (our story, explore by craft, past workshops, how
  it works): each can be shown or hidden, with its title, text and photo
  per language. A field left empty shows the theme's own text or photo.
- **Footer**: a few words about the brand, Instagram, email and phone.
- **Every other page** (about, contact, FAQ) and the menus in FA / TR / EN,
  each with its own SEO title and description.

## 4. Students

**Students have no panel.** Everything happens on the public site itself.

- Sign up and log in right on the site (small account button in the menu).
- Choose a workshop and register on its page. Registering reserves a place;
  then the student pays in one of the ways the super admin has switched on
  (cash at the workshop, bank transfer, or the workshop's online payment
  link) and an admin records the payment.
- Every registration shows its payment status: **registered, not paid yet**
  or **paid**.
- The workshop page shows "You are registered" for workshops they joined;
  the account menu ("My workshops") lists them with their payment status and
  lets them cancel. Nothing more.
- When a student is stuck, the team can help from **Students** in the
  super-admin panel: set a new password, or look at the site through the
  student's account ([security](#11-security)).

### Sign-up and email verification

- After signing up, the student goes **straight back to the site**; no
  waiting.
- A gentle, always-visible banner says **"Please confirm your email"**,
  with a button to resend the email, until the email is verified.
- Registering for a workshop needs a verified email; the site asks for it
  in plain words.

### Registration terms

- Registering requires ticking the terms checkbox; registration is blocked
  until it is ticked.
- Super admins manage **terms templates** (three languages); one is the
  **default**, and each workshop uses the default or a template chosen for
  it.
- The accepted version and the time of acceptance are stored with the
  registration as proof.

#### Default terms: registration and cancellation

> Please read the workshop details and the terms below before registering.
>
> - Your registration is final once all steps are complete and you receive
>   a confirmation message from {brand}.
> - Cancel **72 hours or more** before the start: **full refund**.
> - Cancel **between 72 and 24 hours** before the start: **50% refund**.
> - **Less than 24 hours** before the start, or not attending: **no refund**.
> - If you cannot attend, you may send someone else in your place before
>   the start, in agreement with {brand}.
> - If {brand} cancels the workshop, you get a full refund. If the date,
>   venue or instructor changes, you can accept the new terms or receive a
>   full refund.
> - Refunds covered by these terms are made within five business days.
>   Your statutory rights are not affected.
> - Please arrive on time; late arrival does not change the end time.
>
> ☐ **I have read and accept the registration and cancellation terms.**
> *(required to register)*

**Automatic refunds:** when a participant cancels, the system calculates
the refund (100 %, 50 % or 0 %) from the time left before the start, and an
admin confirms it, or changes it (for example to a full refund when the
date, venue or instructor changed), in Money → Refunds or on the workshop's
Registrations tab.

#### Photo and video consent

> Photos and videos may be taken during the workshop. The choices below are
> only about publishing **identifiable** images of the participant on the
> {brand} website and official pages, to present the activities of {brand}.
> They are **optional** and do not affect registration or attendance.
> Consent for the instructor's personal pages is not covered here.
>
> ☐ I agree to the publication of identifiable **photos** of the participant.
> ☐ I agree to the publication of identifiable **videos** of the participant.
>
> If the participant is a child, a parent or legal guardian makes these
> choices.

Both choices are saved with the registration and shown to admins next to
each participant, so the gallery team knows whose face may be published.

## 5. Instructors

### Instructor panel

- **No link to it anywhere on the site.** Instructors reach it only through
  a private address sent to them; the page is `noindex` and excluded from
  the sitemap.
- Own login (`/instructor/login`). Two ways in:
  - **Sign up on their own** at `/instructor/signup` (the team shares
    the address; the login page links to it): the full profile below,
    email and password, and "my details are correct". The instructor goes
    **straight into the panel**, with a "waiting for approval" banner and
    the "Please confirm your email" banner. Every super admin gets a
    "new instructor sign-up" email. A super admin checks the details and
    presses **Approve** (Instructors → the profile; the list shows how many
    wait); only approved instructors can be chosen for a workshop. The
    instructor gets a "you're approved" email.
  - **Added by an admin** (Instructors → New): approved from the start; the
    instructor gets an invitation email to choose a password.
- Profile in three languages.
- My workshops, participant lists and schedule.
- My contracts: read and sign; my earnings per workshop.
- When an instructor is stuck, the team can help from their profile in the
  super-admin panel: set a new password, or look at the panel through the
  instructor's account (never sign for them; [security](#11-security)).

### Profile fields

⭐ = required. 🔒 = private: used only for contracts and by admins, never
shown on the public site.

| Field | Required | Visibility | Notes |
| --- | :---: | --- | --- |
| Official full name | ⭐ | 🔒 | exactly as on ID; used in contracts |
| Display name (Turkish) | ⭐ | public | shown on the Turkish site |
| Display name (English) | ⭐ | public | shown on the English and Persian sites |
| ID number | ⭐ | 🔒 | stored **encrypted**; used in contracts |
| Mobile number | ⭐ | 🔒 | with country code |
| Email | ⭐ | 🔒 | login and contract emails; must be verified |
| Teaching field | ⭐ | public | e.g. painting, ceramics, candle making |
| Short introduction | | public | a few sentences, three languages |
| Teaching languages | | public | dropdown, multiple choice |
| Instagram or website | | public | link |
| Profile photo | | public | cropped square, optimized, on the CDN |

The form is one short, friendly page; the required fields come first.

## 6. Super-admin panel

A completely separate application area with its **own login**, not shared
with students or instructors.

- **Partners**: one to three super admins, who are also the business
  partners. The first one is created with the setup command; any partner
  invites the next ones from **Money → Partners** (name, email, language of
  the invitation): an email with a one-time link (7 days) to choose a
  password, and the same link shown once to copy (e.g. for WhatsApp). The
  new partner starts with a 0 % profit share until the partners set the
  shares again. Open invitations count towards the three, and can be sent
  again or cancelled. Each partner edits their own profile (**My profile**
  in the user menu): name, email (needs the current password) and photo.
  The photo (only partners see it) shows in the user menu, on the partners'
  cards and shares, and on the dashboard; without one, the initials.

### Dashboard

A premium dashboard with beautiful, smooth animated charts, clean cards and
a dark / light theme:

- revenue, expenses and net profit over time,
- registrations per workshop and fill rate,
- profit per workshop and per instructor,
- wallet balance and each partner's capital and share,
- upcoming workshops at a glance.

### Sections

| Section | What it does |
| --- | --- |
| **Workshops** | create and manage workshops ([lifecycle](#7-workshop-lifecycle)), categories |
| **Instructors** | profiles and contracts; set a new password, enter their panel |
| **Students** | everyone with an account: details, registrations; set a new password, enter their account |
| **Registrations** | view, filter, change status, refunds, export; photo / video consent per participant |
| **Money** | course finances, shared wallet, accounting reports ([money](#8-money-course-finances-wallet-and-accounting)) |
| **Content** | hero, pages, menus, home sections, FAQ, past-workshop galleries |
| **Templates** | registration terms, contract text, emails |
| **Settings** | brand name, default language, SEO defaults, active theme, CDN, watermark, payment methods |

## 7. Workshop lifecycle

```
1. Create workshop  →  2. Contract emailed  →  3. Instructor signs
        →  4. Published, registration open  →  5. Go / no-go decision
        →  6. Workshop held  →  7. Close workshop (final figures)
        →  8. Photos and videos  →  Past workshops
```

1. A super admin fills in the workshop and contract fields.
2. The contract is generated and **emailed to the instructor**.
3. The instructor reads and signs it in their panel.
4. Only then is the workshop published on the home page and registration
   opens. Registration closes automatically at the registration deadline.
5. **Go / no-go decision**: at the decision time the admins are notified
   with the number of registrations against the minimum. They confirm the
   workshop or cancel it; on cancellation every participant gets a
   friendly email, and everyone who paid is owed a full refund (listed in
   Money → Refunds until an admin pays it back).
6. The workshop takes place. Admins record course expenses.
7. An admin presses **Close workshop**: final figures are locked
   ([course finances](#course-finances)).
8. Admins upload photos and videos; the workshop moves to **Past
   workshops**.

### Workshop fields

Text fields are in three languages. Fields marked 🔗 are **shared with the
contract**: entered once, used in both. Changing one after the contract was
sent sends the instructor a new version to sign; filling in a missing
translation of the name or venue does not (that language showed the Turkish
text until then). Amounts are in **Turkish lira (₺)**.

| Field | Input |
| --- | --- |
| Workshop name 🔗 | text |
| Category | dropdown, managed by admins (e.g. candle making) |
| Instructor 🔗 | chosen from instructor profiles |
| Date 🔗 | date picker; weekday shown automatically |
| Start and end time 🔗 | time pickers; end after start |
| Venue 🔗 | text (Turkish required) |
| Age group | adults, or a children's age range (e.g. 7–12) |
| Minimum and maximum capacity 🔗 | two numbers; maximum ≥ minimum |
| Price per person | number, ₺ |
| Registration deadline | date and time |
| Go / no-go decision time 🔗 | date and time to check the minimum was reached |
| Short introduction | what will participants make or learn? |
| What the price includes | materials, tools, refreshments, other |
| What to bring | or "Nothing needed" |
| Previous experience needed? | yes / no, with a short note |
| Cover photo and sample work photos | images, on the CDN |
| Online payment link | optional: the iyziLink / PayTR link for this price, shown to registered students when online payment is on |
| Terms template | default or a specific one |
| Additional notes | only for what does not fit above |

### Contract fields

Besides the shared 🔗 fields above, the contract adds:

| Field | Input |
| --- | --- |
| Instructor fee type | **per participant** or **fixed for the whole workshop** |
| Agreed amount | number, ₺ (per person or total, depending on the type) |
| Advance payment? | yes / no; if yes, the amount in ₺ (≤ total) |

The fixed clauses (responsibilities, joint advertising, payments,
settlement, cancellations, participant data) are in
[docs/CONTRACT_TEMPLATE.md](docs/CONTRACT_TEMPLATE.md). The contract text
is an editable template in three languages; each signed contract keeps the
exact text that was signed.

## 8. Money: course finances, wallet and accounting

### Course finances

Every workshop has its own finances:

- **Revenue**: registrations × price per person, minus refunds.
- **Instructor fee**: from the contract, fixed or per participant.
- **Course expenses** (venue, materials, catering, advertising, ...): any
  super admin can add them, with the partner who paid.
- **Advance payment** to the instructor, deducted at settlement.
- A live summary while the workshop is running.

When the workshop ends, an admin presses **Close workshop**. The figures
are locked and the system shows exactly:

- total revenue, instructor fee and every expense,
- **net profit** of the workshop,
- **each partner's share** of that profit,

and posts the result to the shared wallet.

### Shared wallet and accounting

- One **shared wallet** for the whole business.
- Each partner records their **capital contributions** and the
  **expenses** they paid for the partnership.
- Registration income, refunds and instructor payouts go through the same
  wallet.
- Professional accounting on a **double-entry ledger**: every transaction
  balances; entries are never edited, only reversed.
- Reports:
  - wallet balance and transaction history,
  - each partner's capital, expenses paid and **ownership share**,
  - income and expenses by period, workshop and instructor,
  - profit and loss, and per-partner settlement,
  - CSV / PDF export and an audit trail of who did what.

### Payments

How students pay is a super-admin setting (**Settings → Payments**); any
combination can be switched on:

- **Cash** at the workshop.
- **Bank transfer** to the account in the settings (account holder, bank,
  IBAN, short instructions), shown to the student after registering.
- **Online payment link**: each workshop can have its own payment link
  (iyzico **iyziLink** or PayTR **Link ile Ödeme**), shown to the student
  after registering. Payment links are what iyzico and PayTR offer to
  individuals without a company.

In every case an admin records the payment (cash, transfer or online) in
the workshop's registrations list, or in Registrations, which lists every
workshop's registrations and finds a bank transfer by the name in its
description. That marks the registration as paid and books the income in
the wallet. Refunds are paid back by hand and marked as refunded in the
refunds list.

**Later:** a full gateway integration (iyzico checkout / PayTR iFrame) with
automatic confirmation. It needs a merchant account, which iyzico and PayTR
give to registered businesses (a sole proprietorship, *şahıs şirketi*, is
enough), not to individuals.

## 9. Emails

- Sent with **Resend** or any **SMTP server** (our own mail server or a
  service such as Brevo): chosen in **Settings → Email**, with the sender
  address and a "Send a test email" button. Keys and passwords are stored
  encrypted.
- **Beautiful branded templates** (React Email): logo, brand colours, clean
  layout, readable on phones and in dark mode.
- In each person's own language (the student's or instructor's language,
  chosen on the site or in the panel); emails to super admins use the default
  language, except the partner invitation, which uses the language chosen
  when inviting. Persian, Turkish and English use the same templates.
- Super admins can change every text, per language (**Templates → Emails**).

| Email | To | When |
| --- | --- | --- |
| Welcome + verify your email | student, instructor | sign-up, "send it again" |
| Account already exists | student | someone signs up with an email that already has an account |
| Instructor invitation | instructor | an admin adds or invites an instructor |
| New instructor sign-up | super admins | an instructor signed up on their own and waits for approval |
| Instructor approved | instructor | a super admin approved a self-registered instructor |
| Contract ready to sign | instructor | a workshop is created, or its contract changed |
| Contract signed | super admins | the instructor signed |
| Go / no-go decision due | super admins | the decision time has passed |
| Partner invitation | new partner | a partner invites them from Money → Partners (or sends it again) |
| Place reserved + how to pay | student | registered, not paid yet: the amount and every way to pay that is on |
| Registration confirmed | student | registered for a free workshop |
| Payment received | student | an admin recorded the payment: place confirmed |
| Registration cancelled | student | the student or an admin cancelled it, with the refund if one is owed |
| Refund to pay back | super admins | a cancellation left a refund to pay back by hand |
| Refund sent | student | an admin marked the refund as paid back |
| Workshop reminder | student | the day before; while unpaid, also what is still to pay and how |
| Workshop cancelled | student | the workshop is cancelled: a full refund for those who paid, "please don't come" for the others |
| Password reset | everyone | "Forgot your password?" |
| Password changed by the team | student, instructor | a super admin set a new password for them (the email never contains it) |

## 10. Media, CDN and watermark

### CDN

Chosen in the super-admin settings: **Bunny CDN** (one Bunny storage zone
with a pull zone) or **Cloudflare** (one R2 bucket with a custom domain),
with their keys. Every uploaded file (images, **videos**, the watermark logo
and the partners' photos) is stored as a plain file in that one storage
space and served from the CDN under a name nobody can guess (no streaming
service). The database stores only the file path.

Each part of the site has its own folder, named after the workshop or the
person: `workshops/<workshop>/` (the cover, `samples/`, `gallery/`,
`videos/`), `instructors/<name>/`, `partners/<name>/`, `brand/` (the
watermark logo) and `site/` (the home page's photos and video). Folder names are written in plain Latin letters (Turkish
letters without their marks); a partner whose name has no Latin letters
gets the name part of their email. A file keeps its folder when the
workshop or person is renamed later.

### Past workshops gallery

After a workshop is closed, admins upload its photos and videos. It then
appears in the **Past workshops** section: gallery with lightbox, photos,
videos and the workshop story, which also helps SEO. Only participants who
gave consent may be identifiable in published media.

### Watermark

Every gallery photo is **watermarked automatically on upload**, before it
is sent to the CDN; only the watermarked photo is kept (the original is
never stored). Settings:

- watermark logo (PNG with transparency),
- position: any of nine positions (corners, edges, centre) or tiled,
- size (percentage of the photo width), opacity and margin,
- live preview on a sample photo before saving.

## 11. Security

Security is the first requirement of every feature and is checked carefully
before each release.

- **Authentication**: separate logins and sessions for students,
  instructors and super admins; passwords hashed with Argon2; login rate
  limiting and lockout. Two-factor login (2FA) for super admins is planned
  for a later phase.
- **Authorization**: every request is checked on the server for role and
  ownership; nothing is trusted from the browser.
- **Input**: every input validated with Zod on the server; parameterized
  queries only (Drizzle), no raw SQL from user input.
- **Web protections**: CSRF protection, strict Content Security Policy,
  secure HTTP-only SameSite cookies, HSTS and security headers.
- **Personal data**: instructor ID numbers and signed contract texts (which
  contain them) stored encrypted; private fields never reach the public site.
  Contracts signed before their text was encrypted are encrypted once on
  deployment; backups made before that hold the plain text until they expire
  ([runbook](docs/DEVELOPMENT.md#encrypting-older-signed-contract-texts-once)).
- **Uploads**: type and size checked, images re-encoded (removes hidden
  content and metadata), random file names, no executable files.
- **Payments**: amounts always taken from the server, never from the
  browser; only admins record payments and refunds, each audited.
- **Contracts and money**: signed contracts and ledger entries are never
  edited, only reversed; a full audit log of admin actions.
- **Helping a student or instructor**: a super admin can set a new password
  for them (typed, or generated and shown only once; never stored in plain
  text or logged). The person is emailed, signed out everywhere, and their
  open reset links stop working. "Enter their panel / account" opens the
  person's panel or account in that browser for at most one hour, with a
  bar on every page and an **End** button back to the admin page. While
  viewing, nothing that must be the person's own is possible: signing a
  contract, registering for a workshop (terms and consents), changing
  their password. Starting, ending and everything done there is in the
  audit log under the admin's name. Such a session also ends when the
  admin signs out or is deactivated, and it can never reach the
  super-admin panel or be opened for an admin account.
- **Secrets** only in environment variables (Coolify), never in the code.
- **Data**: daily encrypted database backups; least-privilege database
  user.
- **Review**: dependency vulnerability scanning and a security review of
  every change before deployment.

## 12. Technology

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Styling / UI | Tailwind CSS 4, shadcn/ui, Motion (formerly Framer Motion) |
| Charts | Recharts (via shadcn/ui charts) |
| Fonts | self-hosted with `next/font/local`: IRANSans, Inter |
| Database | PostgreSQL |
| ORM / migrations | Drizzle ORM, drizzle-kit (generated SQL migrations, hand-edited when data must be converted) |
| Auth | Own session code (src/lib/auth): database sessions, Argon2id, lockout; separate logins for students, instructors and super admins |
| i18n | next-intl (fa, tr, en; RTL for Persian) |
| Validation / forms | Zod, React Hook Form |
| Contracts | text built from an editable template in three languages; signed with the typed name, with the evidence (time, IP, browser) and the exact text kept (encrypted) with its SHA-256; print view for paper or PDF |
| Encryption | AES-256-GCM (Node.js crypto) for instructor ID numbers, signed contract texts and CDN keys |
| Image processing | sharp (auto-rotate, resize, strip metadata, WebP, watermark) |
| Media | Bunny CDN or Cloudflare R2 (plain files, no streaming service); a local folder in development |
| Email | Resend + React Email |
| Payments | cash, bank transfer, online payment links (iyziLink / PayTR); recorded by admins. Gateway integration later |
| Testing | Vitest (against a test database), Playwright (end to end, against a production build) |
| Deployment | **Coolify** on the owner's server: Docker, PostgreSQL alongside with daily backups, auto-deploy on push |

## 13. Data model

Kept minimal; the whole schema is `src/db/schema.ts`.

- **Three languages everywhere**: translatable text is one `jsonb` column
  `{ fa, tr, en }` on its own table (workshop name and venue, bios,
  category names, template bodies, …). There is no translations table.
- **Money** is an integer number of kuruş. **Times** are `timestamptz`
  (an instant, kept in UTC, no time zone stored) shown in Istanbul time;
  ledger dates (`occurred_on`) are plain dates.
- **Private data**: the instructor ID number and the signed contract text
  (which contains it) are encrypted; the other private fields (official
  name, mobile, email) are plain columns that never reach the public site.
  Sessions and email links keep only the SHA-256 of their token.

| Table | Purpose |
| --- | --- |
| `admins` | super admins / partners (separate login), profit share, profile photo |
| `admin_invites` | open invitations to become a partner (only the link token's SHA-256 is stored) |
| `members` | students; language of their emails |
| `instructors` | public profile (three languages) and private fields: official name, ID number (encrypted), mobile, email |
| `sessions` | login sessions of admins, instructors and members, kept on the server (`impersonated_by`: a super admin viewing as an instructor or member, one hour) |
| `email_tokens` | one-time email links: verify email, reset password, instructor invite |
| `categories` | workshop categories |
| `templates` | editable terms and contract templates, one default of each |
| `courses` | workshop fields, status, terms template, online payment link, final participant number, closed totals |
| `contracts` | one row per contract version: fee type, amount, advance, status (sent, signed, void), signature evidence, the exact signed text (encrypted) and its SHA-256 |
| `registrations` | member ↔ course: participant, status (registered, paid, cancelled), amount, payment method (cash, transfer, online), accepted terms and time, photo / video consent, refund owed and refunded date, reminder sent |
| `media` | sample work, gallery photos (watermarked) and videos (CDN paths) |
| `ledger_transactions` | double-entry accounting: one row per movement of money (registration, refund, expense, capital, instructor advance or payment, closing, reversal) |
| `ledger_lines` | the lines of each transaction (account, partner, amount); they always sum to zero |
| `settings` | key / value: brand name, default language, SEO, theme, CDN, watermark, email texts |
| `audit_log` | who did what in the super-admin panel |

Course expenses are ledger transactions linked to their workshop (paid from
the wallet or by a partner), not a table of their own. The database itself
rejects an unbalanced transaction and any change to ledger or audit rows: a
correction is a reversal. A workshop is awaiting signature, published,
confirmed, then closed (held and settled, figures locked), or cancelled; a
cancelled workshop keeps that status once its books are closed.

Later phases add editable pages and home sections, FAQs and the shop
(`products`, `orders`, `order_items`).

## 14. Build order

1. **Super-admin panel first**: project setup, database, admin login,
   instructors, workshops, contracts, course finances, shared wallet and
   accounting, settings, charts dashboard.
2. Instructor panel; student sign-up and registration on the site, with
   payment status per registration (payments recorded by hand).
3. Public site on top of the theme system (first theme after the
   throttlehaus.ca reference).
4. **Later phase**:
   - **Shop**: a built-in, lightweight, professional store (products with
     variants and stock in three languages, cart, checkout with iyzico /
     PayTR, orders in the student's account menu, sales in the shared
     wallet and reports).
   - **Gateway integration** (iyzico / PayTR) with automatic payment
     confirmation, once there is a registered business.
   - Two-factor login (2FA) for super admins.
