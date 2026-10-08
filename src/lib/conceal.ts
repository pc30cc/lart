/**
 * Contact details (the footer's email address and phone number) kept out of
 * the page's HTML and data, where address harvesters read them: the server
 * sends `conceal(text)` and the browser shows `reveal(code)` once a person is
 * there (components/site/protected-contact). A disguise, not encryption (the
 * key is in the page's script): enough for the bots that scan pages for
 * "@", "mailto:" and phone numbers. Pure: the same on the server and in the browser.
 */
const KEY = [0x4c, 0x69, 0x6d, 0x65, 0x72, 0x2e, 0x74, 0x72]

/** A byte as two letters, "aa" to "jv": a code is letters only (no "@", no digits a phone-number scanner could match). */
const letters = (b: number) => String.fromCharCode(97 + Math.floor(b / 26), 97 + (b % 26))

/** "hello@example.com" → its UTF-8 bytes mixed with the key, as letters, in reverse order. */
export function conceal(text: string): string {
  return Array.from(new TextEncoder().encode(text), (b, i) => letters(b ^ KEY[i % KEY.length]))
    .reverse()
    .join("")
}

/** The text `conceal` was given; "" for anything that is not one of its codes. */
export function reveal(code: string): string {
  if (!/^(?:[a-j][a-z])*$/.test(code)) return ""
  const pairs = code.match(/.{2}/g)?.reverse() ?? []
  const bytes = pairs.map((p, i) => ((p.charCodeAt(0) - 97) * 26 + (p.charCodeAt(1) - 97)) ^ KEY[i % KEY.length])
  if (bytes.some((b) => b > 255)) return ""
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes))
  } catch {
    return ""
  }
}
