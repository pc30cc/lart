/**
 * Money is stored and computed as integer kuruş (1 ₺ = 100 kuruş).
 * Never use floating point for amounts.
 */

/** Parse a user-entered lira amount ("1250", "1250,5", "1.250,50") into kuruş. */
export function parseLira(input: string): number | null {
  const s = input.trim().replace(/\s|₺/g, "")
  if (!s) return null
  // Accept both "1.250,50" (tr) and "1,250.50" / "1250.50" styles.
  const lastSep = Math.max(s.lastIndexOf(","), s.lastIndexOf("."))
  let whole = s
  let frac = ""
  if (lastSep !== -1 && s.length - lastSep - 1 <= 2) {
    whole = s.slice(0, lastSep)
    frac = s.slice(lastSep + 1)
  }
  whole = whole.replace(/[.,]/g, "")
  if (!/^\d+$/.test(whole || "0") || !/^\d{0,2}$/.test(frac)) return null
  const kurus = Number(whole || "0") * 100 + Number(frac.padEnd(2, "0") || "0")
  return Number.isSafeInteger(kurus) ? kurus : null
}

/** Format kuruş as Turkish lira for the given locale, e.g. "₺1.250,00". */
export function formatLira(kurus: number, locale: string = "tr"): string {
  return new Intl.NumberFormat(locale === "fa" ? "fa-IR" : locale === "en" ? "en-US" : "tr-TR", {
    style: "currency",
    currency: "TRY",
    minimumFractionDigits: kurus % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(kurus / 100)
}

/**
 * Split an amount by basis-point shares without losing a kuruş.
 * Remainders go to the largest shares first (ties: input order).
 */
export function splitByShares(amount: number, sharesBp: number[]): number[] {
  const total = sharesBp.reduce((a, b) => a + b, 0)
  if (total !== 10000) throw new Error("Shares must sum to 10000 basis points")
  const sign = amount < 0 ? -1 : 1
  const abs = Math.abs(amount)
  const parts = sharesBp.map((bp) => Math.floor((abs * bp) / 10000))
  let rest = abs - parts.reduce((a, b) => a + b, 0)
  const order = sharesBp.map((bp, i) => [bp, i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1])
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) parts[order[k][1]] += 1
  return parts.map((p) => p * sign)
}
