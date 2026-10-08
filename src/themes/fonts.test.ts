import { describe, expect, it } from "vitest"

import { fontPoolCss, fontStack, siteFontCss, siteFontPreloads, siteFontStyles } from "./font-css"
import { fonts, isValidChoice, type SiteFonts } from "./fonts"
import { themeDefaultFonts, themeIds } from "./ids"
import { resolveSiteFonts } from "./resolve-fonts"

const atelier = themeDefaultFonts.atelier
const classic = themeDefaultFonts.default
const registryFiles = new Set<string>(fonts.flatMap((f) => f.files.map((file) => file.src)))
const urls = (css: string) => [...css.matchAll(/url\(([^)]*)\)/g)].map((m) => m[1])

describe("the font registry", () => {
  it("gives every theme fonts of the right script, in their own weights", () => {
    for (const id of themeIds) {
      for (const script of ["latin", "persian"] as const) {
        for (const part of ["heading", "body"] as const) {
          expect(isValidChoice(themeDefaultFonts[id][script][part], script), `${id} ${script} ${part}`).toBe(true)
        }
      }
    }
  })

  it("names only versioned files under /fonts/<id>/", () => {
    for (const font of fonts) {
      for (const file of font.files) expect(file.src).toMatch(new RegExp(`^/fonts/${font.id}/${font.id}-[a-z-]+-v\\d+(\\.\\d+)*\\.woff2$`))
    }
  })
})

describe("resolveSiteFonts", () => {
  it("uses the theme's own fonts when nothing is saved", () => {
    expect(resolveSiteFonts("atelier", undefined)).toEqual(atelier)
    expect(resolveSiteFonts("default", {})).toEqual(classic)
  })

  it("uses a saved choice per script", () => {
    const latin = { heading: { id: "playfair-display", weight: 900 }, body: { id: "raleway", weight: 300 } }
    expect(resolveSiteFonts("atelier", { latin })).toEqual({ latin, persian: atelier.persian })
    const persian = { heading: { id: "vazirmatn", weight: 800 }, body: { id: "noto-naskh-arabic", weight: 400 } }
    expect(resolveSiteFonts("default", { latin, persian })).toEqual({ latin, persian })
  })

  it("falls back to the theme's fonts for a script whose choice is not in the registry", () => {
    const body = atelier.latin.body
    // An unknown font, a weight the font does not have, a font of the other script.
    expect(resolveSiteFonts("atelier", { latin: { heading: { id: "gone", weight: 400 }, body } }).latin).toEqual(atelier.latin)
    expect(resolveSiteFonts("atelier", { latin: { heading: { id: "lora", weight: 300 }, body } }).latin).toEqual(atelier.latin)
    expect(resolveSiteFonts("atelier", { latin: { heading: { id: "vazirmatn", weight: 400 }, body } }).latin).toEqual(atelier.latin)
    const persian = { heading: { id: "iransans", weight: 700 }, body: { id: "montserrat", weight: 400 } }
    expect(resolveSiteFonts("atelier", { persian })).toEqual(atelier)
  })

  it("uses the classic theme's fonts for an unknown theme", () => {
    expect(resolveSiteFonts("neon", undefined)).toEqual(classic)
  })
})

