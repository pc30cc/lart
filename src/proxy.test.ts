import { NextRequest } from "next/server"
import { describe, expect, it, vi } from "vitest"

import { sessionCookieName } from "@/lib/auth/cookies"
import { config, proxy } from "./proxy"

// next-intl's middleware is ESM that only a bundler resolves, so Vitest gets a
// stand-in with the same contract: prefixed paths continue with the locale
// header (forwarding the request headers), others are redirected to a prefix.
vi.mock("next-intl/middleware", async () => {
  const { NextResponse } = await import("next/server")
  return {
    default: () => (req: NextRequest) => {
      const locale = /^\/(fa|tr|en)(\/|$)/.exec(req.nextUrl.pathname)?.[1]
      if (!locale) return NextResponse.redirect(new URL(`/en${req.nextUrl.pathname}`, req.url))
      const headers = new Headers(req.headers)
      headers.set("x-next-intl-locale", locale)
      return NextResponse.next({ request: { headers } })
    },
  }
})

function request(path: string, init: { method?: string; cookie?: boolean; headers?: Record<string, string> } = {}) {
  const headers = new Headers(init.headers)
  if (init.cookie) headers.set("cookie", `${sessionCookieName("admin")}=token`)
  return new NextRequest(new URL(path, "http://localhost:3000"), { method: init.method ?? "GET", headers })
}

/** Request headers the proxy forwards to the page (Next's override protocol). */
const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`)

describe("proxy", () => {
  it("lets / through to the root page, with a CSP nonce", () => {
    const res = proxy(request("/"))
    expect(res.headers.get("x-middleware-next")).toBe("1")
    const nonce = forwarded(res, "x-nonce")
    expect(nonce).toBeTruthy()
    const csp = res.headers.get("content-security-policy")!
    expect(csp).toContain(`'nonce-${nonce}'`)
    expect(forwarded(res, "content-security-policy")).toBe(csp)
  })

  it("uses a strict script policy and forbids framing", () => {
    const csp = proxy(request("/fa")).headers.get("content-security-policy")!
    const script = csp.split("; ").find((d) => d.startsWith("script-src"))!
    expect(script).toContain("'strict-dynamic'")
    expect(script).not.toContain("'unsafe-inline'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
  })

  it("routes locale pages through next-intl and forwards the nonce", () => {
    const res = proxy(request("/fa/admin/categories", { cookie: true }))
    expect(res.headers.get("x-middleware-next")).toBe("1")
    expect(forwarded(res, "x-next-intl-locale")).toBe("fa")
    expect(forwarded(res, "x-nonce")).toBeTruthy()
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow")
  })

  it("adds the language prefix when it is missing", () => {
    const res = proxy(request("/admin", { headers: { "accept-language": "en-US,en;q=0.9" } }))
    expect(res.status).toBe(307)
    expect(new URL(res.headers.get("location")!).pathname).toBe("/en/admin")
  })

  it("sends signed-out admin page visits to the login, remembering the page", () => {
    const res = proxy(request("/tr/admin/categories"))
    expect(res.status).toBe(307)
    const location = new URL(res.headers.get("location")!)
    expect(location.pathname).toBe("/tr/admin/login")
    expect(location.searchParams.get("next")).toBe("/tr/admin/categories")
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow")
  })

  it("does not redirect the login page itself, server actions or public pages", () => {
    expect(proxy(request("/tr/admin/login")).status).toBe(200)
    expect(proxy(request("/tr/admin/categories", { method: "POST" })).status).toBe(200)
    const pub = proxy(request("/tr"))
    expect(pub.status).toBe(200)
    expect(pub.headers.get("x-robots-tag")).toBeNull()
  })

  it("marks the admin API noindex without locale routing", () => {
    const res = proxy(request("/api/admin/something"))
    expect(res.headers.get("x-middleware-next")).toBe("1")
    expect(forwarded(res, "x-next-intl-locale")).toBeNull()
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow")
  })

  it("skips static files, media files and the upload endpoint", () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`) // the pattern is a plain regex here
    expect(matcher.test("/fa/admin")).toBe(true)
    expect(matcher.test("/")).toBe(true)
    expect(matcher.test("/api/admin/media/private/x")).toBe(true)
    expect(matcher.test("/_next/static/chunk.js")).toBe(false)
    expect(matcher.test("/media/courses/a.webp")).toBe(false)
    expect(matcher.test("/api/admin/uploads")).toBe(false)
    expect(matcher.test("/favicon.ico")).toBe(false)
  })
})
