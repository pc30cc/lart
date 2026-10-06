# Lart

Lart is a professional website for **arts and educational workshops**.
Visitors browse the latest workshops, create an account and register for a
class. Instructors work in their own private panel, and a separate
super-admin panel runs the business: workshops, instructors, contracts,
course finances, a shared partner wallet and full accounting.

> **Status:** project brief. No code has been written yet.

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
  menu, page, email and panel label. The **default language** is one
  setting in the super-admin panel.
- **Best-possible SEO, always.** Server rendering, per-language URLs
  (`/fa`, `/tr`, `/en`) with `hreflang`, translated metadata and Open Graph,
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

| Language | Font | Notes |
| --- | --- | --- |
| Persian | **IRANSans** | Persian digits, RTL; font files taken from the owner's other repositories |
| Turkish | **Inter** | full Turkish set (ç ğ ı İ ö ş ü), excellent on screen |
| English | **Inter** | same family as Turkish for a consistent look |

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
- The active theme is chosen in the super-admin settings.
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

- **Hero**: the moving hero video or image, headline, subtitle and
  call-to-action button, per language.
- **Every page and section** (home, about, contact, FAQ, footer, menus) in
  FA / TR / EN, each with its own SEO title and description.
- Home-page sections can be shown, hidden and reordered.

## 4. Students

**Students have no panel.** Everything happens on the public site itself.

- Sign up and log in right on the site (small account button in the menu).
- Choose a workshop and register on its page.
- The workshop page shows "You are registered" for workshops they joined;
  the account menu lists their workshops. Nothing more.

### Sign-up and email verification

- After signing up, the student goes **straight back to the site**; no
  waiting.
- A gentle, always-visible banner says **"Please confirm your email"**,
  with a button to resend the email, until the email is verified.
- Registering and paying for a workshop needs a verified email; the site
  asks for it in plain words.

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
admin confirms it.

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
- Own login. After sign-up the instructor goes **straight into the panel**,
  with the same "Please confirm your email" banner until verified.