describe("siteFontCss", () => {
  it("declares only the chosen self-hosted fonts and sets the variables", () => {
    const css = siteFontCss(atelier)
    expect(new Set(urls(css))).toEqual(
      new Set([
        "/fonts/cormorant-garamond/cormorant-garamond-latin-v5.3.woff2",
        "/fonts/cormorant-garamond/cormorant-garamond-latin-ext-v5.3.woff2",
        "/fonts/montserrat/montserrat-latin-v5.3.woff2",
        "/fonts/montserrat/montserrat-latin-ext-v5.3.woff2",
        "/fonts/noto-naskh-arabic/noto-naskh-arabic-arabic-v5.3.woff2",
      ]),
    )
    expect(css).toContain(
      '[data-site-theme]{--site-font-heading:"Site Cormorant Garamond", serif;--site-font-heading-weight:500;' +
        '--site-font-body:"Site Montserrat", ui-sans-serif, system-ui, sans-serif;--site-font-body-weight:400;--site-font-features:normal}',
    )
  })

  it("puts the Persian fonts under :lang(fa), with the Latin fonts after them for Latin words", () => {
    const css = siteFontCss(atelier)
    expect(css).toContain(
      '[data-site-theme]:lang(fa){--site-font-heading:"Site Noto Naskh Arabic", "Site Cormorant Garamond", serif;--site-font-heading-weight:700;' +
        '--site-font-body:var(--font-iransans), "Site Montserrat", ui-sans-serif, system-ui, sans-serif;--site-font-body-weight:400;--site-font-features:normal}',
    )
  })

  it("uses the root layout's fonts by their variables (Inter's glyph variants on Latin pages only)", () => {
    const css = siteFontCss(classic)
    expect(urls(css)).toEqual([])
    expect(css).toContain("--site-font-body:var(--font-inter), var(--font-inter-ext), ui-sans-serif, system-ui, sans-serif")
    expect(css).toContain('--site-font-features:"cv11", "ss01"}')
    expect(css).toMatch(/:lang\(fa\)\{[^}]*--site-font-features:normal\}/)
  })

  it("writes only registry values, whatever it is given", () => {
    const hostile = {
      latin: {
        heading: { id: 'x"}body{display:none', weight: "700;}body{color:red" },
        body: { id: "url(https://evil.example/f.woff2)", weight: 1 },
      },
      persian: { heading: { id: "</style><script>", weight: 700 }, body: atelier.persian.body },
    } as unknown as SiteFonts
    const css = siteFontCss(hostile)
    for (const bad of ["display:none", "color:red", "evil", "<", "script"]) expect(css).not.toContain(bad)
    expect(css).toContain("--site-font-heading-weight:400")
    for (const url of urls(css)) expect(registryFiles).toContain(url)
  })

  it("matches the styles the settings preview shows", () => {
    const custom: SiteFonts = { ...atelier, latin: { heading: { id: "lora", weight: 600 }, body: { id: "inter", weight: 300 } } }
    const styles = siteFontStyles(custom)
    const css = siteFontCss(custom)
    expect(css).toContain(`--site-font-heading:${styles.latin.heading.family};--site-font-heading-weight:600`)
    expect(css).toContain(`--site-font-body:${styles.persian.body.family};--site-font-body-weight:400`)
    expect(styles.latin.body).toEqual({ family: fontStack("inter"), weight: 300 })
  })

  it("preloads the main file of the page's script only", () => {
    expect(siteFontPreloads(atelier, "latin")).toEqual([
      "/fonts/cormorant-garamond/cormorant-garamond-latin-v5.3.woff2",
      "/fonts/montserrat/montserrat-latin-v5.3.woff2",
    ])
    expect(siteFontPreloads(atelier, "persian")).toEqual(["/fonts/noto-naskh-arabic/noto-naskh-arabic-arabic-v5.3.woff2"])
    expect(siteFontPreloads(classic, "latin")).toEqual([])
  })
})

describe("fontPoolCss", () => {
  it("declares every registry file once, with the site's family names", () => {
    const css = fontPoolCss()
    const faces = css.split("\n")
    expect(faces).toHaveLength(registryFiles.size)
    expect(new Set(urls(css))).toEqual(registryFiles)
    for (const font of fonts) {
      for (const file of font.files) {
        expect(css).toContain(`@font-face{font-family:"Site ${font.label}";font-style:normal;font-display:swap;font-weight:${font.weightRange};src:url(${file.src})`)
      }
    }
    // The root layout's fonts (Inter, IRANSans) and the system serif are not declared again.
    expect(css).not.toMatch(/Inter|IRANSans|Georgia|var\(/)
    expect(fontPoolCss()).toBe(css)
  })
})

describe("fontStack", () => {
  it("names a font with its fallback", () => {
    expect(fontStack("lora")).toBe('"Site Lora", serif')
    expect(fontStack("vazirmatn")).toBe('"Site Vazirmatn", ui-sans-serif, system-ui, sans-serif')
    expect(fontStack("iransans")).toBe("var(--font-iransans), ui-sans-serif, system-ui, sans-serif")
    expect(fontStack("system-serif")).toBe('ui-serif, Georgia, Cambria, "Times New Roman", Times, serif')
    expect(fontStack("gone}")).toBe("ui-sans-serif, system-ui, sans-serif")
  })
})
