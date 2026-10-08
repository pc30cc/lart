import { sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

/**
 * Lean schema. Conventions:
 * - Money is an integer number of kuruş (1 ₺ = 100 kuruş), never a float.
 * - Translatable text is one `jsonb` column of shape { fa?, tr?, en? }.
 * - Times are `timestamptz`; the business time zone is Europe/Istanbul.
 */

export type Locale = "fa" | "tr" | "en"
export type LocalizedText = Partial<Record<Locale, string>>

const id = () => uuid("id").primaryKey().defaultRandom()
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
const money = (name: string) => bigint(name, { mode: "number" })
const localized = (name: string) => jsonb(name).$type<LocalizedText>()

// ─── People ────────────────────────────────────────────────────────────────

/** Super admins. They are also the business partners (one to three). */
export const admins = pgTable("admins", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  /** Share of profit in basis points (10000 = 100 %). Shares sum to 10000. */
  shareBp: integer("share_bp").notNull().default(0),
  active: boolean("active").notNull().default(true),
  failedLogins: smallint("failed_logins").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  /** Profile photo (`partners/<name>/photo-<random>.webp`; older ones `admins/…`): stored like every other file, shown only inside the panel. */
  photoPath: text("photo_path"),
  /**
   * The partner on the public Our story page (/story), filled in by themselves on
   * My profile: shown only while `aboutShown` (their consent to publish), with
   * a public portrait (`partners/<name>/portrait-<random>.webp`, never the
   * panel's photo), their name as each language writes it (else `name`), a
   * role and a few words about them, in Persian, Turkish and English.
   */
  aboutShown: boolean("about_shown").notNull().default(false),
  aboutName: localized("about_name").notNull().default({}),
  aboutRole: localized("about_role").notNull().default({}),
  aboutBio: localized("about_bio").notNull().default({}),
  portraitPath: text("portrait_path"),
  createdAt: createdAt(),
}, (t) => [
  check("admins_share_bp_range", sql`${t.shareBp} between 0 and 10000`),
])

/**
 * Invitations to become a partner, sent from the partners page. The admin row
 * is created only when the invitation is accepted. Only the SHA-256 of the
 * link's token is stored. One invitation per email (an expired one is
 * replaced when the address is invited again).
 */
export const adminInvites = pgTable("admin_invites", {
  id: id(),
  /** Lower-case, as admin emails are stored. */
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  /** fa, tr or en: the language of the email and of the accept page. */
  locale: text("locale").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  invitedBy: uuid("invited_by").notNull().references(() => admins.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
})

/** Students. They have no panel; they use the public site. */
export const members = pgTable("members", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  phone: text("phone"),
  /** Language of the member's emails (the language they signed up in, or chose later). */
  locale: text("locale").notNull().default("tr"),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  failedLogins: smallint("failed_logins").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  createdAt: createdAt(),
})

