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
  createdAt: createdAt(),
}, (t) => [
  check("admins_share_bp_range", sql`${t.shareBp} between 0 and 10000`),
])

/** Students. They have no panel; they use the public site. */
export const members = pgTable("members", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  phone: text("phone"),
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
  active: boolean("active").notNull().default(true),
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
}, (t) => [index("sessions_subject_idx").on(t.kind, t.subjectId)])

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

export const courseStatus = pgEnum("course_status", [
  "awaiting_signature", // contract sent, not yet signed
  "published", // signed, visible, registration open until the deadline
  "confirmed", // go decision taken; final participant number fixed
  "cancelled",
  "closed", // finished and settled; figures locked
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
  venue: text("venue").notNull(),
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
  /** Fixed at the go decision; the per-participant fee is based on it. */
  finalParticipants: smallint("final_participants"),
  /** Locked figures written when the workshop is closed. */
  closedTotals: jsonb("closed_totals").$type<ClosedTotals>(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
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
  signedText: text("signed_text"),
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
  "pending", // awaiting payment
  "confirmed", // paid
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
  paidAt: timestamp("paid_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  refundAmount: money("refund_amount"),
  createdAt: createdAt(),
}, (t) => [
  index("registrations_course_idx").on(t.courseId, t.status),
  index("registrations_member_idx").on(t.memberId),
])

export const mediaKind = pgEnum("media_kind", ["sample", "gallery_photo", "gallery_video"])

/** Photos and videos of a workshop. Files live on the CDN; only paths here. */
export const media = pgTable("media", {
  id: id(),
  courseId: uuid("course_id").notNull().references(() => courses.id),
  kind: mediaKind("kind").notNull(),
  path: text("path").notNull(),
  /** Unwatermarked original, private storage, admins only. */
  originalPath: text("original_path"),
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
  "expense", // course or general expense, paid from the wallet or by a partner
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