- Profile in three languages.
- My workshops, participant lists and schedule.
- My contracts: read and sign; my earnings per workshop.

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
  partners.

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
| **Instructors** | profiles and contracts |
| **Registrations** | view, filter, change status, refunds, export; photo / video consent per participant |
| **Money** | course finances, shared wallet, accounting reports ([money](#8-money-course-finances-wallet-and-accounting)) |
| **Content** | hero, pages, menus, home sections, FAQ, past-workshop galleries |
| **Templates** | registration terms, contract text, emails |
| **Settings** | brand name, default language, SEO defaults, active theme, CDN, watermark, payment gateway |

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
   friendly email and a full refund automatically.
6. The workshop takes place. Admins record course expenses.
7. An admin presses **Close workshop**: final figures are locked
   ([course finances](#course-finances)).
8. Admins upload photos and videos; the workshop moves to **Past
   workshops**.

### Workshop fields

Text fields are in three languages. Fields marked 🔗 are **shared with the
contract**: entered once, used in both. Amounts are in **Turkish lira (₺)**.

| Field | Input |
| --- | --- |
| Workshop name 🔗 | text |
| Category | dropdown, managed by admins (e.g. candle making) |
| Instructor 🔗 | chosen from instructor profiles |
| Date 🔗 | date picker; weekday shown automatically |
| Start and end time 🔗 | time pickers; end after start |
| Venue 🔗 | text |
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

Online payments through the Turkish gateways **iyzico** and **PayTR**,
chosen in the settings.

## 9. Emails

- Sent with **Resend**.
- **Beautiful branded templates** (React Email): logo, brand colours, clean
  layout, readable on phones and in dark mode.
- **Turkish** by default; Persian and English use the same templates.

| Email | To |
| --- | --- |
| Welcome + verify your email | student, instructor |
| Contract ready to sign | instructor |
| Contract signed | super admins |
| Go / no-go decision due | super admins |
| Registration confirmed | student |
| Workshop reminder | student |
| Workshop cancelled + refund | student |
| Password reset | everyone |

## 10. Media, CDN and watermark

### CDN

Chosen in the super-admin settings: **Bunny CDN** (Bunny Storage) or
**Cloudflare** (R2 + Cloudflare CDN), with their keys. Every uploaded image
**and video** is stored as a plain file on the selected CDN and served from
it (no streaming service). The database stores only the file path.

### Past workshops gallery

After a workshop is closed, admins upload its photos and videos. It then
appears in the **Past workshops** section: gallery with lightbox, photos,
videos and the workshop story, which also helps SEO. Only participants who
gave consent may be identifiable in published media.

### Watermark

Every gallery photo is **watermarked automatically on upload**, before it
is sent to the CDN; the original stays private for admins. Settings:

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
- **Personal data**: instructor ID numbers encrypted; private fields never
  reach the public site.
- **Uploads**: type and size checked, images re-encoded (removes hidden
  content and metadata), random file names, no executable files.
- **Payments**: gateway callbacks verified by signature; amounts always
  taken from the server, never from the browser.
- **Contracts and money**: signed contracts and ledger entries are never
  edited, only reversed; a full audit log of admin actions.
- **Secrets** only in environment variables (Coolify), never in the code.
- **Data**: daily encrypted database backups; least-privilege database
  user.
- **Review**: dependency vulnerability scanning and a security review of
  every change before deployment.

## 12. Technology

| Layer | Choice |
| --- | --- |
| Framework | Next.js (App Router), React, TypeScript |
| Styling / UI | Tailwind CSS, shadcn/ui, Framer Motion |
| Charts | Recharts (via shadcn/ui charts) |
| Fonts | self-hosted with `next/font/local`: IRANSans, Inter |
| Database | PostgreSQL |
| ORM / migrations | Drizzle ORM |
| Auth | Auth.js; separate logins for students, instructors and super admins |
| i18n | next-intl (fa, tr, en; RTL for Persian) |
| Validation / forms | Zod, React Hook Form |
| Contracts | PDF generation and e-signature with a signed audit record |
| Image processing | sharp (resize, WebP / AVIF, watermark) |
| Media | Bunny CDN or Cloudflare R2 (plain files, no streaming service) |
| Email | Resend + React Email |
| Payments | iyzico, PayTR |
| Testing | Vitest, Playwright |
| Deployment | **Coolify** on the owner's server: Docker, PostgreSQL alongside with daily backups, auto-deploy on push |

## 13. Data model

Draft, kept minimal.

| Table | Purpose |
| --- | --- |
| `admins` | super admins / partners (separate login) |
| `members` | students |
| `instructors` | profile; private fields encrypted where needed |
| `categories` | workshop categories |
| `courses` | workshop fields, status, terms template, closed totals |
| `contracts` | course ↔ instructor: fee type, amount, advance, signed text, signature, signed time |
| `registrations` | member ↔ course: status, accepted terms and time, photo / video consent, refund |
| `course_expenses` | expenses of a workshop and the partner who paid |
| `ledger_entries` | double-entry wallet accounting |
| `translations` | text for fa / tr / en, keyed by entity and field |
| `terms` | terms templates, one default |
| `pages`, `sections` | editable pages, hero and home sections |
| `media` | photos and videos (CDN paths) |
| `faqs` | FAQ |
| `settings` | brand name, default language, theme, CDN, watermark, gateway |
| `products`, `orders`, `order_items` | shop (later phase) |

## 14. Build order

1. **Super-admin panel first**: project setup, database, admin login,
   instructors, workshops, contracts, course finances, shared wallet and
   accounting, settings, charts dashboard.
2. Instructor panel; student sign-up and registration on the site.
3. Public site on top of the theme system (first theme after the
   throttlehaus.ca reference).
4. **Later phase**:
   - **Shop**: a built-in, lightweight, professional store (products with
     variants and stock in three languages, cart, checkout with iyzico /
     PayTR, orders in the student's account menu, sales in the shared
     wallet and reports).
   - Two-factor login (2FA) for super admins.
