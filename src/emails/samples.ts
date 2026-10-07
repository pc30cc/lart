import type { EmailProps } from "./templates"

/**
 * Example props of the phase 2 emails for the templates page preview
 * (`sampleEmailProps` in features/templates/emails.ts spreads these in).
 * Links stay on this site, except the example payment link, which is the one
 * kind of link allowed to point elsewhere.
 */
export type AccountSampleInput = {
  locale: string
  person: string
  adminName: string
  workshopTitle: string
  venue: string
  /** Formatted like the real emails: `formatDate(…, "full")`, `formatTimeRange`, `formatLira`. */
  date: string
  time: string
  amount: string
  /** A smaller formatted amount for the partial refund (half of `amount`). */
  halfAmount: string
  /** A path without a language in the sample's language (`localePath`: the main language has no prefix). */
  href: (path: string) => string
}

type AccountEmail =
  | "member_exists"
  | "registration_received"
  | "payment_received"
  | "registration_cancelled"
  | "refund_due"
  | "refund_sent"

export function accountEmailSamples(s: AccountSampleInput): { [K in AccountEmail]: EmailProps<K> } {
  return {
    member_exists: { name: s.person, loginUrl: s.href("/account/login"), resetUrl: s.href("/account/forgot") },
    registration_received: {
      name: s.person,
      participantName: s.person,
      workshopTitle: s.workshopTitle,
      date: s.date,
      time: s.time,
      venue: s.venue,
      amount: s.amount,
      accountUrl: s.href("/account"),
      cash: true,
      transfer: { accountHolder: s.person, bankName: "Ziraat Bankası", iban: "TR330006100519786457841326" },
      paymentUrl: "https://iyzi.link/example",
    },
    payment_received: {
      name: s.person,
      workshopTitle: s.workshopTitle,
      amount: s.amount,
      method: "transfer",
      date: s.date,
      time: s.time,
      venue: s.venue,
      accountUrl: s.href("/account"),
    },
    registration_cancelled: {
      name: s.person,
      workshopTitle: s.workshopTitle,
      refundAmount: s.halfAmount,
      refundPercent: 50,
      workshopsUrl: s.href("/workshops"),
    },
    refund_due: {
      adminName: s.adminName,
      participantName: s.person,
      workshopTitle: s.workshopTitle,
      amount: s.halfAmount,
      url: s.href("/admin"),
    },
    refund_sent: { name: s.person, workshopTitle: s.workshopTitle, amount: s.halfAmount, workshopsUrl: s.href("/workshops") },
  }
}
