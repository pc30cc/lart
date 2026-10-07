import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { getMainLocaleState } from "@/i18n/main-locale"
import { localePath } from "@/i18n/paths"
import { locales, type AppLocale } from "@/i18n/routing"
import { sessionCookieName } from "@/lib/auth/cookies"
import { LEGACY_PATHS, ROUTES } from "@/lib/routes"
import { config, proxy } from "./proxy"

// The real next-intl middleware runs here (inlined by vitest.config.ts); only
// the main language (a setting) is mocked, per test: read (`known`) unless a
// test says it is only guessed.

type Kind = "admin" | "instructor" | "member"

function request(
  path: string,
  init: { method?: string; cookie?: boolean | Kind; headers?: Record<string, string> } = {},
) {
  const headers = new Headers(init.headers)
  if (init.cookie) headers.set("cookie", `${sessionCookieName(init.cookie === true ? "admin" : init.cookie)}=token`)
  return new NextRequest(new URL(path, "http://localhost:3000"), { method: init.method ?? "GET", headers })
}

const location = (res: Response) => {
  const url = new URL(res.headers.get("location")!)
  return url.pathname + url.search
}

const loginOf = (res: Response) => {
  expect(res.status).toBe(307)
  const url = new URL(res.headers.get("location")!)
  return { path: url.pathname, next: url.searchParams.get("next") }
}

