# Lart

Lart is a professional landing website for arts and educational classes. Its
main focus is a **workshop tour**: a series of workshops held in different
cities and venues, which visitors can browse and register for.

> Status: project brief. No code has been written yet.

## Goals

- A polished, fast, mobile-first public landing site that presents the
  classes and the workshop tour and turns visitors into registrations.
- An admin panel where the team manages all site content and registrations
  without touching code.
- PostgreSQL as the database.
- A modern React-based stack chosen for performance, SEO and maintainability.

## Public site

- **Hero**: headline, call to action, featured upcoming workshop.
- **Workshop tour**: list/timeline of tour stops (city, venue, dates, seats
  left), each with a detail page.
- **Classes and courses**: art and educational classes with category,
  level, schedule, price and instructor.
- **Instructors**: profiles with bio, photo and their classes.
- **Gallery**: photos and videos from past workshops.
- **Testimonials** and **FAQ**.
- **Registration / booking** form for a class or tour stop, with email
  confirmation.
- **Contact** form and newsletter sign-up.
- SEO (server rendering, metadata, Open Graph, sitemap), accessibility and
  multilingual support (English and Persian, including RTL layout).

## Admin panel

- Secure login with roles (admin, editor).
- Dashboard: upcoming workshops, recent registrations, seats filled.
- Create, edit and publish: workshops / tour stops, classes, instructors,
  gallery media, testimonials, FAQ and page content.
- Manage registrations: view, filter, change status, export to CSV.
- View contact messages and newsletter subscribers.
- Media uploads (images, video).

## Proposed technology

| Layer | Choice |
| --- | --- |
| Framework | Next.js (App Router), React, TypeScript |
| Styling / UI | Tailwind CSS, shadcn/ui, Framer Motion |
| Database | PostgreSQL |
| ORM / migrations | Drizzle ORM (or Prisma) |
| Auth | Auth.js (NextAuth) with role-based access |
| Validation / forms | Zod, React Hook Form |
| Media storage | S3-compatible object storage |
| Email | Transactional email provider (e.g. Resend) |
| i18n | next-intl (English, Persian with RTL) |
| Testing | Vitest, Playwright |
| Deployment | Docker (e.g. on Coolify) with managed PostgreSQL |

## Core data model (draft)

- `users` (admin accounts, role)
- `instructors`
- `categories`
- `classes` (category, instructor, level, price, schedule)
- `workshops` / `tour_stops` (city, venue, start/end date, capacity)
- `registrations` (person, contact, class or tour stop, status)
- `media` (gallery items)
- `testimonials`, `faqs`, `pages`
- `contact_messages`, `newsletter_subscribers`
