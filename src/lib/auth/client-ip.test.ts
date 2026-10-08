import { describe, expect, it } from "vitest"

import { clientIp, isCloudflare } from "./client-ip"

const h = (values: Record<string, string>) => new Headers(values)

describe("isCloudflare", () => {
  it("knows Cloudflare's IPv4 and IPv6 ranges, and nothing else", () => {
    expect(isCloudflare("172.70.12.5")).toBe(true)
    expect(isCloudflare("104.23.255.1")).toBe(true)
    expect(isCloudflare("::ffff:162.158.1.1")).toBe(true)
    expect(isCloudflare("2a06:98c7:1::5")).toBe(true)
    expect(isCloudflare("2606:4700:10::ac43:1")).toBe(true)
    expect(isCloudflare("172.80.0.1")).toBe(false)
    expect(isCloudflare("192.99.68.134")).toBe(false)
    expect(isCloudflare("2a06:98d0::1")).toBe(false)
    expect(isCloudflare("not an ip")).toBe(false)
    expect(isCloudflare("1:2:3:4:5:6:7:8:9")).toBe(false)
  })
})

describe("clientIp", () => {
  it("takes the visitor from CF-Connecting-IP only when Cloudflare connected", () => {
    expect(clientIp(h({ "x-real-ip": "172.70.12.5", "cf-connecting-ip": "85.105.1.2" }))).toBe("85.105.1.2")
    expect(clientIp(h({ "x-real-ip": "85.105.9.9", "cf-connecting-ip": "1.2.3.4" }))).toBe("85.105.9.9")
  })

  it("falls back to the proxy's last X-Forwarded-For entry, and to null", () => {
    expect(clientIp(h({ "x-forwarded-for": "6.6.6.6, 85.105.1.2" }))).toBe("85.105.1.2")
    expect(clientIp(h({}))).toBeNull()
  })
})