/** Request headers the proxy forwards to the page (Next's override protocol). */
const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`)
/** Where next-intl rewrote the request to (the internal, prefixed path), or null. */
const rewrite = (res: Response) => {
  const value = res.headers.get("x-middleware-rewrite")
  return value && new URL(value).pathname + new URL(value).search
}
/** The page is served (no redirect): a rewrite or a plain "next". */
const served = (res: Response) => res.status === 200 && (rewrite(res) !== null || res.headers.get("x-middleware-next") === "1")

const mainLocaleState = vi.mocked(getMainLocaleState)
/** The main language of the next requests: read from the setting, or (`known` false) only guessed. */
const setMain = (locale: AppLocale, known = true) => mainLocaleState.mockResolvedValue({ locale, known })
const others = (main: AppLocale) => locales.filter((l) => l !== main)

beforeEach(() => setMain("tr"))

describe("proxy: addresses (main language without a prefix)", () => {
  describe.each(locales)("main language %s", (main) => {
    beforeEach(() => setMain(main))

    it("shows / in the main language, whatever the browser asks for, with a CSP nonce", async () => {
      const other = others(main)[0]
      const res = await proxy(
        request("/", { headers: { "accept-language": `${other};q=1`, cookie: `NEXT_LOCALE=${others(main)[1]}` } }),
      )
      expect(res.status).toBe(200)
      expect(rewrite(res)).toBe(`/${main}`)
      expect(forwarded(res, "x-next-intl-locale")).toBe(main)
      const nonce = forwarded(res, "x-nonce")
      expect(nonce).toBeTruthy()
      const csp = res.headers.get("content-security-policy")!
      expect(csp).toContain(`'nonce-${nonce}'`)
      expect(forwarded(res, "content-security-policy")).toBe(csp)
      expect(res.headers.get("set-cookie")).toBeNull()
      expect(res.headers.get("link")).toBeNull()
      expect(res.headers.get("x-robots-tag")).toBeNull()
    })

    it("serves an unprefixed path in the main language, query kept", async () => {
      const res = await proxy(request("/workshops/candles?x=1"))
      expect(rewrite(res)).toBe(`/${main}/workshops/candles?x=1`)
      expect(forwarded(res, "x-next-intl-locale")).toBe(main)
    })

    it("serves the other languages under their prefix", async () => {
      for (const other of others(main)) {
        for (const path of [`/${other}`, `/${other}/workshops`]) {
          const res = await proxy(request(path))
          expect(served(res), path).toBe(true)
          expect(forwarded(res, "x-next-intl-locale"), path).toBe(other)
        }
      }
    })

    it.each(["GET", "HEAD"])("sends a %s of the main language's prefix to the address without it (308, not cached)", async (method) => {
      for (const [from, to] of [
        [`/${main}/workshops?x=1`, "/workshops?x=1"],
        [`/${main}`, "/"],
        [`/${main}?x=1`, "/?x=1"],
      ]) {
        const res = await proxy(request(from, { method }))
        expect(res.status, from).toBe(308)
        expect(location(res), from).toBe(to)
        expect(res.headers.get("cache-control"), from).toBe("no-store")
        expect(res.headers.get("set-cookie"), from).toBeNull()
      }
    })

    it("serves a server action posted to the main language's prefixed address as it is", async () => {
      const res = await proxy(request(`/${main}/workshops/candles/register`, { method: "POST" }))
      expect(res.status).toBe(200)
      expect(res.headers.get("x-middleware-next")).toBe("1")
      expect(forwarded(res, "x-next-intl-locale")).toBe(main)
      expect(forwarded(res, "x-nonce")).toBeTruthy()
    })

    it("sends each renamed page to its new address in one 308, in any language, query kept", async () => {
      for (const [from, to] of Object.entries(LEGACY_PATHS)) {
        for (const locale of [null, ...locales]) {
          const path = locale ? `/${locale}${from}` : from
          const res = await proxy(request(`${path}?token=abc`))
          expect(res.status, path).toBe(308)
          expect(location(res), path).toBe(`${localePath(locale ?? main, to, main)}?token=abc`)
          expect(res.headers.get("x-robots-tag"), path).toBe("noindex, nofollow")
          expect(res.headers.get("set-cookie"), path).toBeNull()
        }
      }
    })

    it("writes a language prefix in capitals in lower case, in one step", async () => {
      const res = await proxy(request("/TR/workshops?x=1"))
      expect(res.status).toBe(308)
      expect(location(res)).toBe(`${localePath("tr", "/workshops", main)}?x=1`)
      const fa = await proxy(request("/Fa"))
      expect(location(fa)).toBe(localePath("fa", "/", main))
    })

    it("sends signed-out visits of the admin panel to the login of the same language, remembering the page", async () => {
      for (const locale of locales) {
        const page = localePath(locale, "/admin/categories", main)
        expect(loginOf(await proxy(request(`${page}?q=1`))), page).toEqual({
          path: localePath(locale, "/admin/login", main),
          next: page, // the admin login keeps only the path
        })
        // The panel's home is where the login goes anyway.
        expect(loginOf(await proxy(request(localePath(locale, "/admin", main))))).toEqual({
          path: localePath(locale, "/admin/login", main),
          next: null,
        })
      }
    })

    it("sends signed-out instructor panel visits to the instructor login, with the page and query", async () => {
      for (const locale of locales) {
        const at = (p: string) => localePath(locale, p, main)
        expect(loginOf(await proxy(request(at("/instructor"))))).toEqual({ path: at("/instructor/login"), next: null })
        expect(loginOf(await proxy(request(`${at("/instructor/contracts")}?c=1`)))).toEqual({
          path: at("/instructor/login"),
          next: `${at("/instructor/contracts")}?c=1`,
        })
      }
    })

    it("sends signed-out visits of My workshops to the member login, coming back to it", async () => {
      for (const locale of locales) {
        const at = (p: string) => localePath(locale, p, main)
        expect(loginOf(await proxy(request(at("/account"))))).toEqual({ path: at("/account/login"), next: at("/account") })
        expect(loginOf(await proxy(request(`${at("/account/registrations/r1")}?tab=2`)))).toEqual({
          path: at("/account/login"),
          next: `${at("/account/registrations/r1")}?tab=2`,
        })
      }
    })

    it("lets every sign-in page through without a session, noindex, in every language", async () => {
      const open = ROUTES.filter((r) => r.access === "open").map((r) => r.path)
      expect(open.length).toBeGreaterThan(10)
      for (const locale of locales) {
        for (const page of open) {
          const path = localePath(locale, page, main)
          const res = await proxy(request(`${path}?token=abc`))
          expect(served(res), path).toBe(true)
          expect(res.headers.get("x-robots-tag"), path).toBe("noindex, nofollow")
        }
      }
    })

    it("lets the right session through, and only that one", async () => {
      const cases: [string, Kind][] = [
        ["/admin/categories", "admin"],
        ["/instructor/contracts", "instructor"],
        ["/account", "member"],
      ]
      for (const locale of locales) {
        for (const [page, kind] of cases) {
          const path = localePath(locale, page, main)
          const ok = await proxy(request(path, { cookie: kind }))
          expect(served(ok), path).toBe(true)
          expect(forwarded(ok, "x-next-intl-locale"), path).toBe(locale)
          expect(ok.headers.get("x-robots-tag"), path).toBe("noindex, nofollow")
          for (const wrong of (["admin", "instructor", "member"] as const).filter((k) => k !== kind)) {
            expect((await proxy(request(path, { cookie: wrong }))).status, `${path} ${wrong}`).toBe(307)
          }
        }
      }
    })
  })
})

describe("proxy: a main language only guessed (the setting not read yet)", () => {
  // After a cold start with the database slow or down, getMainLocaleState()
  // gives the fallback, tr, with known: false. The real main language may be
  // fa or en, so nothing permanent may depend on it.
  beforeEach(() => setMain("tr", false))

  it.each(["GET", "HEAD"])("serves a %s of the guessed language's prefixed pages as they are (no 308)", async (method) => {
    for (const path of ["/tr/workshops?x=1", "/tr", "/tr?x=1", "/tr/workshops/candles", "/tr/account/login"]) {
      const res = await proxy(request(path, { method }))
      expect(res.status, path).toBe(200)
      expect(res.headers.get("location"), path).toBeNull()
      expect(served(res), path).toBe(true)
      expect(forwarded(res, "x-next-intl-locale"), path).toBe("tr")
    }
  })

  it("still renames the old sign-in addresses and lower-cases a prefix, keeping the request's own prefix", async () => {
    for (const [from, to] of Object.entries(LEGACY_PATHS)) {
      const res = await proxy(request(`${from}?token=abc`))
      expect(res.status, from).toBe(308)
      expect(location(res), from).toBe(`${to}?token=abc`)
      for (const locale of locales) {
        const prefixed = await proxy(request(`${localePath(locale, from, null)}?token=abc`))
        expect(prefixed.status, `${locale} ${from}`).toBe(308)
        expect(location(prefixed), `${locale} ${from}`).toBe(`${localePath(locale, to, null)}?token=abc`)
      }
    }
    const upper = await proxy(request("/TR/workshops?x=1"))
    expect(upper.status).toBe(308)
    expect(location(upper)).toBe("/tr/workshops?x=1")
  })

  it("serves / and unprefixed pages in the guessed language and the others under their prefix", async () => {
    expect(rewrite(await proxy(request("/")))).toBe("/tr")
    expect(rewrite(await proxy(request("/workshops?x=1")))).toBe("/tr/workshops?x=1")
    for (const path of ["/fa/workshops", "/en"]) {
      const res = await proxy(request(path))
      expect(served(res), path).toBe(true)
      expect(forwarded(res, "x-next-intl-locale"), path).toBe(path.slice(1, 3))
    }
  })

  it("keeps the private pages behind the sign-in, prefixed or not", async () => {
    for (const path of ["/tr/admin/categories", "/admin/categories", "/tr/account", "/tr/instructor/contracts"]) {
      expect((await proxy(request(path))).status, path).toBe(307)
    }
    expect(served(await proxy(request("/tr/admin/categories", { cookie: "admin" })))).toBe(true)
  })

  it("redirects the prefix away once the main language is read", async () => {
    setMain("tr")
    const res = await proxy(request("/tr/workshops?x=1"))
    expect(res.status).toBe(308)
    expect(location(res)).toBe("/workshops?x=1")
  })
})

describe("proxy: the sign-in gate", () => {
  it("keeps the other admin pages, such as My profile, behind the login", async () => {
    for (const path of ["/admin/profile", "/admin/invite/x", "/admin/invites", "/admin/login/x", "/fa/admin/profile"]) {
      const res = await proxy(request(path))
      expect(res.status, path).toBe(307)
      expect(new URL(res.headers.get("location")!).pathname, path).toMatch(/^(\/fa)?\/admin\/login$/)
    }
  })

  it("classifies encoded and doubled paths like the router does", async () => {
    for (const path of ["/%61dmin/categories", "/fa//admin/categories", "/%66a/admin/categories"]) {
      const res = await proxy(request(path))
      expect(res.status, path).toBe(307)
      expect(new URL(res.headers.get("location")!).pathname, path).toMatch(/\/admin\/login$/)
      expect(res.headers.get("x-robots-tag"), path).toBe("noindex, nofollow")
    }
    expect(loginOf(await proxy(request("/%61dmin/categories")))).toEqual({ path: "/admin/login", next: "/admin/categories" })
  })

  it("leaves public pages with similar names alone", async () => {
    for (const path of ["/instructors", "/instructors/zeynep", "/accounts", "/workshops", "/administration", "/fa/instructors", "/en/accounts"]) {
      const res = await proxy(request(path))
      expect(res.status, path).toBe(200)
      expect(res.headers.get("x-robots-tag"), path).toBeNull()
    }
  })

  it("does not redirect server actions posted from private pages (they check the session themselves)", async () => {
    for (const path of ["/admin/categories", "/instructor/profile", "/account", "/fa/account", "/tr/admin/categories"]) {
      const res = await proxy(request(path, { method: "POST" }))
      expect(res.status, path).toBe(200)
      expect(res.headers.get("x-robots-tag"), path).toBe("noindex, nofollow")
    }
  })

  it("passes the requested path and query to the page, never the client's own value", async () => {
    const res = await proxy(request("/workshops/candles?x=1", { headers: { "x-pathname": "//evil.example" } }))
    expect(forwarded(res, "x-pathname")).toBe("/workshops/candles?x=1")
    const fa = await proxy(request("/fa/workshops?x=1", { headers: { "x-pathname": "//evil.example" } }))
    expect(forwarded(fa, "x-pathname")).toBe("/fa/workshops?x=1")
  })

  it("uses a strict script policy and forbids framing", async () => {
    const csp = (await proxy(request("/fa"))).headers.get("content-security-policy")!
    const script = csp.split("; ").find((d) => d.startsWith("script-src"))!
    expect(script).toContain("'strict-dynamic'")
    expect(script).not.toContain("'unsafe-inline'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
  })
})

describe("proxy: APIs", () => {
  it("marks the private APIs noindex, without language routing or the main language", async () => {
    mainLocaleState.mockClear()
    for (const path of ["/api/admin/something", "/api/instructor/x", "/api/account/x"]) {
      const res = await proxy(request(path))
      expect(res.headers.get("x-middleware-next"), path).toBe("1")
      expect(forwarded(res, "x-next-intl-locale"), path).toBeNull()
      expect(res.headers.get("x-robots-tag"), path).toBe("noindex, nofollow")
    }
    expect((await proxy(request("/api/health"))).headers.get("x-robots-tag")).toBeNull()
    expect(mainLocaleState).not.toHaveBeenCalled()
  })

  it("skips static files, media files and the upload endpoints", () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`) // the pattern is a plain regex here
    expect(matcher.test("/fa/admin")).toBe(true)
    expect(matcher.test("/")).toBe(true)
    expect(matcher.test("/admin")).toBe(true)
    expect(matcher.test("/api/admin/media/watermark-preview")).toBe(true)
    expect(matcher.test("/_next/static/chunk.js")).toBe(false)
    expect(matcher.test("/media/courses/a.webp")).toBe(false)
    expect(matcher.test("/api/admin/uploads")).toBe(false)
    expect(matcher.test("/api/instructor/uploads")).toBe(false)
    expect(matcher.test("/api/instructor/other")).toBe(true)
    expect(matcher.test("/fa/instructor/profile")).toBe(true)
    expect(matcher.test("/favicon.ico")).toBe(false)
    expect(matcher.test("/sitemap.xml")).toBe(false)
  })
})
