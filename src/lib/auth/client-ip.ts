/**
 * The visitor's IP address behind Traefik and Cloudflare.
 *
 * Traefik trusts no one: it replaces any X-Real-IP / X-Forwarded-For the
 * client sent with the address that connected to it. Behind Cloudflare that
 * address is a Cloudflare edge, shared by many visitors, so the real one is
 * read from CF-Connecting-IP, but only when the connection really came from
 * Cloudflare's published ranges (https://www.cloudflare.com/ips/). Anyone
 * connecting to the server directly is keyed by their own address and cannot
 * choose another one by sending the header.
 */

const CLOUDFLARE_V4 = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
]
const CLOUDFLARE_V6 = [
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
]

/** An IPv4 address as a number, or null. */
function v4(ip: string): bigint | null {
  const parts = ip.split(".")
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) return null
  return parts.reduce((n, p) => (n << BigInt(8)) | BigInt(p), BigInt(0))
}

/** An IPv6 address as a number, or null (an embedded IPv4 tail is not needed here). */
function v6(ip: string): bigint | null {
  if (!/^[0-9a-f:]+$/i.test(ip) || ip.split("::").length > 2) return null
  const [head, tail] = ip.includes("::") ? ip.split("::") : [ip, null]
  const left = head ? head.split(":") : []
  const right = tail ? tail.split(":") : []
  const missing = 8 - left.length - right.length
  if (tail === null ? missing !== 0 : missing < 1) return null
  const groups = [...left, ...Array<string>(missing).fill("0"), ...right]
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null
  return groups.reduce((n, g) => (n << BigInt(16)) | BigInt(parseInt(g, 16)), BigInt(0))
}

function inRanges(ip: string, ranges: string[], parse: (ip: string) => bigint | null, bits: number) {
  const value = parse(ip)
  if (value === null) return false
  return ranges.some((range) => {
    const [base, size] = range.split("/")
    const start = parse(base)!
    const shift = BigInt(bits - Number(size))
    return value >> shift === start >> shift
  })
}

/** Whether an address belongs to Cloudflare (IPv4, IPv6 or IPv4-mapped IPv6). */
export function isCloudflare(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1]
  const address = mapped ?? ip
  return inRanges(address, CLOUDFLARE_V4, v4, 32) || inRanges(address, CLOUDFLARE_V6, v6, 128)
}

/**
 * The client IP: the address that connected to Traefik (X-Real-IP, set by
 * Traefik), or the visitor's when that address is Cloudflare's.
 */
export function clientIp(headers: Headers): string | null {
  const peer = (headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",").at(-1))?.trim()
  if (!peer) return null
  const visitor = headers.get("cf-connecting-ip")?.trim()
  return (visitor && isCloudflare(peer) ? visitor : peer).slice(0, 64)
}
