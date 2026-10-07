import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { localePath } from "@/i18n/paths"
import { locales } from "@/i18n/routing"
import { AUTH_PAGES, canonicalPath, isOpenPath, LEGACY_PATHS, matchRoute, ROUTES, UNLOCALIZED_HANDLERS } from "./routes"

/**
 * The guard of the URL rules (docs/DEVELOPMENT.md, "URL rules"): the pages
 * on disk are exactly the route table, the table follows the rules, the docs
 * mirror it, and no code builds a language prefix by hand.
 */

const ROOT = path.resolve(__dirname, "../..")
const APP = path.join(ROOT, "src/app")
const files = (dir: string) => readdirSync(dir, { recursive: true, encoding: "utf8" }).map((f) => f.split(path.sep).join("/"))

/** "[locale]/admin/(panel)/workshops/[id]/page.tsx" → "/admin/workshops/[id]": no route groups, no language. */
function urlOf(file: string): string {
  const segments = file.split("/").slice(0, -1)
  const url = segments.filter((s) => !/^\(.+\)$/.test(s) && s !== "[locale]")
  return `/${url.join("/")}`
}

const appFiles = files(APP)
const pages = appFiles.filter((f) => f.endsWith("/page.tsx") || f === "page.tsx")
const handlers = appFiles.filter((f) => f.endsWith("/route.ts"))
const sorted = (list: readonly string[]) => [...list].sort()

describe("route table", () => {
  it("has every page under [locale]/ (no root page can come back)", () => {
    expect(pages.filter((f) => !f.startsWith("[locale]/"))).toEqual([])
  })

  it("lists exactly the pages and localized route handlers on disk", () => {
    expect(sorted(pages.map(urlOf))).toEqual(sorted(ROUTES.filter((r) => r.kind !== "handler").map((r) => r.path)))
    expect(sorted(handlers.filter((f) => f.startsWith("[locale]/")).map(urlOf))).toEqual(
      sorted(ROUTES.filter((r) => r.kind === "handler").map((r) => r.path)),
    )
  })

  it("lists exactly the route handlers outside the languages", () => {
    expect(sorted(handlers.filter((f) => !f.startsWith("[locale]/")).map(urlOf))).toEqual(sorted(UNLOCALIZED_HANDLERS))
  })

  it("has no duplicate paths", () => {
    expect(new Set(ROUTES.map((r) => r.path)).size).toBe(ROUTES.length)
  })

  it("uses lower-case English kebab-case segments, no trailing slash, no extension (R3)", () => {
    for (const { path: p, kind } of ROUTES) {
      if (kind === "not-found") continue
      expect(p === "/" || /^(?:\/(?:[a-z0-9]+(?:-[a-z0-9]+)*|\[[a-z]+\]))+$/.test(p), p).toBe(true)
    }
  })

  it("keeps public addresses short, with a slug, the action last and no id (R3)", () => {
    const publicPaths = new Set(ROUTES.filter((r) => r.access === "public" && r.kind === "page").map((r) => r.path))
    for (const p of publicPaths) {
      const segments = p.split("/").filter(Boolean)
      expect(segments.length, p).toBeLessThanOrEqual(3)
      segments.forEach((segment, i) => {
        if (segment.startsWith("[")) {
          // Only a slug, right after the plural list it belongs to.
          expect(segment, p).toBe("[slug]")
          expect(segments[i - 1], p).toMatch(/s$/)
          expect(publicPaths.has(`/${segments.slice(0, i).join("/")}`), p).toBe(true)
        }
        if (["register", "new", "edit"].includes(segment)) expect(i, p).toBe(segments.length - 1)
      })
      // robots.txt's "Disallow: /admin" is a prefix match.
      expect(segments[0]?.startsWith("admin") ?? false, p).toBe(false)
    }
  })

  it("gives every area the same sign-in pages, and only those open (R4)", () => {
    for (const area of ["account", "instructor", "admin"] as const) {
      const routes = ROUTES.filter((r) => r.area === area)
      const open = routes.filter((r) => r.access === "open").map((r) => r.path)
      for (const p of open) expect(AUTH_PAGES.map((name) => `/${area}/${name}`), p).toContain(p)
      for (const name of ["login", "forgot", "reset"]) expect(open, area).toContain(`/${area}/${name}`)
      expect(routes.filter((r) => r.access !== "open").every((r) => r.access === "private"), area).toBe(true)
      expect(routes.map((r) => r.path), area).toContain(`/${area}`)
      expect(routes.filter((r) => /accept-invite|\/login\//.test(r.path)), area).toEqual([])
      expect(routes.every((r) => r.path.startsWith(`/${area}`)), area).toBe(true)
    }
  })

  it("sends every old address to an open page in one step, in every language", () => {
    for (const [from, to] of Object.entries(LEGACY_PATHS)) {
      expect(matchRoute(from), from).toBeNull()
      expect(isOpenPath(to), to).toBe(true)
      expect(canonicalPath(from, "tr")).toBe(to)
      for (const l of locales) expect(canonicalPath(`/${l}${from}`, "tr")).toBe(localePath(l, to, "tr"))
    }
  })

  it("is mirrored row by row in docs/DEVELOPMENT.md", () => {
    const docs = readFileSync(path.join(ROOT, "docs/DEVELOPMENT.md"), "utf8")
    const table = /<!-- routes:start -->([\s\S]*?)<!-- routes:end -->/.exec(docs)?.[1] ?? ""
    const rows = table
      .split("\n")
      .filter((line) => line.startsWith("| `"))
      .map((line) => /^\| `([^`]+)`/.exec(line)![1])
    expect(rows).toEqual(ROUTES.map((r) => r.path))
  })
})

describe("matchRoute", () => {
  it("finds the most specific route, ignoring the query", () => {
    expect(matchRoute("/admin/categories/new")?.path).toBe("/admin/categories/new")
    expect(matchRoute("/admin/categories/c1?x=1")?.path).toBe("/admin/categories/[id]")
    expect(matchRoute("/workshops/candles/register")).toMatchObject({ area: "site", access: "public" })
    expect(matchRoute("/")?.path).toBe("/")
    expect(matchRoute("/nowhere")).toBeNull()
    expect(matchRoute("/workshops/a/b/c")).toBeNull()
  })
})

describe("no hand-built language prefixes (R1, R6)", () => {
  /** The code of every source file, without comments and tests. */
  const sources = files(path.join(ROOT, "src"))
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => ({
      file: `src/${f}`,
      code: readFileSync(path.join(ROOT, "src", f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, ""),
    }))

  const offenders = (pattern: RegExp, allowed: string[] = []) =>
    sources.filter(({ file, code }) => pattern.test(code) && !allowed.includes(file)).map(({ file }) => file)

  it("builds `/${locale}…` only in the path helpers", () => {
    expect(offenders(/`\/\$\{[^}]*\b(?:\w*[lL]ocale|l|lang)\b[^}]*\}/, ["src/i18n/paths.ts", "src/app/robots.ts"])).toEqual([])
  })

  it("writes no language prefix as text", () => {
    expect(offenders(/["'`]\/(?:fa|tr|en)(?:[/?#"'`])/)).toEqual([])
  })

  it("names the old addresses only in the redirect table", () => {
    expect(offenders(/accept-invite|admin\/login\/(?:forgot|reset)/, ["src/lib/routes.ts"])).toEqual([])
  })
})
