# Lart

Lart is a professional landing website for arts and educational classes, with
a focus on a **workshop tour**. Visitors browse the latest workshops, create an
account, choose a class and register. A separate super-admin panel runs the
business: classes, instructors, contracts, a shared partner wallet and full
accounting.

> **Status:** project brief. No code has been written yet.

## Design reference

The look and feel follows the owner's previous project,
**[throttlehaus.ca](https://throttlehaus.ca/)**: the same layout, the same
premium feel and an animated (video) hero, rebuilt for Lart in three
languages.

## Everything is editable

Nothing on the site is hard-coded. From the super-admin panel:

- **Hero**: replace the moving hero video or image, headline, subtitle and
  call-to-action button, per language.
- **Every page and section** (home, about, contact, FAQ, footer, menus) is
  editable in FA / TR / EN, with its own SEO title and description.
- Sections on the home page can be shown, hidden and reordered.

## Principles

- **Three languages everywhere**: Persian (RTL), Turkish and English. Every
  menu, page, email and admin label is translated. The **default language can
  be changed** from the admin panel in one setting.
- **Best-possible SEO, always**: server rendering, per-language URLs
  (`/fa`, `/tr`, `/en`) with `hreflang`, translated metadata and Open Graph,
  structured data (`Course`, `Event`, `Person`, `Organization`), sitemap,
  canonical URLs, fast Core Web Vitals and optimized images.
- **A lean database**: only the tables and columns that are needed, no
  duplicated data, no premature features.
- **Premium, mobile-first design** with polished navigation.

## Public site

- **Home page**: refined navigation menu, hero, and the **latest workshops**
  and classes (a class appears here once its instructor contract is signed).
- **Classes and workshops**: list and detail pages with instructor, schedule,
  capacity, seats left and price.
- **Instructors**: list with photo and biography, each with their classes.
- **Gallery**, **FAQ**, **About**, **Contact**.
- **Language switcher** (FA / TR / EN) on every page.

## Shop (planned for a later phase)

> Not part of the first release. Planned for a later phase.

A built-in, lightweight, professional store inside the site, not a separate
hosted platform, so members, the three languages, SEO and the shared wallet
stay in one place:

- Products with photos, variants (size, colour), price, stock and
  descriptions in three languages.
- Cart, checkout and order confirmation emails.
- **Turkish payment gateways: iyzico and PayTR** (choose in admin settings);
  the same gateways also take class registration payments.
- Members see their orders in their dashboard.
- Admin: products, categories, stock, orders and order status.
- Shop sales go into the shared wallet and show up in the accounting
  reports.

## Members

- Sign up and log in (email and password; social login optional).
- Choose a class and register for it.
- Personal dashboard: my registrations and their status.

## Super-admin panel

A completely separate application area with its **own login**, not shared with
site members.

- **Partners**: one to three super admins, who are also the business
  partners.
- **Content**: classes and workshops, instructors (photo, bio), gallery, FAQ,
  pages, all in three languages.
- **Members and registrations**: view, filter, change status, export.
- **Instructor contracts**: when a course is created with an instructor, a
  contract is generated automatically from a template with that course's
  details (dates, sessions, fee or revenue share). The instructor signs it
  electronically through a secure link. After signing, the class is published
  on the home page.
- **Settings**: default language, site details, SEO defaults, and the
  **media CDN**: choose **Bunny CDN** (Bunny Storage) or **Cloudflare**
  (R2 + Cloudflare CDN), with their keys. Every uploaded image **and video**
  is stored as a plain file on the selected CDN and served from it (no
  streaming service). The database stores only the file path.

## Course finances and closing

Every course has its own finances:

- **Customer price**: the price shown on the public site.
- **Instructor fee**, chosen per course: a fixed fee for the whole course,
  or a fee per participant.
- **Course expenses** (venue, materials, catering, advertising, ...): any
  super admin can add them, with the partner who paid.
- A live course summary: registrations, revenue, instructor fee, expenses.

When the course ends, an admin presses **Close course**. The system then
locks the figures and shows exactly:

- total revenue, instructor fee and every expense,
- **net profit** of the course,
- **each partner's share** of that profit,

and posts the result to the shared wallet ledger.

### Past courses

After closing, admins upload the course photos and videos. The course then
moves to an elegant **Past courses** section (gallery with lightbox, photos
and video, course story), which also helps SEO.

## Shared wallet and accounting

- One **shared wallet** for the whole business.
- Each partner can record **capital contributions** and the **expenses** they
  paid on behalf of the partnership.
- Income from class registrations and payouts to instructors go through the
  same wallet.
- Professional accounting built on a **double-entry ledger** (every
  transaction balanced; entries are never edited, only reversed):
  - wallet balance and transaction history,
  - each partner's capital, expenses paid and **ownership share**,
  - income and expense reports by period, class and instructor,
  - profit and loss, and per-partner settlement,
  - CSV / PDF export and an audit trail of who did what.

## Technology

| Layer | Choice |
| --- | --- |
| Framework | Next.js (App Router), React, TypeScript |
| Styling / UI | Tailwind CSS, shadcn/ui, Framer Motion |
| Database | PostgreSQL |
| ORM / migrations | Drizzle ORM |
| Auth | Auth.js; separate sessions for members and super admins, 2FA for admins |
| i18n | next-intl (fa, tr, en; RTL for Persian) |
| Validation / forms | Zod, React Hook Form |
| Contracts | PDF generation and e-signature with a signed audit record |
| Media | Bunny CDN or Cloudflare R2 for images and videos (plain CDN files, no streaming service) |
| Email | Transactional email provider (e.g. Resend) |
| Testing | Vitest, Playwright |
| Payments | iyzico and PayTR (Turkish gateways) |
| Deployment | **Coolify** on the owner's server: Docker, PostgreSQL alongside with daily backups, auto-deploy on push |

## Data model (draft, kept minimal)

| Table | Purpose |
| --- | --- |
| `admins` | super admins / partners (separate login) |
| `members` | site users |
| `instructors` | photo, bio |
| `courses` | class or workshop, instructor, dates, capacity, price, instructor fee type and amount, status, closed totals |
| `registrations` | member ↔ course, status |
| `contracts` | course ↔ instructor, terms, signature, signed date |
| `translations` | text for fa / tr / en, keyed by entity and field |
| `course_expenses` | expenses of a course, who paid |
| `ledger_entries` | double-entry wallet accounting (contributions, expenses, income, payouts) |
| `products`, `orders`, `order_items` | shop (later phase) |
| `pages`, `sections` | editable pages, hero and home sections |
| `media`, `faqs`, `settings` | gallery, FAQ, site settings incl. default language |
