/**
 * The partner limit, shared by the panel (invitations), the accept page and
 * `scripts/create-admin.ts`. No imports on purpose: the script runs outside
 * Next.js with relative imports only.
 */

/** At most this many partners (active super admins), counting invitations that still work. */
export const MAX_PARTNERS = 3

/** How long an invitation link works. */
export const PARTNER_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Name of the transaction advisory lock (`pg_advisory_xact_lock(hashtext(…))`)
 * that every change of the partner count or of partner emails takes first:
 * inviting, sending again, cancelling, accepting, changing one's email and the
 * CLI. So two of them can never together pass the limit or share an email.
 */
export const PARTNERS_LOCK = "admins:partners"