export const instructors = pgTable("instructors", {
  id: id(),
  email: text("email").notNull().unique(),
  /** Null until the instructor sets a password from the invite email. */
  passwordHash: text("password_hash"),
  // Private: contracts and admins only.
  officialName: text("official_name").notNull(),
  /** AES-256-GCM ciphertext (see lib/crypto). Never sent to the public site. */
  idNumberEnc: text("id_number_enc").notNull(),
  mobile: text("mobile").notNull(),
  // Public.
  displayName: localized("display_name").notNull(),
  teachingField: localized("teaching_field").notNull(),
  bio: localized("bio"),
  /** Locale-independent codes, e.g. ["fa", "tr", "en"]. */
  teachingLanguages: text("teaching_languages").array().notNull().default(sql`'{}'::text[]`),
  website: text("website"),
  photoPath: text("photo_path"),
  /** Language of the instructor's emails and panel. */
  locale: text("locale").notNull().default("tr"),
  active: boolean("active").notNull().default(true),
  /**
   * When an admin approved the instructor. Null for someone who signed up on
   * their own and is still waiting: they can use their panel, but cannot be
   * chosen for a workshop. Admins' own instructors are approved on creation.
   */
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  failedLogins: smallint("failed_logins").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

// ─── Auth ──────────────────────────────────────────────────────────────────

export const principalKind = pgEnum("principal_kind", ["admin", "instructor", "member"])

/** Server-side sessions. `id` is the SHA-256 of the cookie token. */
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  kind: principalKind("kind").notNull(),
  subjectId: uuid("subject_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  /**
   * Set while a super admin views the panel as this person ("Enter their
   * panel"): 1 hour from `created_at`, never extended. Deleting the admin
   * ends these sessions (never turns them into the person's own).
   */
  impersonatedBy: uuid("impersonated_by").references(() => admins.id, { onDelete: "cascade" }),
}, (t) => [
  index("sessions_subject_idx").on(t.kind, t.subjectId),
  index("sessions_impersonated_by_idx").on(t.impersonatedBy),
  check("sessions_impersonation_kind", sql`${t.impersonatedBy} is null or ${t.kind} <> 'admin'`),
])

export const tokenPurpose = pgEnum("token_purpose", ["verify_email", "reset_password", "invite"])

/** One-time email tokens. `id` is the SHA-256 of the token in the link. */
export const emailTokens = pgTable("email_tokens", {
  id: text("id").primaryKey(),
  purpose: tokenPurpose("purpose").notNull(),
  kind: principalKind("kind").notNull(),
  subjectId: uuid("subject_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
})

// ─── Workshops ─────────────────────────────────────────────────────────────

export const categories = pgTable("categories", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: localized("name").notNull(),
  sort: integer("sort").notNull().default(0),
})

export const templateKind = pgEnum("template_kind", ["terms", "contract"])

/** Editable text templates. Exactly one default per kind. */
export const templates = pgTable("templates", {
  id: id(),
  kind: templateKind("kind").notNull(),
  name: text("name").notNull(),
  body: localized("body").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("templates_one_default_per_kind").on(t.kind).where(sql`${t.isDefault}`),
])

/**
 * Workshop lifecycle (README §7). A change to a contract field sends a
 * published or confirmed workshop back to "awaiting_signature" (a confirmed one
 * keeps `final_participants`; signing confirms it again).
 *
 * - "closed" means held and settled: a confirmed workshop that has ended, whose
 *   instructor fee was accrued and whose profit or loss went to the partners
 *   (money/closing.ts). `closed_at` and `closed_totals` are set, its figures are
 *   locked (no more workshop postings), and only then can the gallery be filled.
 * - A cancelled workshop is closed too (its books locked, `closed_at` and
 *   `closed_totals` set), but it keeps status "cancelled": status "cancelled"
 *   with `closed_at` set means "cancelled, books closed"; `closed_at` null
 *   means "cancelled, books still open".
 * - Older rows may have status "closed" with `cancelled_at` set (closed before
 *   that rule): treat them as cancelled (`isCancelled`, `displayStatus` and the
 *   list views in features/workshops).
 */
export const courseStatus = pgEnum("course_status", [
  "awaiting_signature", // contract sent, not yet signed
  "published", // signed, visible, registration open until the deadline
  "confirmed", // go decision taken; final participant number fixed
  "cancelled", // no-go or cancelled by an admin; stays "cancelled" after its books are closed (closed_at set)
  "closed", // held, ended and settled; figures locked (never for a cancelled workshop, except older rows with cancelled_at)
])

/** A workshop. Fields shared with the contract live here once. */
export const courses = pgTable("courses", {
  id: id(),
  slug: text("slug").notNull().unique(),
  status: courseStatus("status").notNull().default("awaiting_signature"),
  categoryId: uuid("category_id").notNull().references(() => categories.id),
  instructorId: uuid("instructor_id").notNull().references(() => instructors.id),
  title: localized("title").notNull(),
  intro: localized("intro"),
  includes: localized("includes"),
  bring: localized("bring"),
  notes: localized("notes"),
  experienceRequired: boolean("experience_required").notNull().default(false),
  experienceNote: localized("experience_note"),
  /** Null/null means adults. */
  ageMin: smallint("age_min"),
  ageMax: smallint("age_max"),
  /** Where it takes place, like the title in three languages (Turkish required). */
  venue: localized("venue").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  minCapacity: smallint("min_capacity").notNull(),
  maxCapacity: smallint("max_capacity").notNull(),
  price: money("price").notNull(),
  registrationDeadline: timestamp("registration_deadline", { withTimezone: true }).notNull(),
  decisionAt: timestamp("decision_at", { withTimezone: true }).notNull(),
  /** Null means the default terms template. */
  termsTemplateId: uuid("terms_template_id").references(() => templates.id),
  coverPath: text("cover_path"),
  /** Online payment link for this workshop's price (iyzico / PayTR link), shown to registered students. */
  paymentUrl: text("payment_url"),
  /** When the admins were told the go / no-go decision is due. */
  decisionNotifiedAt: timestamp("decision_notified_at", { withTimezone: true }),
  /** Fixed at the go decision; the per-participant fee is based on it. */
  finalParticipants: smallint("final_participants"),
  /** Locked figures written when the workshop's books are closed (also a cancelled one). */
  closedTotals: jsonb("closed_totals").$type<ClosedTotals>(),
  /** First signature; kept when a later contract version sends it back to awaiting_signature. */
  publishedAt: timestamp("published_at", { withTimezone: true }),
  /** When it was cancelled. Also set on older rows that were later closed as status "closed". */
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  /** When its books were closed: status "closed", or "cancelled" for a cancelled workshop (see courseStatus). */
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdBy: uuid("created_by").notNull().references(() => admins.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("courses_status_starts_idx").on(t.status, t.startsAt),
  check("courses_times", sql`${t.endsAt} > ${t.startsAt}`),
  check("courses_capacity", sql`${t.minCapacity} >= 1 and ${t.maxCapacity} >= ${t.minCapacity}`),
  check("courses_price", sql`${t.price} >= 0`),
])

export type ClosedTotals = {
  revenue: number
  instructorFee: number
  expenses: number
  netProfit: number
  participants: number
  partners: { adminId: string; name: string; shareBp: number; amount: number }[]
}

export const contractStatus = pgEnum("contract_status", ["sent", "signed", "void"])
export const feeType = pgEnum("fee_type", ["per_participant", "fixed"])

/**
 * Instructor contract for one workshop. A change to the workshop after
 * signing voids the contract and a new version is sent (clause 9.2).
 */
export const contracts = pgTable("contracts", {
  id: id(),
  courseId: uuid("course_id").notNull().references(() => courses.id),
  version: smallint("version").notNull().default(1),
  instructorId: uuid("instructor_id").notNull().references(() => instructors.id),
  status: contractStatus("status").notNull().default("sent"),
  templateId: uuid("template_id").notNull().references(() => templates.id),
  feeType: feeType("fee_type").notNull(),
  /** Per participant or total, depending on feeType. */
  feeAmount: money("fee_amount").notNull(),
  /** 0 means no advance payment. */
  advanceAmount: money("advance_amount").notNull().default(0),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  // Signature evidence. The exact text signed is kept; templates may change later.
  signedAt: timestamp("signed_at", { withTimezone: true }),
  signedName: text("signed_name"),
  signedLocale: text("signed_locale"),
  /**
   * The exact text signed, AES-256-GCM ciphertext ("v1.…", lib/crypto): it
   * contains the instructor's ID number. Written and read only through
   * features/contracts/signed-text.ts, which decrypts server-side for admins
   * (and, in phase 2, the signing instructor). Rows signed before it was
   * encrypted may still hold the plain text until `pnpm contracts:encrypt` runs.
   */
  signedText: text("signed_text"),
  /** SHA-256 (hex) of the plain signed text, not of the ciphertext: the evidence. */
  signedTextSha256: text("signed_text_sha256"),
  signedIp: text("signed_ip"),
  signedUserAgent: text("signed_user_agent"),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("contracts_course_version").on(t.courseId, t.version),
  uniqueIndex("contracts_one_live_per_course").on(t.courseId).where(sql`${t.status} <> 'void'`),
  check("contracts_amounts", sql`${t.feeAmount} >= 0 and ${t.advanceAmount} >= 0`),
])

export const registrationStatus = pgEnum("registration_status", [
  "pending", // registered, holds a seat, not paid yet
  "confirmed", // registered and paid (payment recorded by an admin)
  "cancelled",
])

export const registrations = pgTable("registrations", {
  id: id(),
  courseId: uuid("course_id").notNull().references(() => courses.id),
  memberId: uuid("member_id").notNull().references(() => members.id),
  /** The person attending (may be the member's child). */
  participantName: text("participant_name").notNull(),
  status: registrationStatus("status").notNull().default("pending"),
  amount: money("amount").notNull(),
  termsTemplateId: uuid("terms_template_id").notNull().references(() => templates.id),
  termsSha256: text("terms_sha256").notNull(),
  termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }).notNull(),
  photoConsent: boolean("photo_consent").notNull().default(false),
  videoConsent: boolean("video_consent").notNull().default(false),
  /**
   * How the payment was made, recorded by an admin: "cash", "transfer" (to the
   * bank account in the settings) or "online" (through the workshop's payment
   * link, e.g. iyziLink / PayTR "Link ile Ödeme"). A gateway integration with
   * automatic confirmation comes in a later phase.
   */
  paymentMethod: text("payment_method"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  /** Owed back to the payer (set at cancellation); refunded_at once paid back. */
  refundAmount: money("refund_amount"),
  refundedAt: timestamp("refunded_at", { withTimezone: true }),
  /** When the day-before reminder email was sent (the job sends it once). */
  reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  index("registrations_course_idx").on(t.courseId, t.status),
  index("registrations_member_idx").on(t.memberId),
  check("registrations_amounts", sql`${t.amount} >= 0 and coalesce(${t.refundAmount}, 0) between 0 and ${t.amount}`),
  check("registrations_payment_method", sql`${t.paymentMethod} in ('cash', 'transfer', 'online')`),
])

export const mediaKind = pgEnum("media_kind", ["sample", "gallery_photo", "gallery_video"])

/** Photos and videos of a workshop. Files live on the CDN; only paths here. */
export const media = pgTable("media", {
  id: id(),
  courseId: uuid("course_id").notNull().references(() => courses.id),
  kind: mediaKind("kind").notNull(),
  path: text("path").notNull(),
  width: integer("width"),
  height: integer("height"),
  sort: integer("sort").notNull().default(0),
  createdAt: createdAt(),
}, (t) => [index("media_course_idx").on(t.courseId, t.kind, t.sort)])

// ─── Money: double-entry ledger ────────────────────────────────────────────

/**
 * Accounts. Debit-positive amounts: a line amount > 0 is a debit, < 0 a credit.
 * - wallet: the shared cash wallet (asset)
 * - instructor_advance: advances paid to instructors, not yet settled (asset)
 * - instructor_payable: instructor fees owed, not yet paid (liability)
 * - partner_capital: each partner's equity (per partner)
 * - revenue: registration income (income)
 * - instructor_fees, course_expenses, general_expenses: expenses
 */
export const account = pgEnum("ledger_account", [
  "wallet",
  "instructor_advance",
  "instructor_payable",
  "partner_capital",
  "revenue",
  "instructor_fees",
  "course_expenses",
  "general_expenses",
])

export const transactionKind = pgEnum("ledger_transaction_kind", [
  "capital_contribution",
  "capital_withdrawal",
  "expense", // course or general expense, paid from the wallet (or, for a workshop, out of the instructor's advance)
  "registration_payment",
  "registration_refund",
  "instructor_advance",
  "instructor_payment",
  "course_settlement", // instructor fee accrued at closing
  "course_close", // workshop profit or loss moved to partner capital
  "reversal",
])

/** Ledger rows are append-only: a database trigger rejects UPDATE and DELETE. */
export const ledgerTransactions = pgTable("ledger_transactions", {
  id: id(),
  kind: transactionKind("kind").notNull(),
  occurredOn: date("occurred_on", { mode: "string" }).notNull(),
  description: text("description").notNull(),
  courseId: uuid("course_id").references(() => courses.id),
  registrationId: uuid("registration_id").references(() => registrations.id),
  /** Set on a reversal: the transaction it cancels. */
  reversalOf: uuid("reversal_of").unique(),
  createdBy: uuid("created_by").references(() => admins.id),
  createdAt: createdAt(),
}, (t) => [
  index("ledger_tx_course_idx").on(t.courseId),
  index("ledger_tx_occurred_idx").on(t.occurredOn),
])

/** The lines of each transaction sum to zero (deferred trigger). */
export const ledgerLines = pgTable("ledger_lines", {
  id: id(),
  transactionId: uuid("transaction_id").notNull().references(() => ledgerTransactions.id),
  account: account("account").notNull(),
  /** Required for partner_capital, null otherwise. */
  partnerId: uuid("partner_id").references(() => admins.id),
  amount: money("amount").notNull(),
}, (t) => [
  index("ledger_lines_tx_idx").on(t.transactionId),
  index("ledger_lines_account_idx").on(t.account, t.partnerId),
  check("ledger_lines_nonzero", sql`${t.amount} <> 0`),
  check(
    "ledger_lines_partner",
    sql`(${t.account} = 'partner_capital') = (${t.partnerId} is not null)`,
  ),
])

// ─── Site ──────────────────────────────────────────────────────────────────

/** Key/value site settings (brand, default locale, SEO, CDN, watermark, ...). */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updatedAt(),
})

/** Who did what in the super-admin panel. Append-only. */
export const auditLog = pgTable("audit_log", {
  id: id(),
  adminId: uuid("admin_id").references(() => admins.id),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  data: jsonb("data"),
  ip: text("ip"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("audit_log_at_idx").on(t.at)])
